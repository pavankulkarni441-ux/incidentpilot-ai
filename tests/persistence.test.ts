import http from 'http';
import crypto from 'crypto';
import { AddressInfo } from 'net';
import type {
  FirestoreClientLike,
  FirestoreCollectionLike,
  FirestoreDocRefLike,
  FirestoreDocSnapshotLike,
  FirestoreQueryLike,
  FirestoreQuerySnapshotLike,
  FirestoreTransactionLike,
} from '../storage/workflowStore';

// Prevent server.ts from auto-binding port 3000 when imported for isolated testing
process.env.INCIDENTPILOT_NO_AUTOSTART = 'true';

/**
 * Faithful in-memory Firestore emulator with document versioning and
 * optimistic concurrency control (OCC) retries inside runTransaction().
 * Keeps tests 100% independent of a live GCP Firestore account while verifying
 * real Firestore transaction ordering, conflict retries, and persistence across restarts.
 */
class MockFirestoreDatabase implements FirestoreClientLike {
  private readonly collections = new Map<string, Map<string, { version: number; data: any }>>();

  private getColMap(name: string): Map<string, { version: number; data: any }> {
    let col = this.collections.get(name);
    if (!col) {
      col = new Map();
      this.collections.set(name, col);
    }
    return col;
  }

  public getRawCollection(name: string) {
    return this.getColMap(name);
  }

  collection(name: string): FirestoreCollectionLike {
    const db = this;

    const makeQuery = (orderField?: string, orderDir: 'asc' | 'desc' = 'asc', limitNum?: number): FirestoreQueryLike => ({
      orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
        return makeQuery(field, direction, limitNum);
      },
      limit(n: number) {
        return makeQuery(orderField, orderDir, n);
      },
      async get(): Promise<FirestoreQuerySnapshotLike> {
        const col = db.getColMap(name);
        let items = Array.from(col.values()).map((entry) => structuredClone(entry.data));
        if (orderField) {
          items.sort((a, b) => {
            const va = a?.[orderField] ?? 0;
            const vb = b?.[orderField] ?? 0;
            if (va === vb) return 0;
            return orderDir === 'desc' ? (va > vb ? -1 : 1) : va < vb ? -1 : 1;
          });
        }
        if (typeof limitNum === 'number') {
          items = items.slice(0, limitNum);
        }
        const docs = items.map((d) => ({ exists: true, data: () => structuredClone(d) }));
        return { docs, size: docs.length };
      },
    });

    const queryMethods = makeQuery();

    return {
      ...queryMethods,
      doc(id: string): FirestoreDocRefLike {
        return {
          id: `${name}/${id}`,
          async get(): Promise<FirestoreDocSnapshotLike> {
            const entry = db.getColMap(name).get(id);
            return entry
              ? { exists: true, data: () => structuredClone(entry.data) }
              : { exists: false, data: () => undefined };
          },
          async set(data: any) {
            const col = db.getColMap(name);
            const cur = col.get(id);
            col.set(id, { version: (cur?.version ?? 0) + 1, data: structuredClone(data) });
          },
        };
      },
    };
  }

  async runTransaction<T>(fn: (tx: FirestoreTransactionLike) => Promise<T>): Promise<T> {
    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const reads = new Map<string, number>();
      const stagedWrites: { col: string; id: string; op: 'set' | 'update'; data: any }[] = [];

      const tx: FirestoreTransactionLike = {
        async get(ref: FirestoreDocRefLike): Promise<FirestoreDocSnapshotLike> {
          if (stagedWrites.length > 0) {
            throw new Error('Firestore transactions require all reads to be executed before all writes.');
          }
          const [colName, docId] = ref.id.split('/');
          const entry = this.collections
            ? undefined
            : undefined;
          void entry;
          const col = getCol(colName);
          const cur = col.get(docId);
          reads.set(ref.id, cur?.version ?? 0);
          // Yield to microtask queue so concurrent transactions truly interleave
          await Promise.resolve();
          return cur
            ? { exists: true, data: () => structuredClone(cur.data) }
            : { exists: false, data: () => undefined };
        },
        set(ref: FirestoreDocRefLike, data: any) {
          const [colName, docId] = ref.id.split('/');
          stagedWrites.push({ col: colName, id: docId, op: 'set', data: structuredClone(data) });
        },
        update(ref: FirestoreDocRefLike, data: any) {
          const [colName, docId] = ref.id.split('/');
          stagedWrites.push({ col: colName, id: docId, op: 'update', data: structuredClone(data) });
        },
      } as FirestoreTransactionLike & { collections?: never };

      const getCol = (colName: string) => this.getColMap(colName);
      const result = await fn(tx);

      // Optimistic Concurrency Check: abort & retry if any read doc version changed
      let conflict = false;
      for (const [key, expectedVersion] of reads.entries()) {
        const [colName, docId] = key.split('/');
        const actualVersion = getCol(colName).get(docId)?.version ?? 0;
        if (actualVersion !== expectedVersion) {
          conflict = true;
          break;
        }
      }

      if (conflict) {
        continue;
      }

      // Commit staged writes atomically
      for (const w of stagedWrites) {
        const col = getCol(w.col);
        const cur = col.get(w.id);
        if (w.op === 'set') {
          col.set(w.id, { version: (cur?.version ?? 0) + 1, data: w.data });
        } else {
          if (!cur) {
            throw new Error(`Document ${w.col}/${w.id} does not exist for update`);
          }
          col.set(w.id, {
            version: cur.version + 1,
            data: { ...structuredClone(cur.data), ...w.data },
          });
        }
      }

      return result;
    }

    throw new Error('Transaction aborted due to persistent contention');
  }
}

