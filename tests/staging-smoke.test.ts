/**
 * Phase 8: Safe Staging-Only Cloud Run + Firestore Smoke Test
 *
 * Usage:
 *   1) Against a deployed Cloud Run staging service (requires WORKFLOW_STORE=firestore on target):
 *      STAGING_URL="https://your-staging-service.run.app" npm run test:staging-smoke
 *
 *   2) Verify persistence after a Cloud Run instance restart / new revision:
 *      STAGING_URL="https://your-staging-service.run.app" npm run test:staging-smoke -- --verify-incident=INC-STG-SMOKE-...
 *
 *   3) Direct Cloud Run ADC + Firestore probe (when running inside Cloud Run or local ADC):
 *      npm run test:staging-smoke -- --probe-firestore
 *
 * Safety Guarantees:
 *   - Uses skip_live_claude=true and notify_slack=false to conserve API credits and avoid external alert noise.
 *   - Enforces simulation_mode=true on all workflow starts and approvals.
 *   - Fails loudly if target Cloud Run service reports workflow_store !== "firestore" (never silently accepts memory).
 *   - Never exposes secrets or executes infrastructure commands.
 */

import { Firestore } from '@google-cloud/firestore';
import crypto from 'crypto';
import { FirestoreStore } from '../storage/workflowStore';

interface SmokeStep {
  name: string;
  passed: boolean;
  detail: string;
}

