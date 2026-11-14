import http from 'http';
import crypto from 'crypto';
import { AddressInfo } from 'net';

// Prevent server.ts from auto-binding port 3000 when imported for isolated testing
process.env.INCIDENTPILOT_NO_AUTOSTART = 'true';

async function runSlackTests() {
  const { app, approvalRegistry, serverAuditEvents } = await import('../server.ts');

  const results: { name: string; passed: boolean; detail: string }[] = [];
  const logTest = (name: string, passed: boolean, detail: string) => {
    results.push({ name, passed, detail });
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
  };

  // Capture calls sent to mock Slack Web API
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          channel: 'C_TEST_INCIDENTS',
          ts: '1700000000.000100',
        })
      );
    });
  });

  await new Promise<void>((resolve) => mockSlackApi.listen(0, '127.0.0.1', resolve));
  const mockSlackPort = (mockSlackApi.address() as AddressInfo).port;

  // Start isolated IncidentPilot Express server on ephemeral port
  const testServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => testServer.once('listening', resolve));
  const testPort = (testServer.address() as AddressInfo).port;
  const TEST_URL = `http://127.0.0.1:${testPort}`;

  const SIGNING_SECRET = 'test_signing_secret_incidentpilot_phase3';
  const BOT_TOKEN = 'xoxb-test-token-phase3';
  const CHANNEL_ID = 'C_TEST_INCIDENTS';

  const setTestSlackEnv = () => {
    process.env.SLACK_BOT_TOKEN = BOT_TOKEN;
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
    process.env.SLACK_CHANNEL_ID = CHANNEL_ID;
    process.env.AUTHORIZED_COMMANDERS = 'U_SRE_SARAH,sarah.chen';
    process.env.SLACK_API_BASE_URL = `http://127.0.0.1:${mockSlackPort}/api/`;
  };

  const clearTestSlackEnv = () => {
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_SIGNING_SECRET;
    delete process.env.SLACK_CHANNEL_ID;
    delete process.env.AUTHORIZED_COMMANDERS;
    delete process.env.SLACK_API_BASE_URL;
  };

  const signSlackPayload = (
    payloadObj: any,
    secret = SIGNING_SECRET,
    timestamp = Math.floor(Date.now() / 1000)
  ) => {
    const formBody = `payload=${encodeURIComponent(JSON.stringify(payloadObj))}`;
    const sigBase = `v0:${timestamp}:${formBody}`;
    const signature =
      'v0=' + crypto.createHmac('sha256', secret).update(sigBase, 'utf8').digest('hex');
    return { formBody, timestamp: String(timestamp), signature };
  };

  const sampleDiagnosis = {
    summary: 'HikariCP pool exhaustion on auth-gateway-prod after v2.14.8 canary rollout.',
    probable_root_cause: 'maximumPoolSize=10 insufficient under burst token revocation scans.',
    confidence: 94.2,
    observed_evidence: {
      culprit_resource: 'auth-gateway-prod',
      trace_id: 'tr-8892-hikari',
      culprit_span: 'HikariPool.getConnection()',
      duration_ms: 1240,
      baseline_ms: 12,
      deploy_commit: 'v2.14.8 (3a8f9c1)',
      key_log_lines: ['[CRIT] HikariPool-1 - Connection is not available after 30005ms.'],
    },
    ai_hypothesis: {
      title: 'HikariCP Connection Pool Exhaustion',
      explanation: 'Connection checkout latency jumped 100x following v2.14.8.',
      affected_components: ['auth-gateway-canary-01', 'auth-gateway-canary-02'],
    },
    proposed_remediation: {
      action: 'scale_connection_pool_canary',
      command: 'kubectl patch configmap auth-gateway-config --dry-run=client',
      old_config: 'maximum-pool-size: 10',
      new_config: 'maximum-pool-size: 60',
      estimated_mitigation_seconds: 45,
      flags: [],
    },
    risks: ['Brief 150ms socket renegotiation during pool resize'],
  };

  try {
    // 1. Slack status when unconfigured does not expose secrets
    clearTestSlackEnv();
    {
      const res = await fetch(`${TEST_URL}/api/slack/status`);
      const data = await res.json();
      const rawText = JSON.stringify(data);
      const passed =
        res.status === 200 &&
        data.configured === false &&
        Array.isArray(data.missing_variables) &&
        data.missing_variables.includes('SLACK_BOT_TOKEN') &&
        !rawText.includes(BOT_TOKEN) &&
        !rawText.includes(SIGNING_SECRET);
      logTest(
        'Slack status reports unconfigured cleanly without secrets',
        passed,
        `HTTP ${res.status}, configured=${data.configured}, missing=${data.missing_variables?.join(',')}`
      );
    }

    // 2. Slack notify returns HTTP 503 when Slack credentials are missing
    {
      const res = await fetch(`${TEST_URL}/api/slack/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: 'INC-4892',
          severity: 'SEV-1',
          service: 'auth-gateway-prod',
          diagnosis: sampleDiagnosis,
          is_fallback: true,
        }),
      });
      const data = await res.json();
      const passed = res.status === 503 && data.code === 'SLACK_NOT_CONFIGURED';
      logTest('Slack notify rejects missing configuration with HTTP 503', passed, `HTTP ${res.status}, code=${data.code}`);
    }

    // Configure Slack test credentials
    setTestSlackEnv();

    // 3. Slack status when configured never leaks credentials
    {
      const res = await fetch(`${TEST_URL}/api/slack/status`);
      const data = await res.json();
      const rawText = JSON.stringify(data);
      const passed =
        res.status === 200 &&
        data.configured === true &&
        !rawText.includes(BOT_TOKEN) &&
        !rawText.includes(SIGNING_SECRET) &&
        !rawText.includes(CHANNEL_ID);
      logTest(
        'Slack status reports configured without leaking credentials',
        passed,
        `HTTP ${res.status}, configured=${data.configured}`
      );
    }

    // 4. Slack notify validation: disallowed action & simulation_mode=false
    {
      const resBadAction = await fetch(`${TEST_URL}/api/slack/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: 'INC-4892',
          severity: 'SEV-1',
          service: 'auth-gateway-prod',
          diagnosis: {
            ...sampleDiagnosis,
            proposed_remediation: { ...sampleDiagnosis.proposed_remediation, action: 'kubectl_delete_ns' },
          },
        }),
      });
      const badActionJson = await resBadAction.json();

      const resBadSim = await fetch(`${TEST_URL}/api/slack/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: 'INC-4892',
          severity: 'SEV-1',
          service: 'auth-gateway-prod',
          simulation_mode: false,
          diagnosis: sampleDiagnosis,
        }),
      });
      const badSimJson = await resBadSim.json();

      const passed =
        resBadAction.status === 400 &&
        badActionJson.code === 'INVALID_ACTION' &&
        resBadSim.status === 400 &&
        badSimJson.code === 'SIMULATION_MODE_REQUIRED';
      logTest(
        'Slack notify enforces ALLOWED_ACTIONS and simulation_mode=true',
        passed,
        `badAction=${resBadAction.status}/${badActionJson.code}, badSim=${resBadSim.status}/${badSimJson.code}`
      );
    }

    // 5. Slack notify posts Block Kit diagnosis with demo/fallback label & interactive buttons
    let issuedApprovalId = '';
    {
      slackApiCalls.length = 0;
      const res = await fetch(`${TEST_URL}/api/slack/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: 'INC-4892',
          severity: 'SEV-1',
          service: 'auth-gateway-prod',
          is_fallback: true,
          diagnosis_source: 'demo_fallback',
          simulation_mode: true,
          diagnosis: sampleDiagnosis,
        }),
      });
      const data = await res.json();
      issuedApprovalId = data.approval_id;
      const postCall = slackApiCalls.find((c) => c.url.includes('chat.postMessage'));
      const blockStr = JSON.stringify(postCall?.body?.blocks || []);
      const passed =
        res.status === 200 &&
        data.success === true &&
        data.diagnosis_source === 'demo_fallback' &&
        Boolean(postCall) &&
        blockStr.includes('DEMO / FALLBACK DIAGNOSIS') &&
        blockStr.includes('[OBSERVED EVIDENCE]') &&
        blockStr.includes('[AI HYPOTHESIS]') &&
        blockStr.includes('approve_remediation') &&
        blockStr.includes('reject_remediation');
      logTest(
        'Slack notify posts Block Kit diagnosis with fallback label & buttons',
        passed,
        `HTTP ${res.status}, approval_id=${issuedApprovalId}`
      );
    }

    const validActionValue = JSON.stringify({
      approval_id: issuedApprovalId,
      incident_id: 'INC-4892',
      action: 'scale_connection_pool_canary',
      simulation_mode: true,
    });

    // 6. Invalid Slack signature rejected with HTTP 401
    {
      const payloadObj = {
        type: 'block_actions',
        user: { id: 'U_SRE_SARAH', username: 'sarah.chen' },
        actions: [{ action_id: 'approve_remediation', value: validActionValue }],
      };
      const signed = signSlackPayload(payloadObj, 'wrong_secret');
      const res = await fetch(`${TEST_URL}/api/slack/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-slack-request-timestamp': signed.timestamp,
          'x-slack-signature': signed.signature,
        },
        body: signed.formBody,
      });
      const data = await res.json();
      const passed = res.status === 401 && data.code === 'INVALID_SLACK_SIGNATURE';
      logTest('Invalid Slack signature rejected with HTTP 401', passed, `HTTP ${res.status}, code=${data.code}`);
    }

    // 7. Expired Slack timestamp rejected (replay protection)
    {
      const payloadObj = {
        type: 'block_actions',
        user: { id: 'U_SRE_SARAH', username: 'sarah.chen' },
        actions: [{ action_id: 'approve_remediation', value: validActionValue }],
      };
      const oldTs = Math.floor(Date.now() / 1000) - 600;
      const signed = signSlackPayload(payloadObj, SIGNING_SECRET, oldTs);
      const res = await fetch(`${TEST_URL}/api/slack/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-slack-request-timestamp': signed.timestamp,
          'x-slack-signature': signed.signature,
        },
        body: signed.formBody,
      });
      const data = await res.json();
      const passed = res.status === 401 && data.code === 'SLACK_TIMESTAMP_EXPIRED';
      logTest('Stale Slack timestamp rejected (replay protection)', passed, `HTTP ${res.status}, code=${data.code}`);
    }

    // 8. Unauthorized Slack user rejected with HTTP 403
    {
      const payloadObj = {
        type: 'block_actions',
        user: { id: 'U_INTERN_999', username: 'unauthorized.user' },
        actions: [{ action_id: 'approve_remediation', value: validActionValue }],
      };
      const signed = signSlackPayload(payloadObj);
      const res = await fetch(`${TEST_URL}/api/slack/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-slack-request-timestamp': signed.timestamp,
          'x-slack-signature': signed.signature,
        },
        body: signed.formBody,
      });
      const data = await res.json();
      const passed = res.status === 403 && data.code === 'UNAUTHORIZED_COMMANDER';
      logTest('Unauthorized engineer rejected with HTTP 403', passed, `HTTP ${res.status}, code=${data.code}`);
    }

    // 9. Mismatched incident_id rejected with HTTP 409
    {
      const mismatchedVal = JSON.stringify({
        approval_id: issuedApprovalId,
        incident_id: 'INC-9999',
        action: 'scale_connection_pool_canary',
        simulation_mode: true,
      });
      const payloadObj = {
        type: 'block_actions',
        user: { id: 'U_SRE_SARAH', username: 'sarah.chen' },
        actions: [{ action_id: 'approve_remediation', value: mismatchedVal }],
      };
      const signed = signSlackPayload(payloadObj);
      const res = await fetch(`${TEST_URL}/api/slack/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-slack-request-timestamp': signed.timestamp,
          'x-slack-signature': signed.signature,
        },
        body: signed.formBody,
      });
      const data = await res.json();
      const passed = res.status === 409 && data.code === 'APPROVAL_MISMATCH';
      logTest('Mismatched incident/action binding rejected with HTTP 409', passed, `HTTP ${res.status}, code=${data.code}`);
    }

    // 10. Authorized Approve executes simulated remediation and records audit event
    {
      slackApiCalls.length = 0;
      const payloadObj = {
        type: 'block_actions',
        user: { id: 'U_SRE_SARAH', username: 'sarah.chen', name: 'Sarah Chen' },
        channel: { id: CHANNEL_ID },
        message: { ts: '1700000000.000100' },
        actions: [{ action_id: 'approve_remediation', value: validActionValue }],
      };
      const signed = signSlackPayload(payloadObj);
      const res = await fetch(`${TEST_URL}/api/slack/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-slack-request-timestamp': signed.timestamp,
          'x-slack-signature': signed.signature,
        },
        body: signed.formBody,
      });
      const data = await res.json();
      const updatedSlack = slackApiCalls.some((c) => c.url.includes('chat.update'));
      const passed =
        res.status === 200 &&
        data.success === true &&
        data.decision === 'approved' &&
        data.remediation_executed === true &&
        data.simulation_mode === true &&
        data.workflow_status === 'simulated_success' &&
        Boolean(data.audit_event) &&
        updatedSlack;
      logTest(
        'Authorized Slack approve executes simulated remediation & audits',
        passed,
        `HTTP ${res.status}, workflow=${data.workflow_status}, slackUpdated=${updatedSlack}`
      );
    }

    // 11. Duplicate approval rejected with HTTP 409
    {
      const payloadObj = {
        type: 'block_actions',
        user: { id: 'U_SRE_SARAH', username: 'sarah.chen' },
        actions: [{ action_id: 'approve_remediation', value: validActionValue }],
      };
      const signed = signSlackPayload(payloadObj);
      const res = await fetch(`${TEST_URL}/api/slack/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-slack-request-timestamp': signed.timestamp,
          'x-slack-signature': signed.signature,
        },
        body: signed.formBody,
      });
      const data = await res.json();
      const passed = res.status === 409 && data.code === 'DUPLICATE_APPROVAL';
      logTest('Duplicate Slack approval rejected with HTTP 409', passed, `HTTP ${res.status}, code=${data.code}`);
    }

    // 12. Reject decision never executes remediation and records audit event
    {
      const notifyRes = await fetch(`${TEST_URL}/api/slack/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: 'INC-4892',
          severity: 'SEV-1',
          service: 'auth-gateway-prod',
          diagnosis: sampleDiagnosis,
        }),
      });
      const notifyData = await notifyRes.json();

      const rejectVal = JSON.stringify({
        approval_id: notifyData.approval_id,
        incident_id: 'INC-4892',
        action: 'scale_connection_pool_canary',
        simulation_mode: true,
      });
      const payloadObj = {
        type: 'block_actions',
        user: { id: 'U_SRE_SARAH', username: 'sarah.chen' },
        channel: { id: CHANNEL_ID },
        message: { ts: '1700000000.000100' },
        actions: [{ action_id: 'reject_remediation', value: rejectVal }],
      };
      const signed = signSlackPayload(payloadObj);
      const res = await fetch(`${TEST_URL}/api/slack/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-slack-request-timestamp': signed.timestamp,
          'x-slack-signature': signed.signature,
        },
        body: signed.formBody,
      });
      const data = await res.json();
      const passed =
        res.status === 200 &&
        data.success === true &&
        data.decision === 'rejected' &&
        data.remediation_executed === false &&
        Boolean(data.audit_event);
      logTest(
        'Slack rejection never executes remediation & records audit event',
        passed,
        `HTTP ${res.status}, decision=${data.decision}, executed=${data.remediation_executed}`
      );
    }

    // 13. Expired approval rejected with HTTP 410
    {
      const notifyRes = await fetch(`${TEST_URL}/api/slack/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: 'INC-4892',
          severity: 'SEV-1',
          service: 'auth-gateway-prod',
          diagnosis: sampleDiagnosis,
        }),
      });
      const notifyData = await notifyRes.json();
      const rec = approvalRegistry.get(notifyData.approval_id);
      if (rec) {
        rec.expires_at = Date.now() - 1000;
      }

      const expVal = JSON.stringify({
        approval_id: notifyData.approval_id,
        incident_id: 'INC-4892',
        action: 'scale_connection_pool_canary',
        simulation_mode: true,
      });
      const payloadObj = {
        type: 'block_actions',
        user: { id: 'U_SRE_SARAH', username: 'sarah.chen' },
        actions: [{ action_id: 'approve_remediation', value: expVal }],
      };
      const signed = signSlackPayload(payloadObj);
      const res = await fetch(`${TEST_URL}/api/slack/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-slack-request-timestamp': signed.timestamp,
          'x-slack-signature': signed.signature,
        },
        body: signed.formBody,
      });
      const data = await res.json();
      const passed = res.status === 410 && data.code === 'APPROVAL_EXPIRED';
      logTest('Expired Slack approval rejected with HTTP 410', passed, `HTTP ${res.status}, code=${data.code}`);
    }

    // 14. Audit log endpoint recorded Slack decisions
    {
      const res = await fetch(`${TEST_URL}/api/audit`);
      const data = await res.json();
      const hasApprove = data.events?.some((e: any) => e.action.includes('Approved & Executed via Slack'));
      const hasReject = data.events?.some((e: any) => e.action.includes('Rejected via Slack'));
      const passed = res.status === 200 && hasApprove && hasReject && serverAuditEvents.length > 0;
      logTest(
        'Server audit log records Slack approvals, rejections & blocked attempts',
        passed,
        `HTTP ${res.status}, auditEventsCount=${data.events?.length}`
      );
    }
  } finally {
    clearTestSlackEnv();
    testServer.close();
    mockSlackApi.close();
  }

  console.log('\n--- Slack Integration Test Summary ---');
  const failedCount = results.filter((r) => !r.passed).length;
  console.log(`Total: ${results.length}, Passed: ${results.length - failedCount}, Failed: ${failedCount}`);
  if (failedCount > 0) {
    process.exit(1);
  }
}

runSlackTests();
