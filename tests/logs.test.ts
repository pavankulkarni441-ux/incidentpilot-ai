import http from 'http';
import { AddressInfo } from 'net';

process.env.INCIDENTPILOT_NO_AUTOSTART = 'true';

async function runStructuredLogsTests() {
  const {
    app,
    getLogProvider,
    setLogProvider,
    MockLogProvider,
    HttpLogProvider,
  } = await import('../server.ts');

  const results: { name: string; passed: boolean; detail: string }[] = [];
  const logTest = (name: string, passed: boolean, detail: string) => {
    results.push({ name, passed, detail });
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
  };

  let mockHttpBehavior: 'normal' | 'empty' = 'normal';

  // Local in-process mock external HTTP log source server (simulates real external log pipeline)
  const mockExternalLogServer = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (reqUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (reqUrl.pathname === '/logs') {
      if (mockHttpBehavior === 'empty') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ logs: [] }));
        return;
      }

      const nowIso = new Date().toISOString();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          logs: [
            {
              id: 'live-1',
              timestamp: nowIso,
              service: 'auth-gateway-prod',
              severity: 'INFO',
              message: 'Health probe succeeded for replica 02.',
              request_id: 'req-live-01',
            },
            {
              id: 'live-2',
              timestamp: nowIso,
              service: 'auth-gateway-prod',
              severity: 'FATAL',
              message: 'Upstream pool saturated; Authorization: Bearer live-secret-9988 user=oncall@prod.io api_key=live_k_999',
              trace_id: 'tr-live-fatal-01',
              request_id: 'req-live-02',
            },
          ],
        })
      );
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => mockExternalLogServer.listen(0, '127.0.0.1', resolve));
  const mockLogPort = (mockExternalLogServer.address() as AddressInfo).port;

  const testServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => testServer.once('listening', resolve));
  const testPort = (testServer.address() as AddressInfo).port;
  const TEST_URL = `http://127.0.0.1:${testPort}`;

  const originalLogProvider = getLogProvider();
  const prevAnthropicKey = process.env.ANTHROPIC_API_KEY;

  try {
    // Zero paid Claude API calls during automated verification
    delete process.env.ANTHROPIC_API_KEY;

    // 1. Default mock log status reports SIMULATED provenance cleanly
    {
      setLogProvider(new MockLogProvider());
      const res = await fetch(`${TEST_URL}/api/logs/status`);
      const data: any = await res.json();
      const passed =
        res.status === 200 &&
        data.provider === 'mock' &&
        data.configured === true &&
        data.connected === true &&
        data.data_source === 'SIMULATED' &&
        data.simulated === true;
      logTest(
        'GET /api/logs/status reports SIMULATED mock provider by default',
        passed,
        `HTTP ${res.status}, provider=${data.provider}, data_source=${data.data_source}`
      );
    }

    // 2. Service filtering, time-window filtering, FATAL/ERROR priority, and PII/secret redaction
    {
      setLogProvider(new MockLogProvider());
      const res60 = await fetch(`${TEST_URL}/api/logs?service=auth-gateway-prod&since=60m`);
      const data60: any = await res60.json();
      const res24h = await fetch(`${TEST_URL}/api/logs?service=auth-gateway-prod&since=24h`);
      const data24h: any = await res24h.json();

      const serialized = JSON.stringify(data60.logs || []);
      const noSecretsLeaked =
        !serialized.includes('sk-ant-secret-demo-token') &&
        !serialized.includes('alice@example.com') &&
        serialized.includes('[REDACTED_AUTH]') &&
        serialized.includes('[REDACTED_EMAIL]');

      const allMatchingService =
        Array.isArray(data60.logs) &&
        data60.logs.length === 5 &&
        data60.logs.every((l: any) => l.service === 'auth-gateway-prod' && l.data_source === 'SIMULATED');

      const prioritizedCorrectly =
        data60.logs?.[0]?.severity === 'FATAL' &&
        data60.logs?.[1]?.severity === 'ERROR' &&
        data60.logs?.[2]?.severity === 'ERROR';

      const olderDebugIncludedIn24h =
        Array.isArray(data24h.logs) &&
        data24h.logs.length === 6 &&
        data24h.logs.some((l: any) => l.id === 'slog-06' && l.severity === 'DEBUG');

      const passed =
        res60.status === 200 &&
        data60.success === true &&
        data60.data_source === 'SIMULATED' &&
        data60.simulated === true &&
        allMatchingService &&
        prioritizedCorrectly &&
        noSecretsLeaked &&
        olderDebugIncludedIn24h;

      logTest(
        'GET /api/logs filters by service/since, prioritizes FATAL/ERROR, and redacts secrets',
        passed,
        `60m=${data60.total}, 24h=${data24h.total}, top=${data60.logs?.[0]?.severity}, redacted=${noSecretsLeaked}`
      );
    }

    // 3. Invalid query parameters rejected cleanly with HTTP 400
    {
      const badSev = await fetch(`${TEST_URL}/api/logs?severity=TRACE_UNKNOWN`);
      const badSince = await fetch(`${TEST_URL}/api/logs?since=not-a-timestamp`);
      const passed = badSev.status === 400 && badSince.status === 400;
      logTest(
        'GET /api/logs rejects invalid severity and since parameters',
        passed,
        `severity HTTP ${badSev.status}, since HTTP ${badSince.status}`
      );
    }

    // 4. HttpLogProvider (LIVE) redacts secrets, handles empty results honestly, and never falls back on failure
    {
      setLogProvider(new HttpLogProvider({ baseUrl: `http://127.0.0.1:${mockLogPort}` }));

      const statusRes = await fetch(`${TEST_URL}/api/logs/status`);
      const statusData: any = await statusRes.json();

      mockHttpBehavior = 'normal';
      const liveRes = await fetch(`${TEST_URL}/api/logs?service=auth-gateway-prod&since=30m`);
      const liveData: any = await liveRes.json();
      const liveBodyText = JSON.stringify(liveData.logs || []);
      const liveRedacted =
        !liveBodyText.includes('live-secret-9988') &&
        !liveBodyText.includes('oncall@prod.io') &&
        !liveBodyText.includes('live_k_999') &&
        liveBodyText.includes('[REDACTED_AUTH]') &&
        liveBodyText.includes('[REDACTED_EMAIL]') &&
        liveBodyText.includes('[REDACTED]');

      mockHttpBehavior = 'empty';
      const emptyRes = await fetch(`${TEST_URL}/api/logs?service=auth-gateway-prod&since=30m`);
      const emptyData: any = await emptyRes.json();

      // Unconfigured and unreachable HttpLogProvider fail closed without simulated fallback
      const unconfigured = new HttpLogProvider({ baseUrl: '' });
      setLogProvider(unconfigured);
      const unconfStatusRes = await fetch(`${TEST_URL}/api/logs/status`);
      const unconfLogsRes = await fetch(`${TEST_URL}/api/logs?service=auth-gateway-prod`);
      const unconfLogsData: any = await unconfLogsRes.json();

      const deadServer = http.createServer();
      await new Promise<void>((resolve) => deadServer.listen(0, '127.0.0.1', resolve));
      const deadPort = (deadServer.address() as AddressInfo).port;
      await new Promise<void>((resolve) => deadServer.close(() => resolve()));

      setLogProvider(new HttpLogProvider({ baseUrl: `http://127.0.0.1:${deadPort}` }));
      const failLogsRes = await fetch(`${TEST_URL}/api/logs?service=auth-gateway-prod`);
      const failLogsData: any = await failLogsRes.json();

      const passed =
        statusRes.status === 200 &&
        statusData.data_source === 'LIVE' &&
        statusData.simulated === false &&
        liveRes.status === 200 &&
        liveData.data_source === 'LIVE' &&
        liveData.simulated === false &&
        liveData.logs?.[0]?.severity === 'FATAL' &&
        liveRedacted &&
        emptyRes.status === 200 &&
        emptyData.total === 0 &&
        Array.isArray(emptyData.logs) &&
        emptyData.logs.length === 0 &&
        unconfStatusRes.status === 503 &&
        unconfLogsRes.status === 503 &&
        unconfLogsData.simulated === false &&
        failLogsRes.status === 502 &&
        failLogsData.simulated === false &&
        failLogsData.data_source === 'LIVE';

      logTest(
        'HttpLogProvider preserves LIVE provenance, redacts secrets, and fails closed without SIMULATED fallback',
        passed,
        `live=${liveRes.status}, empty=${emptyData.total}, unconf=${unconfLogsRes.status}, fail=${failLogsRes.status}`
      );
    }

    // 5. Diagnosis & Orchestrator integration preserves log evidence separation, redaction, and approval/audit safety
    {
      setLogProvider(new MockLogProvider());
      const incId = `INC-LOGS-WF-${Date.now()}`;
      const startRes = await fetch(`${TEST_URL}/api/workflows/incidents/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: incId,
          service: 'payment-ledger',
          severity: 'SEV-1',
          simulation_mode: true,
          notify_slack: false,
          skip_live_claude: true,
        }),
      });
      const startData: any = await startRes.json();
      const diag = startData.workflow?.diagnosis;
      const le = diag?.observed_evidence?.logs_evidence;
      const serializedDiag = JSON.stringify(diag || {});
      const passwordAndJwtRedacted =
        !serializedDiag.includes('supersecret') &&
        !serializedDiag.includes('eyJhbGciOiJIUzI1NiJ9.demo.sig') &&
        serializedDiag.includes('[REDACTED_TOKEN]') &&
        serializedDiag.includes('[REDACTED]');

      // Also verify failed live log source in /api/claude/diagnose never falls back to SIMULATED
      const deadServer = http.createServer();
      await new Promise<void>((resolve) => deadServer.listen(0, '127.0.0.1', resolve));
      const deadPort = (deadServer.address() as AddressInfo).port;
      await new Promise<void>((resolve) => deadServer.close(() => resolve()));
      setLogProvider(new HttpLogProvider({ baseUrl: `http://127.0.0.1:${deadPort}` }));

      const diagFailRes = await fetch(`${TEST_URL}/api/claude/diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: `INC-LOGS-LIVE-FAIL-${Date.now()}`,
          alert: { service: 'payment-ledger', severity: 'SEV-1' },
        }),
      });
      const diagFailData: any = await diagFailRes.json();
      const failLe = diagFailData.fallback_diagnosis?.observed_evidence?.logs_evidence;

      const decRes = await fetch(`${TEST_URL}/api/workflows/incidents/${incId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_id: startData.approval_id,
          action: startData.workflow?.proposed_action,
          decision: 'approve',
          simulation_mode: true,
          human_approval: {
            approved: true,
            commander_id: 's-chen-882',
            commander_name: 'Sarah Chen',
          },
        }),
      });
      const decData: any = await decRes.json();

      const audRes = await fetch(`${TEST_URL}/api/audit`);
      const audData: any = await audRes.json();
      const hasAudit = Array.isArray(audData.events) && audData.events.some((e: any) => e.action.includes(incId));

      const passed =
        startRes.status === 201 &&
        le?.available === true &&
        le?.data_source === 'SIMULATED' &&
        le?.logs?.length === 1 &&
        Boolean(diag?.ai_hypothesis?.title) &&
        diag.summary.toLowerCase().includes('log') &&
        passwordAndJwtRedacted &&
        failLe?.available === false &&
        failLe?.data_source === 'LIVE' &&
        failLe?.simulated === false &&
        failLe?.logs?.length === 0 &&
        decRes.status === 200 &&
        decData.simulation_mode === true &&
        decData.workflow_status === 'simulated_success' &&
        hasAudit;

      logTest(
        'Diagnosis & workflow connect redacted structured logs into observed_evidence while preserving safety guarantees',
        passed,
        `start=${startRes.status}, simLogs=${le?.logs?.length}, failAvail=${failLe?.available}, dec=${decRes.status}, audited=${hasAudit}`
      );
    }
  } finally {
    setLogProvider(originalLogProvider);
    if (prevAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevAnthropicKey;
    testServer.close();
    mockExternalLogServer.close();
  }

  console.log('\n--- Structured Logs Test Summary ---');
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total: ${results.length}, Passed: ${results.length - failed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runStructuredLogsTests();
