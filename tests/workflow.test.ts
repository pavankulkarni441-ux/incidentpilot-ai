import http from 'http';
import crypto from 'crypto';
import { AddressInfo } from 'net';

// Prevent server.ts from auto-binding port 3000 when imported for isolated testing
process.env.INCIDENTPILOT_NO_AUTOSTART = 'true';

async function runWorkflowTests() {
  const { app, approvalRegistry, workflowRegistry, serverAuditEvents } = await import('../server.ts');

  const results: { name: string; passed: boolean; detail: string }[] = [];
  const logTest = (name: string, passed: boolean, detail: string) => {
    results.push({ name, passed, detail });
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
  };

  let mockSlackShouldFail = false;
  const slackApiCalls: { url: string; body: any }[] = [];

  const mockSlackApi = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      let parsed: any = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const params = new URLSearchParams(raw);
        const obj: Record<string, any> = {};
        for (const [k, v] of params.entries()) {
          try {
            obj[k] = JSON.parse(v);
          } catch {
            obj[k] = v;
          }
        }
        parsed = Object.keys(obj).length > 0 ? obj : raw;
      }
      slackApiCalls.push({ url: req.url || '', body: parsed });

      if (mockSlackShouldFail) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'internal_slack_error' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          channel: 'C_TEST_WF',
          ts: '1700000000.000200',
        })
      );
    });
  });

  await new Promise<void>((resolve) => mockSlackApi.listen(0, '127.0.0.1', resolve));
  const mockSlackPort = (mockSlackApi.address() as AddressInfo).port;

  const testServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => testServer.once('listening', resolve));
  const testPort = (testServer.address() as AddressInfo).port;
  const TEST_URL = `http://127.0.0.1:${testPort}`;

  const SIGNING_SECRET = 'wf_test_signing_secret';
  const BOT_TOKEN = 'xoxb-wf-test-token';
  const CHANNEL_ID = 'C_TEST_WF';

  const setTestEnv = () => {
    process.env.SLACK_BOT_TOKEN = BOT_TOKEN;
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
    process.env.SLACK_CHANNEL_ID = CHANNEL_ID;
    process.env.AUTHORIZED_COMMANDERS = 'U_SRE_SARAH,sarah.chen,s-chen-882';
    process.env.SLACK_API_BASE_URL = `http://127.0.0.1:${mockSlackPort}/api/`;
  };

  const clearSlackEnv = () => {
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_SIGNING_SECRET;
    delete process.env.SLACK_CHANNEL_ID;
    delete process.env.AUTHORIZED_COMMANDERS;
    delete process.env.SLACK_API_BASE_URL;
  };

  const signSlackPayload = (payloadObj: any, secret = SIGNING_SECRET) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const formBody = `payload=${encodeURIComponent(JSON.stringify(payloadObj))}`;
    const sigBase = `v0:${timestamp}:${formBody}`;
    const signature =
      'v0=' + crypto.createHmac('sha256', secret).update(sigBase, 'utf8').digest('hex');
    return { formBody, timestamp, signature };
  };

  try {
    setTestEnv();

    // 1. GET /api/workflows/status returns active Node.js engine without leaking secrets
    {
      const res = await fetch(`${TEST_URL}/api/workflows/status`);
      const data = await res.json();
      const bodyStr = JSON.stringify(data);
      const passed =
        res.status === 200 &&
        data.engine === 'nodejs_express_native' &&
        data.ready === true &&
        data.simulation_enforced === true &&
        !bodyStr.includes(BOT_TOKEN) &&
        !bodyStr.includes(SIGNING_SECRET);
      logTest(
        'Workflow status endpoint healthy and secret-safe',
        passed,
        `HTTP ${res.status}, engine=${data.engine}, ready=${data.ready}`
      );
    }

    // 2. Reject missing incident_id on workflow start
    {
      const res = await fetch(`${TEST_URL}/api/workflows/incidents/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incident_id: '' }),
      });
      const data = await res.json();
      const passed = res.status === 400 && data.code === 'INVALID_INCIDENT_ID';
      logTest('Missing incident_id rejected with HTTP 400', passed, `HTTP ${res.status}, code=${data.code}`);
    }

    // 3. Reject simulation_mode=false on workflow start
    {
      const res = await fetch(`${TEST_URL}/api/workflows/incidents/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: 'INC-WF-UNSIM',
          simulation_mode: false,
        }),
      });
      const data = await res.json();
      const passed =
        res.status === 400 &&
        data.code === 'SIMULATION_MODE_REQUIRED' &&
        !workflowRegistry.has('INC-WF-UNSIM');
      logTest(
        'simulation_mode=false rejected on workflow start',
        passed,
        `HTTP ${res.status}, code=${data.code}`
      );
    }

    // 4. Unified workflow start -> Claude diagnosis -> Slack notify -> bound approval + audit
    const incApprove = `INC-WF-APPROVE-${Date.now()}`;
    let approveApprovalId = '';
    let approveAction = '';
    {
      slackApiCalls.length = 0;
      const res = await fetch(`${TEST_URL}/api/workflows/incidents/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: incApprove,
          severity: 'SEV-1',
          service: 'auth-gateway-prod',
          alert: { title: 'HikariCP pool exhausted', p99LatencyMs: 1840 },
          simulation_mode: true,
        }),
      });
      const data = await res.json();
      approveApprovalId = data.approval_id;
      approveAction = data.workflow?.proposed_action;

      const postCall = slackApiCalls.find((c) => c.url.includes('chat.postMessage'));
      const hasStartAudit = serverAuditEvents.some((e) =>
        e.action.includes(`Started Incident Investigation Workflow (${incApprove})`)
      );
      const passed =
        res.status === 201 &&
        data.success === true &&
        data.workflow?.phase === 'awaiting_human_approval' &&
        data.workflow?.slack_notified === true &&
        Boolean(approveApprovalId) &&
        Boolean(postCall) &&
        hasStartAudit;
      logTest(
        'Unified workflow start runs diagnosis, Slack notify, bound approval & audit',
        passed,
        `HTTP ${res.status}, phase=${data.workflow?.phase}, slack_notified=${data.workflow?.slack_notified}`
      );
    }

    // 5. Duplicate incident workflow execution prevented with HTTP 409
    {
      const res = await fetch(`${TEST_URL}/api/workflows/incidents/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: incApprove,
          simulation_mode: true,
        }),
      });
      const data = await res.json();
      const passed =
        res.status === 409 &&
        data.code === 'DUPLICATE_INCIDENT_WORKFLOW' &&
        data.existing_workflow?.incident_id === incApprove;
      logTest(
        'Duplicate incident workflow prevented with HTTP 409',
        passed,
        `HTTP ${res.status}, code=${data.code}`
      );
    }

    // 6. Unauthorized engineer rejected on /decision with HTTP 403
    {
      const res = await fetch(`${TEST_URL}/api/workflows/incidents/${incApprove}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_id: approveApprovalId,
          action: approveAction,
          decision: 'approve',
          simulation_mode: true,
          human_approval: {
            approved: true,
            commander_id: 'U_UNTRUSTED_999',
            commander_username: 'untrusted.guest',
            commander_name: 'Untrusted User',
          },
        }),
      });
      const data = await res.json();
      const passed = res.status === 403 && data.code === 'UNAUTHORIZED_COMMANDER';
      logTest('Unauthorized engineer blocked on decision (HTTP 403)', passed, `HTTP ${res.status}, code=${data.code}`);
    }

    // 7. simulation_mode=false rejected on /decision with HTTP 400
    {
      const res = await fetch(`${TEST_URL}/api/workflows/incidents/${incApprove}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_id: approveApprovalId,
          action: approveAction,
          decision: 'approve',
          simulation_mode: false,
          human_approval: {
            approved: true,
            commander_id: 's-chen-882',
            commander_name: 'Sarah Chen',
          },
        }),
      });
      const data = await res.json();
      const passed = res.status === 400 && data.code === 'SIMULATION_MODE_REQUIRED';
      logTest('simulation_mode=false blocked on decision (HTTP 400)', passed, `HTTP ${res.status}, code=${data.code}`);
    }

    // 8. Disallowed action rejected on /decision with HTTP 400
    {
      const res = await fetch(`${TEST_URL}/api/workflows/incidents/${incApprove}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_id: approveApprovalId,
          action: 'kubectl_delete_prod_namespace',
          decision: 'approve',
          simulation_mode: true,
          human_approval: {
            approved: true,
            commander_id: 's-chen-882',
            commander_name: 'Sarah Chen',
          },
        }),
      });
      const data = await res.json();
      const passed = res.status === 400 && data.code === 'INVALID_ACTION';
      logTest('Disallowed action blocked on decision (HTTP 400)', passed, `HTTP ${res.status}, code=${data.code}`);
    }

    // 9. Exact incident/action binding mismatch rejected with HTTP 409
    {
      const res = await fetch(`${TEST_URL}/api/workflows/incidents/${incApprove}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_id: approveApprovalId,
          action: 'apply_hotfix_patch', // different allowlisted action than bound action
          decision: 'approve',
          simulation_mode: true,
          human_approval: {
            approved: true,
            commander_id: 's-chen-882',
            commander_name: 'Sarah Chen',
          },
        }),
      });
      const data = await res.json();
      const passed = res.status === 409 && data.code === 'APPROVAL_MISMATCH';
      logTest('Mismatched action binding blocked (HTTP 409)', passed, `HTTP ${res.status}, code=${data.code}`);
    }

    // 10. Valid Approve decision triggers simulated remediation, updates Slack & audit
    {
      slackApiCalls.length = 0;
      const res = await fetch(`${TEST_URL}/api/workflows/incidents/${incApprove}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_id: approveApprovalId,
          action: approveAction,
          decision: 'approve',
          simulation_mode: true,
          human_approval: {
            approved: true,
            commander_id: 's-chen-882',
            commander_name: 'Sarah Chen',
            commander_role: 'Staff SRE / Incident Commander',
          },
        }),
      });
      const data = await res.json();
      const updateCall = slackApiCalls.find((c) => c.url.includes('chat.update'));
      const passed =
        res.status === 200 &&
        data.success === true &&
        data.decision === 'approved' &&
        data.remediation_executed === true &&
        data.simulation_mode === true &&
        data.workflow_status === 'simulated_success' &&
        data.workflow?.phase === 'approved_simulated_remediated' &&
        Boolean(updateCall) &&
        data.audit_event?.actorType === 'NODEJS_ORCHESTRATOR';
      logTest(
        'Authorized approval runs simulation-only remediation & updates Slack/audit',
        passed,
        `HTTP ${res.status}, phase=${data.workflow?.phase}, slack_updated=${Boolean(updateCall)}`
      );
    }

    // 11. Single-use approval enforcement: duplicate approval returns HTTP 409
    {
      const res = await fetch(`${TEST_URL}/api/workflows/incidents/${incApprove}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_id: approveApprovalId,
          action: approveAction,
          decision: 'approve',
          simulation_mode: true,
          human_approval: {
            approved: true,
            commander_id: 's-chen-882',
            commander_name: 'Sarah Chen',
          },
        }),
      });
      const data = await res.json();
      const passed = res.status === 409 && data.code === 'DUPLICATE_APPROVAL';
      logTest('Duplicate approval blocked (HTTP 409)', passed, `HTTP ${res.status}, code=${data.code}`);
    }

    // 12. Rejection workflow never triggers remediation
    const incReject = `INC-WF-REJECT-${Date.now()}`;
    {
      const startRes = await fetch(`${TEST_URL}/api/workflows/incidents/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incident_id: incReject, simulation_mode: true }),
      });
      const startData = await startRes.json();
      const rejectApprovalId = startData.approval_id;
      const rejectAction = startData.workflow?.proposed_action;

      const res = await fetch(`${TEST_URL}/api/workflows/incidents/${incReject}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_id: rejectApprovalId,
          action: rejectAction,
          decision: 'reject',
          simulation_mode: true,
          rejection_reason: 'Canary metrics stabilizing naturally',
          human_approval: {
            approved: false,
            commander_id: 's-chen-882',
            commander_name: 'Sarah Chen',
          },
        }),
      });
      const data = await res.json();
      const passed =
        res.status === 200 &&
        data.success === true &&
        data.decision === 'rejected' &&
        data.remediation_executed === false &&
        data.workflow?.phase === 'rejected' &&
        !data.workflow?.remediation_result;
      logTest(
        'Rejection never triggers remediation & marks workflow rejected',
        passed,
        `HTTP ${res.status}, remediation_executed=${data.remediation_executed}, phase=${data.workflow?.phase}`
      );
    }

    // 13. Expired approval rejected with HTTP 410
    const incExpired = `INC-WF-EXPIRED-${Date.now()}`;
    {
      const startRes = await fetch(`${TEST_URL}/api/workflows/incidents/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incident_id: incExpired, simulation_mode: true }),
      });
      const startData = await startRes.json();
      const rec = approvalRegistry.get(startData.approval_id)!;
      rec.expires_at = Date.now() - 1000;

      const res = await fetch(`${TEST_URL}/api/workflows/incidents/${incExpired}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_id: startData.approval_id,
          action: startData.workflow.proposed_action,
          decision: 'approve',
          simulation_mode: true,
          human_approval: {
            approved: true,
            commander_id: 's-chen-882',
            commander_name: 'Sarah Chen',
          },
        }),
      });
      const data = await res.json();
      const passed = res.status === 410 && data.code === 'APPROVAL_EXPIRED';
      logTest('Expired workflow approval rejected (HTTP 410)', passed, `HTTP ${res.status}, code=${data.code}`);
    }

    // 14. Cross-channel sync: workflow started via Node.js -> approved via Slack interaction -> workflow state updated
    const incCross = `INC-WF-SLACK-SYNC-${Date.now()}`;
    {
      const startRes = await fetch(`${TEST_URL}/api/workflows/incidents/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incident_id: incCross, simulation_mode: true }),
      });
      const startData = await startRes.json();
      const rec = approvalRegistry.get(startData.approval_id)!;

      const interactionPayload = {
        type: 'block_actions',
        user: { id: 'U_SRE_SARAH', username: 'sarah.chen', name: 'Sarah Chen' },
        channel: { id: CHANNEL_ID },
        message: { ts: rec.message_ts || '1700000000.000200' },
        actions: [
          {
            action_id: 'approve_remediation',
            value: JSON.stringify({
              approval_id: rec.approval_id,
              incident_id: incCross,
              action: rec.action,
              simulation_mode: true,
              binding_hash: rec.binding_hash,
            }),
          },
        ],
      };
      const signed = signSlackPayload(interactionPayload);
      const slackRes = await fetch(`${TEST_URL}/api/slack/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-slack-request-timestamp': signed.timestamp,
          'x-slack-signature': signed.signature,
        },
        body: signed.formBody,
      });

      const wfRes = await fetch(`${TEST_URL}/api/workflows/incidents/${incCross}`);
      const wfData = await wfRes.json();
      const passed =
        slackRes.status === 200 &&
        wfRes.status === 200 &&
        wfData.workflow?.phase === 'approved_simulated_remediated' &&
        wfData.workflow?.remediation_result?.workflow_status === 'simulated_success';
      logTest(
        'Cross-channel sync: Slack approval updates Node.js workflow state',
        passed,
        `slackHTTP=${slackRes.status}, workflowPhase=${wfData.workflow?.phase}`
      );
    }

    // 15. Graceful handling when Slack Web API returns HTTP 500 during workflow start
    const incSlackErr = `INC-WF-SLACK-ERR-${Date.now()}`;
    {
      mockSlackShouldFail = true;
      const res = await fetch(`${TEST_URL}/api/workflows/incidents/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incident_id: incSlackErr, simulation_mode: true }),
      });
      const data = await res.json();
      mockSlackShouldFail = false;

      const passed =
        res.status === 201 &&
        data.success === true &&
        data.workflow?.phase === 'awaiting_human_approval' &&
        data.workflow?.slack_notified === false &&
        data.workflow?.slack_status === 'slack_api_error' &&
        Boolean(data.approval_id);
      logTest(
        'Graceful Slack failure during workflow start preserves approval flow',
        passed,
        `HTTP ${res.status}, slack_status=${data.workflow?.slack_status}`
      );
    }

    // 16. Legacy n8n endpoints remain mounted and operational during migration
    {
      const res = await fetch(`${TEST_URL}/api/webhook/status`);
      const data = await res.json();
      const passed = res.status === 200 && data.simulation_enforced === true && data.env_variable === 'N8N_WEBHOOK_URL';
      logTest('Legacy n8n /api/webhook/status preserved', passed, `HTTP ${res.status}, configured=${data.configured}`);
    }

    // 17. Dashboard immediate rejection path (skip_live_claude=true -> decision=reject -> audit)
    const incUiRej = `INC-WF-UI-REJECT-${Date.now()}`;
    {
      const startRes = await fetch(`${TEST_URL}/api/workflows/incidents/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: incUiRej,
          simulation_mode: true,
          notify_slack: false,
          skip_live_claude: true,
        }),
      });
      const startData = await startRes.json();
      const decRes = await fetch(`${TEST_URL}/api/workflows/incidents/${incUiRej}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_id: startData.approval_id,
          action: startData.workflow?.proposed_action,
          decision: 'reject',
          simulation_mode: true,
          rejection_reason: 'Operator chose manual pool inspection',
          human_approval: {
            approved: false,
            commander_id: 's-chen-882',
            commander_name: 'Sarah Chen',
            commander_role: 'Staff SRE / Incident Commander',
          },
        }),
      });
      const decData = await decRes.json();
      const hasRejectAudit = serverAuditEvents.some(
        (e) => e.actorType === 'NODEJS_ORCHESTRATOR' && e.action.includes(`Workflow Remediation Rejected (${incUiRej})`)
      );
      const passed =
        startRes.status === 201 &&
        decRes.status === 200 &&
        decData.decision === 'rejected' &&
        decData.remediation_executed === false &&
        decData.workflow?.phase === 'rejected' &&
        hasRejectAudit;
      logTest(
        'Dashboard rejection workflow validates, records audit & skips remediation',
        passed,
        `startHTTP=${startRes.status}, decHTTP=${decRes.status}, executed=${decData.remediation_executed}, audited=${hasRejectAudit}`
      );
    }

    // 18. Claude status accurately reflects fallback_active vs live_inference_working
    {
      const res = await fetch(`${TEST_URL}/api/claude/status`);
      const data = await res.json();
      const passed =
        res.status === 200 &&
        typeof data.configured === 'boolean' &&
        typeof data.live_inference_working === 'boolean' &&
        typeof data.fallback_active === 'boolean' &&
        (!data.configured ? data.inference_status === 'unconfigured' : ['untested', 'live_ok', 'fallback_active'].includes(data.inference_status)) &&
        !(data.fallback_active && data.live_inference_working);
      logTest(
        'Claude status accurately separates configured vs live vs fallback',
        passed,
        `configured=${data.configured}, inference_status=${data.inference_status}, live=${data.live_inference_working}, fallback=${data.fallback_active}`
      );
    }
  } finally {
    clearSlackEnv();
    testServer.close();
    mockSlackApi.close();
  }

  console.log('\n--- Node.js Workflow Orchestrator Test Summary ---');
  const failedCount = results.filter((r) => !r.passed).length;
  console.log(`Total: ${results.length}, Passed: ${results.length - failedCount}, Failed: ${failedCount}`);
  if (failedCount > 0) process.exit(1);
}

runWorkflowTests();
