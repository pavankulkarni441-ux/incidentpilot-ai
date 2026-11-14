import http from 'http';
import { AddressInfo } from 'net';

process.env.INCIDENTPILOT_NO_AUTOSTART = 'true';

async function runDistributedTracesTests() {
  const {
    app,
    getTraceProvider,
    setTraceProvider,
    MockTraceProvider,
    HttpTraceProvider,
  } = await import('../server.ts');

  const results: { name: string; passed: boolean; detail: string }[] = [];
  const logTest = (name: string, passed: boolean, detail: string) => {
    results.push({ name, passed, detail });
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
  };

  let mockHttpBehavior: 'normal' | 'empty' = 'normal';

  const nowIso = new Date().toISOString();
  const mockExternalTraceServer = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (reqUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (reqUrl.pathname === '/traces') {
      if (mockHttpBehavior === 'empty') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ traces: [] }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          traces: [
            {
              trace_id: 'tr-live-9001',
              spans: [
                {
                  trace_id: 'tr-live-9001',
                  span_id: 'sp-live-1',
                  parent_span_id: null,
                  service_name: 'checkout-api',
                  operation_name: 'POST /checkout',
                  start_time: nowIso,
                  duration_ms: 910,
                  status: 'ERROR',
                  error_message: 'HTTP 500 Authorization: Bearer live-trace-secret-77 user=oncall@prod.io',
                },
                {
                  trace_id: 'tr-live-9001',
                  span_id: 'sp-live-2',
                  parent_span_id: 'sp-live-1',
                  service_name: 'aurora-pg-cluster',
                  operation_name: 'SELECT * FROM ledger_locks',
                  start_time: nowIso,
                  duration_ms: 820,
                  status: 'ERROR',
                  error_message: 'DB lock timeout',
                },
              ],
            },
          ],
        })
      );
      return;
    }

    if (reqUrl.pathname === '/traces/tr-live-9001') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          trace: {
            trace_id: 'tr-live-9001',
            spans: [
              {
                trace_id: 'tr-live-9001',
                span_id: 'sp-live-1',
                parent_span_id: null,
                service_name: 'checkout-api',
                operation_name: 'POST /checkout',
                start_time: nowIso,
                duration_ms: 910,
                status: 'ERROR',
              },
            ],
          },
        })
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  await new Promise<void>((resolve) => mockExternalTraceServer.listen(0, '127.0.0.1', resolve));
  const mockTracePort = (mockExternalTraceServer.address() as AddressInfo).port;

  const testServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => testServer.once('listening', resolve));
  const testPort = (testServer.address() as AddressInfo).port;
  const TEST_URL = `http://127.0.0.1:${testPort}`;

  const originalTraceProvider = getTraceProvider();
  const prevAnthropicKey = process.env.ANTHROPIC_API_KEY;

  try {
    // Zero paid Claude API calls during automated verification
    delete process.env.ANTHROPIC_API_KEY;

    // 1. Default mock trace status reports SIMULATED provenance cleanly
    {
      setTraceProvider(new MockTraceProvider());
      const res = await fetch(`${TEST_URL}/api/traces/status`);
      const data: any = await res.json();
      const passed =
        res.status === 200 &&
        data.provider === 'mock' &&
        data.configured === true &&
        data.connected === true &&
        data.data_source === 'SIMULATED' &&
        data.simulated === true;
      logTest(
        'GET /api/traces/status reports SIMULATED mock provider by default',
        passed,
        `HTTP ${res.status}, provider=${data.provider}, data_source=${data.data_source}`
      );
    }

    // 2. Service cascade, parent-child spans, slow/failed detection, time-window filter, and redaction
    {
      setTraceProvider(new MockTraceProvider());
      const res60 = await fetch(`${TEST_URL}/api/traces?service=checkout-api&since=60m`);
      const data60: any = await res60.json();
      const res24h = await fetch(`${TEST_URL}/api/traces?service=checkout-api&since=24h`);
      const data24h: any = await res24h.json();
      const authAliasRes = await fetch(`${TEST_URL}/api/traces?service=auth-gateway&since=60m`);
      const authAliasData: any = await authAliasRes.json();

      const cascadeTrace = data60.traces?.[0];
      const servicesOrder = Array.isArray(cascadeTrace?.spans)
        ? cascadeTrace.spans.map((s: any) => s.service_name).join('->')
        : '';

      const spanMap = new Map((cascadeTrace?.spans || []).map((s: any) => [s.span_id, s]));
      const parentChainValid =
        cascadeTrace?.spans?.[0]?.parent_span_id === null &&
        cascadeTrace?.spans?.[1]?.parent_span_id === cascadeTrace?.spans?.[0]?.span_id &&
        cascadeTrace?.spans?.[2]?.parent_span_id === cascadeTrace?.spans?.[1]?.span_id &&
        cascadeTrace?.spans?.[3]?.parent_span_id === cascadeTrace?.spans?.[2]?.span_id &&
        spanMap.size === 4;

      const serialized = JSON.stringify(data60.traces || []);
      const redacted =
        !serialized.includes('sk-ant-trace-demo-secret') &&
        serialized.includes('[REDACTED_AUTH]');

      const passed =
        res60.status === 200 &&
        data60.success === true &&
        data60.data_source === 'SIMULATED' &&
        data60.simulated === true &&
        data60.total === 1 &&
        data24h.total === 2 &&
        authAliasData.total === 2 &&
        servicesOrder === 'checkout-api->auth-gateway-prod->payment-ledger->aurora-pg-cluster' &&
        parentChainValid &&
        cascadeTrace?.has_error === true &&
        cascadeTrace?.has_slow_span === true &&
        cascadeTrace?.failed_spans?.length === 4 &&
        cascadeTrace?.slow_spans?.length === 4 &&
        redacted;

      logTest(
        'GET /api/traces verifies parent-child cascade, slow/failed spans, time/service filters & redaction',
        passed,
        `cascade=${servicesOrder}, parentChain=${parentChainValid}, 60m=${data60.total}, 24h=${data24h.total}, redacted=${redacted}`
      );
    }

    // 3. Single trace lookup & invalid query validation
    {
      setTraceProvider(new MockTraceProvider());
      const okRes = await fetch(`${TEST_URL}/api/traces/tr-8893-auth-payment-slow`);
      const okData: any = await okRes.json();
      const missingRes = await fetch(`${TEST_URL}/api/traces/tr-does-not-exist`);
      const badSinceRes = await fetch(`${TEST_URL}/api/traces?since=not-valid`);

      const trText = JSON.stringify(okData.trace || {});
      const authPiiRedacted =
        !trText.includes('alice@example.com') &&
        !trText.includes('trace_secret') &&
        trText.includes('[REDACTED_EMAIL]') &&
        trText.includes('[REDACTED]');

      const passed =
        okRes.status === 200 &&
        okData.trace?.trace_id === 'tr-8893-auth-payment-slow' &&
        okData.trace?.spans?.length === 3 &&
        okData.trace?.failed_spans?.length === 1 &&
        okData.trace?.slow_spans?.length === 3 &&
        authPiiRedacted &&
        missingRes.status === 404 &&
        badSinceRes.status === 400;

      logTest(
        'GET /api/traces/:traceId resolves spans cleanly, redacts PII, and rejects unknown trace/invalid since',
        passed,
        `ok=${okRes.status}, missing=${missingRes.status}, badSince=${badSinceRes.status}, redacted=${authPiiRedacted}`
      );
    }

    // 4. HttpTraceProvider preserves LIVE provenance, redacts secrets, handles empty, and fails closed
    {
      setTraceProvider(new HttpTraceProvider({ baseUrl: `http://127.0.0.1:${mockTracePort}` }));

      const statusRes = await fetch(`${TEST_URL}/api/traces/status`);
      const statusData: any = await statusRes.json();

      mockHttpBehavior = 'normal';
      const liveRes = await fetch(`${TEST_URL}/api/traces?service=checkout-api&since=30m`);
      const liveData: any = await liveRes.json();
      const liveText = JSON.stringify(liveData.traces || []);
      const liveRedacted =
        !liveText.includes('live-trace-secret-77') &&
        !liveText.includes('oncall@prod.io') &&
        liveText.includes('[REDACTED_AUTH]') &&
        liveText.includes('[REDACTED_EMAIL]');

      const singleLiveRes = await fetch(`${TEST_URL}/api/traces/tr-live-9001`);
      const singleLiveData: any = await singleLiveRes.json();

      mockHttpBehavior = 'empty';
      const emptyRes = await fetch(`${TEST_URL}/api/traces?service=checkout-api&since=30m`);
      const emptyData: any = await emptyRes.json();

      // Unconfigured & unreachable HttpTraceProvider fail closed without SIMULATED fallback
      setTraceProvider(new HttpTraceProvider({ baseUrl: '' }));
      const unconfStatusRes = await fetch(`${TEST_URL}/api/traces/status`);
      const unconfRes = await fetch(`${TEST_URL}/api/traces?service=checkout-api`);
      const unconfData: any = await unconfRes.json();

      const deadServer = http.createServer();
      await new Promise<void>((resolve) => deadServer.listen(0, '127.0.0.1', resolve));
      const deadPort = (deadServer.address() as AddressInfo).port;
      await new Promise<void>((resolve) => deadServer.close(() => resolve()));

      setTraceProvider(new HttpTraceProvider({ baseUrl: `http://127.0.0.1:${deadPort}` }));
      const failRes = await fetch(`${TEST_URL}/api/traces?service=checkout-api`);
      const failData: any = await failRes.json();

      const passed =
        statusRes.status === 200 &&
        statusData.data_source === 'LIVE' &&
        statusData.simulated === false &&
        liveRes.status === 200 &&
        liveData.data_source === 'LIVE' &&
        liveData.simulated === false &&
        liveData.traces?.[0]?.trace_id === 'tr-live-9001' &&
        liveRedacted &&
        singleLiveRes.status === 200 &&
        singleLiveData.trace?.data_source === 'LIVE' &&
        emptyRes.status === 200 &&
        emptyData.total === 0 &&
        Array.isArray(emptyData.traces) &&
        emptyData.traces.length === 0 &&
        unconfStatusRes.status === 503 &&
        unconfRes.status === 503 &&
        unconfData.simulated === false &&
        failRes.status === 502 &&
        failData.simulated === false &&
        failData.data_source === 'LIVE';

      logTest(
        'HttpTraceProvider preserves LIVE provenance, redacts secrets, and fails closed without SIMULATED fallback',
        passed,
        `live=${liveRes.status}, single=${singleLiveRes.status}, empty=${emptyData.total}, unconf=${unconfRes.status}, fail=${failRes.status}`
      );
    }

    // 5. Diagnosis & orchestrator use trace evidence without inventing missing spans and preserve approval/audit safety
    {
      setTraceProvider(new MockTraceProvider());
      const incId = `INC-TRACE-WF-${Date.now()}`;
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
      const te = diag?.observed_evidence?.traces_evidence;

      // Also verify failed LIVE trace provider does not invent spans in /api/claude/diagnose
      const deadServer = http.createServer();
      await new Promise<void>((resolve) => deadServer.listen(0, '127.0.0.1', resolve));
      const deadPort = (deadServer.address() as AddressInfo).port;
      await new Promise<void>((resolve) => deadServer.close(() => resolve()));
      setTraceProvider(new HttpTraceProvider({ baseUrl: `http://127.0.0.1:${deadPort}` }));

      const diagFailRes = await fetch(`${TEST_URL}/api/claude/diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: `INC-TRACE-FAIL-${Date.now()}`,
          alert: { service: 'payment-ledger', severity: 'SEV-1' },
        }),
      });
      const diagFailData: any = await diagFailRes.json();
      const failTe = diagFailData.fallback_diagnosis?.observed_evidence?.traces_evidence;
      const failKeyLines: string[] = diagFailData.fallback_diagnosis?.observed_evidence?.key_log_lines || [];
      const hasHonestUnavailableNote = failKeyLines.some((l) =>
        l.includes('[TRACES:LIVE (http) UNAVAILABLE]') && l.includes('missing spans were not invented')
      );

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
        te?.available === true &&
        te?.data_source === 'SIMULATED' &&
        te?.total === 2 &&
        te?.failed_spans_count >= 4 &&
        te?.slow_spans_count >= 4 &&
        diag?.observed_evidence?.trace_id === 'tr-8892-checkout-auth-db' &&
        Boolean(diag?.ai_hypothesis?.title) &&
        Boolean(diag?.observed_evidence?.metrics_evidence) &&
        Boolean(diag?.observed_evidence?.logs_evidence) &&
        failTe?.available === false &&
        failTe?.data_source === 'LIVE' &&
        failTe?.simulated === false &&
        failTe?.traces?.length === 0 &&
        failTe?.slow_spans_count === 0 &&
        failTe?.failed_spans_count === 0 &&
        hasHonestUnavailableNote &&
        decRes.status === 200 &&
        decData.simulation_mode === true &&
        decData.workflow_status === 'simulated_success' &&
        hasAudit;

      logTest(
        'Diagnosis & workflow integrate traces with metrics/logs without inventing missing spans & keep safety controls',
        passed,
        `start=${startRes.status}, traces=${te?.total}, failAvail=${failTe?.available}, unavailableNote=${hasHonestUnavailableNote}, dec=${decRes.status}`
      );
    }
  } finally {
    setTraceProvider(originalTraceProvider);
    if (prevAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevAnthropicKey;
    testServer.close();
    mockExternalTraceServer.close();
  }

  console.log('\n--- Distributed Traces Test Summary ---');
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total: ${results.length}, Passed: ${results.length - failed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runDistributedTracesTests();