function getArg(flag: string): string | undefined {
  const prefix = `${flag}=`;
  const match = process.argv.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function probeDirectFirestore(): Promise<{ ok: boolean; steps: SmokeStep[]; blocker?: string }> {
  const steps: SmokeStep[] = [];
  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const databaseId = process.env.FIRESTORE_DATABASE_ID?.trim() || '(default)';

  try {
    const firestoreOpts: Record<string, any> = { ignoreUndefinedProperties: true };
    if (projectId) firestoreOpts.projectId = projectId;
    if (databaseId && databaseId !== '(default)') firestoreOpts.databaseId = databaseId;

    const client = new Firestore(firestoreOpts);
    const smokePrefix = 'incidentpilot_smoke_';
    const store = new FirestoreStore({
      client: client as any,
      collectionPrefix: smokePrefix,
    });

    const conn = await store.verifyConnectivity();
    if (!conn.ok) {
      steps.push({
        name: 'Firestore ADC connectivity & IAM check',
        passed: false,
        detail: conn.error,
      });
      return { ok: false, steps, blocker: conn.error };
    }
    steps.push({
      name: 'Firestore ADC connectivity & IAM check',
      passed: true,
      detail: `Connected to Firestore database=${databaseId}`,
    });

    // Safe non-destructive lifecycle + expiry test in isolated incidentpilot_smoke_* collections
    const incId = `INC-ADC-SMOKE-${Date.now()}`;
    const approvalId = `appr-adc-smoke-${Date.now()}`;
    const action = 'scale_connection_pool_canary';
    const expectedHash = (id: string, act: string) =>
      crypto.createHash('sha256').update(`${id}:${act}:simulation_only`).digest('hex');

    const nowIso = new Date().toISOString();
    const createRes = await store.createWorkflowUnique({
      workflow_id: `wf-smoke-${Date.now()}`,
      incident_id: incId,
      severity: 'SEV-2',
      service: 'staging-smoke-probe',
      phase: 'awaiting_human_approval',
      approval_id: approvalId,
      proposed_action: action,
      slack_notified: false,
      simulation_mode: true,
      created_at: nowIso,
      updated_at: nowIso,
    });
    const dupRes = await store.createWorkflowUnique({
      workflow_id: `wf-smoke-dup-${Date.now()}`,
      incident_id: incId,
      severity: 'SEV-2',
      service: 'staging-smoke-probe',
      phase: 'awaiting_human_approval',
      slack_notified: false,
      simulation_mode: true,
      created_at: nowIso,
      updated_at: nowIso,
    });

    steps.push({
      name: 'Direct Firestore unique workflow transaction & duplicate rejection',
      passed: createRes.created === true && dupRes.created === false,
      detail: `created=${createRes.created}, duplicateRejected=${!dupRes.created}`,
    });

    // Save expired approval and confirm atomic rejection
    await store.saveApproval({
      approval_id: approvalId,
      incident_id: incId,
      action,
      simulation_mode: true,
      binding_hash: expectedHash(incId, action),
      diagnosis_source: 'demo_fallback',
      status: 'pending',
      created_at: Date.now() - 120000,
      expires_at: Date.now() - 5000,
    });

    const expTx = await store.resolveApprovalTransaction({
      approvalId,
      incidentId: incId,
      action,
      expectedBindingHash: expectedHash,
      decision: 'approve',
      decidedBy: { id: 's-chen-882', name: 'Sarah Chen' },
      decidedAt: new Date().toISOString(),
      nowMs: Date.now(),
      requireWorkflowExists: true,
    });

    steps.push({
      name: 'Direct Firestore expired approval transaction rejection',
      passed: !expTx.ok && expTx.outcome === 'APPROVAL_EXPIRED',
      detail: `outcome=${expTx.outcome}`,
    });

    // Cleanup smoke documents so isolated smoke collections stay tidy
    await client.collection(`${smokePrefix}workflows`).doc(incId).delete();
    await client.collection(`${smokePrefix}approvals`).doc(approvalId).delete();

    return { ok: steps.every((s) => s.passed), steps };
  } catch (err: any) {
    const msg = err?.message || 'Unknown Firestore probe failure';
    steps.push({
      name: 'Firestore ADC connectivity & IAM check',
      passed: false,
      detail: msg,
    });
    return { ok: false, steps, blocker: msg };
  }
}

async function verifyPersistedIncident(targetUrl: string, incidentId: string): Promise<SmokeStep[]> {
  const steps: SmokeStep[] = [];
  const baseUrl = targetUrl.replace(/\/$/, '');

  const [statusRes, wfRes, approvalsRes, auditRes, dupRes] = await Promise.all([
    fetch(`${baseUrl}/api/workflows/status`),
    fetch(`${baseUrl}/api/workflows/incidents/${encodeURIComponent(incidentId)}`),
    fetch(`${baseUrl}/api/slack/approvals`),
    fetch(`${baseUrl}/api/audit`),
    fetch(`${baseUrl}/api/workflows/incidents/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        incident_id: incidentId,
        simulation_mode: true,
        notify_slack: false,
        skip_live_claude: true,
      }),
    }),
  ]);

  const [statusData, wfData, approvalsData, auditData, dupData] = await Promise.all([
    statusRes.json().catch(() => ({})),
    wfRes.json().catch(() => ({})),
    approvalsRes.json().catch(() => ({})),
    auditRes.json().catch(() => ({})),
    dupRes.json().catch(() => ({})),
  ]);

  steps.push({
    name: 'Staging service uses Firestore store (post-restart)',
    passed: statusRes.status === 200 && statusData.workflow_store === 'firestore' && statusData.workflow_store_connected === true,
    detail: `HTTP ${statusRes.status}, store=${statusData.workflow_store}, connected=${statusData.workflow_store_connected}`,
  });

  const matchingApproval = Array.isArray(approvalsData.approvals)
    ? approvalsData.approvals.find((a: any) => a.incident_id === incidentId)
    : undefined;
  const matchingAudit = Array.isArray(auditData.events)
    ? auditData.events.filter((e: any) => typeof e.action === 'string' && e.action.includes(incidentId))
    : [];

  steps.push({
    name: `Workflow "${incidentId}" survived restart / new instance`,
    passed: wfRes.status === 200 && wfData.workflow?.incident_id === incidentId && wfData.workflow?.simulation_mode === true,
    detail: `HTTP ${wfRes.status}, phase=${wfData.workflow?.phase}`,
  });

  steps.push({
    name: `Approval record for "${incidentId}" survived restart`,
    passed: approvalsRes.status === 200 && Boolean(matchingApproval),
    detail: `status=${matchingApproval?.status || 'missing'}, approval_id=${matchingApproval?.approval_id || 'none'}`,
  });

  steps.push({
    name: `Audit trail for "${incidentId}" survived restart`,
    passed: auditRes.status === 200 && matchingAudit.length >= 1,
    detail: `eventsFound=${matchingAudit.length}`,
  });

  steps.push({
    name: `Duplicate creation for "${incidentId}" still rejected after restart`,
    passed: dupRes.status === 409 && dupData.code === 'DUPLICATE_INCIDENT_WORKFLOW',
    detail: `HTTP ${dupRes.status}, code=${dupData.code}`,
  });

  return steps;
}

async function runHttpStagingSmoke(targetUrl: string): Promise<{ ok: boolean; steps: SmokeStep[]; incidentId?: string }> {
  const steps: SmokeStep[] = [];
  const baseUrl = targetUrl.replace(/\/$/, '');

  // 1. Check health & enforce WORKFLOW_STORE=firestore on target
  const [healthRes, statusRes] = await Promise.all([
    fetch(`${baseUrl}/api/health`),
    fetch(`${baseUrl}/api/workflows/status`),
  ]);

  const healthContentType = healthRes.headers.get('content-type') || '';
  const statusContentType = statusRes.headers.get('content-type') || '';
  if (!healthContentType.includes('application/json') || !statusContentType.includes('application/json')) {
    steps.push({
      name: 'Staging endpoint reachable without auth redirect',
      passed: false,
      detail: `Expected JSON from ${baseUrl}, received HTTP ${statusRes.status} (${statusContentType}). Provide a direct staging Cloud Run URL or authenticated session.`,
    });
    return { ok: false, steps };
  }

  const healthData: any = await healthRes.json();
  const statusData: any = await statusRes.json();

  steps.push({
    name: 'Staging /api/health healthy',
    passed: healthRes.status === 200 && healthData.status === 'ok',
    detail: `HTTP ${healthRes.status}, status=${healthData.status}`,
  });

  const isFirestoreActive =
    statusRes.status === 200 &&
    statusData.ready === true &&
    statusData.workflow_store === 'firestore' &&
    statusData.workflow_store_connected === true &&
    statusData.simulation_enforced === true;

  steps.push({
    name: 'Staging Cloud Run runs WORKFLOW_STORE=firestore with simulation_enforced=true',
    passed: isFirestoreActive,
    detail: `HTTP ${statusRes.status}, store=${statusData.workflow_store}, connected=${statusData.workflow_store_connected}, error=${statusData.error || 'none'}`,
  });

  if (!isFirestoreActive) {
    return { ok: false, steps };
  }

  // 2. Create staging smoke incident workflow (skip_live_claude=true, notify_slack=false)
  const incidentId = `INC-STG-SMOKE-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
  const startRes = await fetch(`${baseUrl}/api/workflows/incidents/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      incident_id: incidentId,
      severity: 'SEV-2',
      service: 'staging-smoke-check',
      simulation_mode: true,
      notify_slack: false,
      skip_live_claude: true,
    }),
  });
  const startData: any = await startRes.json();
  const approvalId = startData.approval_id;
  const proposedAction = startData.workflow?.proposed_action;

  steps.push({
    name: 'Create staging incident workflow (simulation_mode=true)',
    passed:
      startRes.status === 201 &&
      startData.success === true &&
      startData.workflow?.phase === 'awaiting_human_approval' &&
      startData.workflow?.simulation_mode === true &&
      Boolean(approvalId) &&
      Boolean(proposedAction),
    detail: `HTTP ${startRes.status}, incident=${incidentId}, approval_id=${approvalId}, action=${proposedAction}`,
  });

  if (startRes.status !== 201) {
    return { ok: false, steps, incidentId };
  }

  // 3. Retrieve workflow & approval record
  const [getWfRes, getApprRes] = await Promise.all([
    fetch(`${baseUrl}/api/workflows/incidents/${encodeURIComponent(incidentId)}`),
    fetch(`${baseUrl}/api/slack/approvals`),
  ]);
  const getWfData: any = await getWfRes.json();
  const getApprData: any = await getApprRes.json();
  const persistedPendingAppr = Array.isArray(getApprData.approvals)
    ? getApprData.approvals.find((a: any) => a.approval_id === approvalId)
    : undefined;

  steps.push({
    name: 'Retrieve workflow & pending approval record from Firestore',
    passed:
      getWfRes.status === 200 &&
      getWfData.workflow?.incident_id === incidentId &&
      Boolean(persistedPendingAppr) &&
      persistedPendingAppr.status === 'pending',
    detail: `wfHTTP=${getWfRes.status}, approvalStatus=${persistedPendingAppr?.status}`,
  });

  // 4. Safety checks: duplicate start, unauthorized commander, mismatched action, simulation_mode=false
  const [dupRes, unauthRes, mismatchRes, unsimRes] = await Promise.all([
    fetch(`${baseUrl}/api/workflows/incidents/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        incident_id: incidentId,
        simulation_mode: true,
        notify_slack: false,
        skip_live_claude: true,
      }),
    }),
    fetch(`${baseUrl}/api/workflows/incidents/${encodeURIComponent(incidentId)}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approval_id: approvalId,
        action: proposedAction,
        decision: 'approve',
        simulation_mode: true,
        human_approval: {
          approved: true,
          commander_id: 'unauthorized-smoke-user',
          commander_name: 'Unauthorized Tester',
        },
      }),
    }),
    fetch(`${baseUrl}/api/workflows/incidents/${encodeURIComponent(incidentId)}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approval_id: approvalId,
        action: proposedAction === 'apply_hotfix_patch' ? 'drain_stale_connections' : 'apply_hotfix_patch',
        decision: 'approve',
        simulation_mode: true,
        human_approval: {
          approved: true,
          commander_id: 's-chen-882',
          commander_name: 'Sarah Chen',
        },
      }),
    }),
    fetch(`${baseUrl}/api/workflows/incidents/${encodeURIComponent(incidentId)}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approval_id: approvalId,
        action: proposedAction,
        decision: 'approve',
        simulation_mode: false,
        human_approval: {
          approved: true,
          commander_id: 's-chen-882',
          commander_name: 'Sarah Chen',
        },
      }),
    }),
  ]);

  const [dupData, unauthData, mismatchData, unsimData]: any[] = await Promise.all([
    dupRes.json(),
    unauthRes.json(),
    mismatchRes.json(),
    unsimRes.json(),
  ]);

  steps.push({
    name: 'Duplicate incident creation rejected (HTTP 409)',
    passed: dupRes.status === 409 && dupData.code === 'DUPLICATE_INCIDENT_WORKFLOW',
    detail: `HTTP ${dupRes.status}, code=${dupData.code}`,
  });

  steps.push({
    name: 'Unauthorized commander approval rejected (HTTP 403)',
    passed: unauthRes.status === 403 && unauthData.code === 'UNAUTHORIZED_COMMANDER',
    detail: `HTTP ${unauthRes.status}, code=${unauthData.code}`,
  });

  steps.push({
    name: 'Mismatched incident/action binding rejected (HTTP 409)',
    passed: mismatchRes.status === 409 && mismatchData.code === 'APPROVAL_MISMATCH',
    detail: `HTTP ${mismatchRes.status}, code=${mismatchData.code}`,
  });

  steps.push({
    name: 'simulation_mode=false rejected (HTTP 400)',
    passed: unsimRes.status === 400 && unsimData.code === 'SIMULATION_MODE_REQUIRED',
    detail: `HTTP ${unsimRes.status}, code=${unsimData.code}`,
  });

  // 5. Concurrent approval race (5 parallel approve requests -> strictly 1x 200, 4x 409)
  const raceResponses = await Promise.all(
    Array.from({ length: 5 }, () =>
      fetch(`${baseUrl}/api/workflows/incidents/${encodeURIComponent(incidentId)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_id: approvalId,
          action: proposedAction,
          decision: 'approve',
          simulation_mode: true,
          human_approval: {
            approved: true,
            commander_id: 's-chen-882',
            commander_name: 'Sarah Chen',
            commander_role: 'Staff SRE / Incident Commander',
          },
        }),
      })
    )
  );
  const raceBodies: any[] = await Promise.all(raceResponses.map((r) => r.json()));
  const winIdx = raceResponses.findIndex((r) => r.status === 200);
  const winCount = raceResponses.filter((r) => r.status === 200).length;
  const dupDecisionCount = raceResponses.filter(
    (r, idx) => r.status === 409 && raceBodies[idx].code === 'DUPLICATE_APPROVAL'
  ).length;
  const winBody = winIdx >= 0 ? raceBodies[winIdx] : undefined;

  steps.push({
    name: 'Concurrent approvals enforce single-use & simulation_mode=true (1x 200, 4x 409)',
    passed:
      winCount === 1 &&
      dupDecisionCount === 4 &&
      winBody?.simulation_mode === true &&
      winBody?.workflow_status === 'simulated_success',
    detail: `200s=${winCount}, 409s=${dupDecisionCount}, workflow_status=${winBody?.workflow_status}`,
  });

  // 6. Retrieve updated workflow, updated approval, and persisted audit events
  const [finalWfRes, finalApprRes, auditRes] = await Promise.all([
    fetch(`${baseUrl}/api/workflows/incidents/${encodeURIComponent(incidentId)}`),
    fetch(`${baseUrl}/api/slack/approvals`),
    fetch(`${baseUrl}/api/audit`),
  ]);
  const [finalWfData, finalApprData, auditData]: any[] = await Promise.all([
    finalWfRes.json(),
    finalApprRes.json(),
    auditRes.json(),
  ]);

  const finalAppr = Array.isArray(finalApprData.approvals)
    ? finalApprData.approvals.find((a: any) => a.approval_id === approvalId)
    : undefined;
  const matchingAudits = Array.isArray(auditData.events)
    ? auditData.events.filter((e: any) => typeof e.action === 'string' && e.action.includes(incidentId))
    : [];

  steps.push({
    name: 'Updated workflow & approval state persisted in Firestore',
    passed:
      finalWfRes.status === 200 &&
      finalWfData.workflow?.phase === 'approved_simulated_remediated' &&
      finalWfData.workflow?.remediation_result?.simulation_mode === true &&
      finalAppr?.status === 'approved',
    detail: `wfPhase=${finalWfData.workflow?.phase}, approvalStatus=${finalAppr?.status}`,
  });

  steps.push({
    name: 'Audit trail events persisted for incident lifecycle & blocked attempts',
    passed: auditRes.status === 200 && matchingAudits.length >= 4,
    detail: `auditEventsForIncident=${matchingAudits.length}`,
  });

  return { ok: steps.every((s) => s.passed), steps, incidentId };
}