async function runPersistenceTests() {
  const {
    app,
    approvalRegistry,
    workflowRegistry,
    serverAuditEvents,
    getWorkflowStore,
    setWorkflowStore,
    InMemoryStore,
    FirestoreStore,
    createWorkflowStoreFromEnv,
  } = await import('../server.ts');

  const results: { name: string; passed: boolean; detail: string }[] = [];
  const logTest = (name: string, passed: boolean, detail: string) => {
    results.push({ name, passed, detail });
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
  };

  const mockSlackApi = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, channel: 'C_TEST_PERSIST', ts: '1700000000.000300' }));
  });
  await new Promise<void>((resolve) => mockSlackApi.listen(0, '127.0.0.1', resolve));
  const mockSlackPort = (mockSlackApi.address() as AddressInfo).port;

  const testServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => testServer.once('listening', resolve));
  const testPort = (testServer.address() as AddressInfo).port;
  const TEST_URL = `http://127.0.0.1:${testPort}`;

  const SIGNING_SECRET = 'persist_test_signing_secret';
  const signSlackPayload = (payloadObj: any) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const formBody = `payload=${encodeURIComponent(JSON.stringify(payloadObj))}`;
    const sigBase = `v0:${timestamp}:${formBody}`;
    const signature =
      'v0=' + crypto.createHmac('sha256', SIGNING_SECRET).update(sigBase, 'utf8').digest('hex');
    return { formBody, timestamp, signature };
  };

  const originalStore = getWorkflowStore();
  const prevWorkStoreEnv = process.env.WORKFLOW_STORE;

  try {
    process.env.SLACK_BOT_TOKEN = 'xoxb-persist-test';
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
    process.env.SLACK_CHANNEL_ID = 'C_TEST_PERSIST';
    process.env.AUTHORIZED_COMMANDERS = 'U_SRE_SARAH,sarah.chen,s-chen-882';
    process.env.SLACK_API_BASE_URL = `http://127.0.0.1:${mockSlackPort}/api/`;

    // 1. WORKFLOW_STORE env factory selection (memory vs firestore vs invalid)
    {
      delete process.env.WORKFLOW_STORE;
      const memDefault = createWorkflowStoreFromEnv();
      process.env.WORKFLOW_STORE = 'memory';
      const memExplicit = createWorkflowStoreFromEnv();
      process.env.WORKFLOW_STORE = 'firestore';
      const fsStore = createWorkflowStoreFromEnv();
      process.env.WORKFLOW_STORE = 'invalid_backend';
      let invalidThrew = false;
      try {
        createWorkflowStoreFromEnv();
      } catch {
        invalidThrew = true;
      }
      process.env.WORKFLOW_STORE = 'memory';

      const passed =
        memDefault instanceof InMemoryStore &&
        memExplicit.mode === 'memory' &&
        fsStore instanceof FirestoreStore &&
        fsStore.mode === 'firestore' &&
        invalidThrew;
      logTest(
        'WORKFLOW_STORE env selects InMemoryStore or FirestoreStore cleanly',
        passed,
        `default=${memDefault.mode}, firestore=${fsStore.mode}, invalidThrew=${invalidThrew}`
      );
    }

    // 2. Concurrent duplicate workflow creation prevented atomically (InMemoryStore & FirestoreStore)
    const mockDb = new MockFirestoreDatabase();
    {
      const store = new FirestoreStore({ client: mockDb });
      setWorkflowStore(store);

      const incConcurrent = `INC-CONC-START-${Date.now()}`;
      const startResponses = await Promise.all([
        fetch(`${TEST_URL}/api/workflows/incidents/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            incident_id: incConcurrent,
            simulation_mode: true,
            notify_slack: false,
            skip_live_claude: true,
          }),
        }),
        fetch(`${TEST_URL}/api/workflows/incidents/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            incident_id: incConcurrent,
            simulation_mode: true,
            notify_slack: false,
            skip_live_claude: true,
          }),
        }),
      ]);

      const statuses = startResponses.map((r) => r.status).sort();
      const bodies = await Promise.all(startResponses.map((r) => r.json()));
      const has409Code = bodies.some((b) => b.code === 'DUPLICATE_INCIDENT_WORKFLOW');
      const passed = statuses[0] === 201 && statuses[1] === 409 && has409Code;
      logTest(
        'Firestore transaction prevents concurrent duplicate workflow creation',
        passed,
        `statuses=${statuses.join(',')}, duplicateCode=${has409Code}`
      );
    }

    // 3. Persistence & Server Restart Recovery via FirestoreStore
    const incRestart = `INC-RESTART-${Date.now()}`;
    let restartApprovalId = '';
    let restartAction = '';
    {
      const storeBeforeRestart = new FirestoreStore({ client: mockDb });
      setWorkflowStore(storeBeforeRestart);

      const startRes = await fetch(`${TEST_URL}/api/workflows/incidents/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: incRestart,
          severity: 'SEV-1',
          service: 'auth-gateway-prod',
          simulation_mode: true,
          notify_slack: true,
          skip_live_claude: true,
        }),
      });
      const startData = await startRes.json();
      restartApprovalId = startData.approval_id;
      restartAction = startData.workflow.proposed_action;

      // Clear in-memory maps completely and instantiate fresh FirestoreStore to simulate Cloud Run cold restart
      workflowRegistry.clear();
      approvalRegistry.clear();
      serverAuditEvents.length = 0;

      const storeAfterRestart = new FirestoreStore({ client: mockDb });
      setWorkflowStore(storeAfterRestart);

      const [statusRes, wfRes, auditRes, dupRes] = await Promise.all([
        fetch(`${TEST_URL}/api/workflows/status`),
        fetch(`${TEST_URL}/api/workflows/incidents/${incRestart}`),
        fetch(`${TEST_URL}/api/audit`),
        fetch(`${TEST_URL}/api/workflows/incidents/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            incident_id: incRestart,
            simulation_mode: true,
            skip_live_claude: true,
          }),
        }),
      ]);

      const [statusData, wfData, auditData, dupData] = await Promise.all([
        statusRes.json(),
        wfRes.json(),
        auditRes.json(),
        dupRes.json(),
      ]);

      const passed =
        startRes.status === 201 &&
        statusData.workflow_store === 'firestore' &&
        wfRes.status === 200 &&
        wfData.workflow?.approval_id === restartApprovalId &&
        wfData.workflow?.phase === 'awaiting_human_approval' &&
        auditRes.status === 200 &&
        auditData.events.some((e: any) => e.action.includes(incRestart)) &&
        dupRes.status === 409 &&
        dupData.code === 'DUPLICATE_INCIDENT_WORKFLOW';
      logTest(
        'Workflow, approval & audit recover after simulated restart on FirestoreStore',
        passed,
        `store=${statusData.workflow_store}, wfPhase=${wfData.workflow?.phase}, dupAfterRestart=${dupRes.status}`
      );
    }

    // 4. Concurrent approval race test (5 parallel approve requests -> strictly 1 succeeds, 4 fail with 409)
    {
      const raceReqs = Array.from({ length: 5 }, () =>
        fetch(`${TEST_URL}/api/workflows/incidents/${incRestart}/decision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approval_id: restartApprovalId,
            action: restartAction,
            decision: 'approve',
            simulation_mode: true,
            human_approval: {
              approved: true,
              commander_id: 's-chen-882',
              commander_name: 'Sarah Chen',
            },
          }),
        })
      );

      const raceResponses = await Promise.all(raceReqs);
      const raceBodies = await Promise.all(raceResponses.map((r) => r.json()));
      const successCount = raceResponses.filter((r) => r.status === 200).length;
      const duplicateCount = raceResponses.filter(
        (r, i) => r.status === 409 && raceBodies[i].code === 'DUPLICATE_APPROVAL'
      ).length;

      const wfAfter = await (await fetch(`${TEST_URL}/api/workflows/incidents/${incRestart}`)).json();
      const passed =
        successCount === 1 &&
        duplicateCount === 4 &&
        wfAfter.workflow?.phase === 'approved_simulated_remediated';
      logTest(
        'Concurrent Firestore approvals enforce single-use execution (1x 200, 4x 409)',
        passed,
        `200s=${successCount}, 409s=${duplicateCount}, phase=${wfAfter.workflow?.phase}`
      );
    }

    // 5. Concurrent Slack interaction + Node.js decision race test
    {
      const incCrossRace = `INC-CROSS-RACE-${Date.now()}`;
      const startRes = await fetch(`${TEST_URL}/api/workflows/incidents/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: incCrossRace,
          simulation_mode: true,
          notify_slack: true,
          skip_live_claude: true,
        }),
      });
      const startData = await startRes.json();
      const store = getWorkflowStore();
      const rec = (await store.getApproval(startData.approval_id))!;

      const signed = signSlackPayload({
        type: 'block_actions',
        user: { id: 'U_SRE_SARAH', username: 'sarah.chen', name: 'Sarah Chen' },
        channel: { id: 'C_TEST_PERSIST' },
        message: { ts: rec.message_ts || '1700000000.000300' },
        actions: [
          {
            action_id: 'approve_remediation',
            value: JSON.stringify({
              approval_id: rec.approval_id,
              incident_id: incCrossRace,
              action: rec.action,
              simulation_mode: true,
              binding_hash: rec.binding_hash,
            }),
          },
        ],
      });

      const [slackRes, nodeRes] = await Promise.all([
        fetch(`${TEST_URL}/api/slack/interactions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'x-slack-request-timestamp': signed.timestamp,
            'x-slack-signature': signed.signature,
          },
          body: signed.formBody,
        }),
        fetch(`${TEST_URL}/api/workflows/incidents/${incCrossRace}/decision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approval_id: rec.approval_id,
            action: rec.action,
            decision: 'reject',
            simulation_mode: true,
            human_approval: { approved: false, commander_id: 's-chen-882', commander_name: 'Sarah Chen' },
          }),
        }),
      ]);

      const statuses = [slackRes.status, nodeRes.status].sort();
      const passed = statuses[0] === 200 && statuses[1] === 409;
      logTest(
        'Concurrent Slack + Console decisions resolve atomically (1x 200, 1x 409)',
        passed,
        `slack=${slackRes.status}, console=${nodeRes.status}`
      );
    }

    // 6. Firestore expiry & SHA-256 binding validation + rejection persistence
    {
      const store = getWorkflowStore();
      const incExp = `INC-FS-EXP-${Date.now()}`;
      const startExp = await (
        await fetch(`${TEST_URL}/api/workflows/incidents/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            incident_id: incExp,
            simulation_mode: true,
            notify_slack: false,
            skip_live_claude: true,
          }),
        })
      ).json();

      // Tamper expiry directly in persisted Firestore store
      const recExp = (await store.getApproval(startExp.approval_id))!;
      recExp.expires_at = Date.now() - 5000;
      await store.saveApproval(recExp);

      const mismatchRes = await fetch(`${TEST_URL}/api/workflows/incidents/${incExp}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_id: startExp.approval_id,
          action: 'apply_hotfix_patch', // mismatched action
          decision: 'approve',
          simulation_mode: true,
          human_approval: { approved: true, commander_id: 's-chen-882', commander_name: 'Sarah Chen' },
        }),
      });

      const expRes = await fetch(`${TEST_URL}/api/workflows/incidents/${incExp}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_id: startExp.approval_id,
          action: startExp.workflow.proposed_action,
          decision: 'approve',
          simulation_mode: true,
          human_approval: { approved: true, commander_id: 's-chen-882', commander_name: 'Sarah Chen' },
        }),
      });

      const persistedExpRec = await store.getApproval(startExp.approval_id);
      const persistedExpWf = await store.getWorkflow(incExp);

      const passed =
        mismatchRes.status === 409 &&
        expRes.status === 410 &&
        persistedExpRec?.status === 'expired' &&
        persistedExpWf?.phase === 'failed';
      logTest(
        'FirestoreStore enforces SHA-256 binding and persists expiry state atomically',
        passed,
        `mismatch=${mismatchRes.status}, expired=${expRes.status}, dbStatus=${persistedExpRec?.status}`
      );
    }

    // 7. InMemoryStore concurrent approval safety
    {
      const memStore = new InMemoryStore();
      setWorkflowStore(memStore);

      const incMem = `INC-MEM-CONC-${Date.now()}`;
      const sData = await (
        await fetch(`${TEST_URL}/api/workflows/incidents/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            incident_id: incMem,
            simulation_mode: true,
            notify_slack: false,
            skip_live_claude: true,
          }),
        })
      ).json();

      const resList = await Promise.all([
        fetch(`${TEST_URL}/api/workflows/incidents/${incMem}/decision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approval_id: sData.approval_id,
            action: sData.workflow.proposed_action,
            decision: 'approve',
            simulation_mode: true,
            human_approval: { approved: true, commander_id: 's-chen-882', commander_name: 'Sarah Chen' },
          }),
        }),
        fetch(`${TEST_URL}/api/workflows/incidents/${incMem}/decision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approval_id: sData.approval_id,
            action: sData.workflow.proposed_action,
            decision: 'approve',
            simulation_mode: true,
            human_approval: { approved: true, commander_id: 's-chen-882', commander_name: 'Sarah Chen' },
          }),
        }),
      ]);
      const okCount = resList.filter((r) => r.status === 200).length;
      const dupCount = resList.filter((r) => r.status === 409).length;
      const passed = okCount === 1 && dupCount === 1;
      logTest(
        'InMemoryStore enforces atomic single-use decision under concurrent requests',
        passed,
        `200s=${okCount}, 409s=${dupCount}`
      );
    }

    // 8. Fail-closed behavior: Firestore failure never silently switches back to memory
    {
      const brokenFirestoreClient: FirestoreClientLike = {
        collection() {
          return {
            doc() {
              return {
                id: 'broken/doc',
                async get() {
                  throw new Error('7 PERMISSION_DENIED: Cloud Firestore API disabled');
                },
                async set() {
                  throw new Error('7 PERMISSION_DENIED: Cloud Firestore API disabled');
                },
              };
            },
            orderBy() {
              return this;
            },
            limit() {
              return this;
            },
            async get() {
              throw new Error('7 PERMISSION_DENIED: Cloud Firestore API disabled');
            },
          };
        },
        async runTransaction() {
          throw new Error('7 PERMISSION_DENIED: Cloud Firestore API disabled');
        },
      };

      setWorkflowStore(new FirestoreStore({ client: brokenFirestoreClient }));
      const statusRes = await fetch(`${TEST_URL}/api/workflows/status`);
      const statusData = await statusRes.json();
      const passed =
        statusRes.status === 503 &&
        statusData.ready === false &&
        statusData.workflow_store === 'firestore' &&
        statusData.workflow_store_connected === false &&
        statusData.code === 'WORKFLOW_STORE_UNAVAILABLE';
      logTest(
        'Firestore connectivity failure fails closed with HTTP 503 (never falls back to memory)',
        passed,
        `HTTP ${statusRes.status}, store=${statusData.workflow_store}, connected=${statusData.workflow_store_connected}, code=${statusData.code}`
      );
    }
  } finally {
    setWorkflowStore(originalStore);
    if (prevWorkStoreEnv === undefined) {
      delete process.env.WORKFLOW_STORE;
    } else {
      process.env.WORKFLOW_STORE = prevWorkStoreEnv;
    }
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_SIGNING_SECRET;
    delete process.env.SLACK_CHANNEL_ID;
    delete process.env.AUTHORIZED_COMMANDERS;
    delete process.env.SLACK_API_BASE_URL;
    testServer.close();
    mockSlackApi.close();
  }

  console.log('\n--- Persistence & Concurrency Test Summary ---');
  const failedCount = results.filter((r) => !r.passed).length;
  console.log(`Total: ${results.length}, Passed: ${results.length - failedCount}, Failed: ${failedCount}`);
  if (failedCount > 0) process.exit(1);
}

runPersistenceTests();