async function main() {
  const targetUrl = getArg('--target') || process.env.STAGING_URL?.trim();
  const verifyIncidentId = getArg('--verify-incident');
  const probeFirestoreFlag = hasFlag('--probe-firestore') || process.env.WORKFLOW_STORE === 'firestore';

  const allSteps: SmokeStep[] = [];
  let createdIncidentId: string | undefined;

  if (probeFirestoreFlag || !targetUrl) {
    console.log('=== Direct Cloud Run ADC -> Firestore Probe ===');
    const fsResult = await probeDirectFirestore();
    allSteps.push(...fsResult.steps);
    for (const s of fsResult.steps) {
      console.log(`[${s.passed ? 'PASS' : 'FAIL'}] ${s.name}: ${s.detail}`);
    }
  }

  if (targetUrl) {
    if (verifyIncidentId) {
      console.log(`\n=== Staging Post-Restart Verification (${targetUrl}, incident=${verifyIncidentId}) ===`);
      const verifySteps = await verifyPersistedIncident(targetUrl, verifyIncidentId);
      allSteps.push(...verifySteps);
      for (const s of verifySteps) {
        console.log(`[${s.passed ? 'PASS' : 'FAIL'}] ${s.name}: ${s.detail}`);
      }
    } else {
      console.log(`\n=== Live Cloud Run Staging Smoke Test (${targetUrl}) ===`);
      const httpResult = await runHttpStagingSmoke(targetUrl);
      createdIncidentId = httpResult.incidentId;
      allSteps.push(...httpResult.steps);
      for (const s of httpResult.steps) {
        console.log(`[${s.passed ? 'PASS' : 'FAIL'}] ${s.name}: ${s.detail}`);
      }
      if (createdIncidentId && httpResult.ok) {
        console.log(
          `\nNext: Restart or deploy a new Cloud Run staging instance, then verify persistence with:\n` +
            `  STAGING_URL="${targetUrl}" npm run test:staging-smoke -- --verify-incident=${createdIncidentId}`
        );
      }
    }
  } else {
    console.log('\n[INFO] No STAGING_URL or --target=<url> provided; skipped remote Cloud Run HTTP smoke test.');
  }

  const failed = allSteps.filter((s) => !s.passed);
  console.log('\n--- Staging Smoke Test Summary ---');
  console.log(`Total: ${allSteps.length}, Passed: ${allSteps.length - failed.length}, Failed: ${failed.length}`);
  if (allSteps.length === 0 || failed.length > 0) {
    process.exit(1);
  }
}

main();
