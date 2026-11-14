import http from 'http';
import { AddressInfo } from 'net';

process.env.INCIDENTPILOT_NO_AUTOSTART = 'true';

async function runCorrelationTests() {
  const {
    app,
    getMetricsProvider,
    setMetricsProvider,
    MockMetricsProvider,
    PrometheusMetricsProvider,
    getLogProvider,
    setLogProvider,
    MockLogProvider,
    HttpLogProvider,
    getTraceProvider,
    setTraceProvider,
    MockTraceProvider,
    HttpTraceProvider,
    correlateIncidentEvidence,
  } = await import('../server.ts');

  const results: { name: string; passed: boolean; detail: string }[] = [];
  const logTest = (name: string, passed: boolean, detail: string) => {
    results.push({ name, passed, detail });
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
  };

  const baseMs = Date.now() - 120_000;
  const ts1 = new Date(baseMs).toISOString();
  const ts2 = new Date(baseMs + 5_000).toISOString();
  const ts3 = new Date(baseMs + 10_000).toISOString();

  // In-process mock Prometheus (LIVE)
  const mockPrometheus = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const promQl = reqUrl.searchParams.get('query') || '';
    let val = '10';
    if (promQl.includes('process_cpu_seconds_total')) val = '88.5';
    else if (promQl.includes('process_resident_memory_bytes')) val = '84.0';
    else if (promQl.includes('http_requests_total') && promQl.includes('5..')) val = '9.2';
    else if (promQl.includes('http_requests_total')) val = '1420.0';
    else if (promQl.includes('histogram_quantile')) val = '1320.0';

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'success',
        data: { resultType: 'vector', result: [{ metric: {}, value: [Math.floor(Date.now() / 1000), val] }] },
      })
    );
  });

  // In-process mock HTTP Log source sharing trace_id tr-corr-9901 and request_id req-corr-55
  const mockHttpLogServer = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (reqUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (reqUrl.pathname === '/logs') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          logs: [
            {
              id: 'log-corr-1',
              timestamp: ts2,
              service: 'checkout-api',
              severity: 'ERROR',
              message: 'Downstream payment lock timeout Authorization: Bearer corr-secret-99',
              trace_id: 'tr-corr-9901',
              request_id: 'req-corr-55',
            },
          ],
        })
      );
      return;
    }
    res.writeHead(404).end();
  });

  // In-process mock HTTP Trace source sharing trace_id tr-corr-9901
  const mockHttpTraceServer = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (reqUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (reqUrl.pathname === '/traces') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          traces: [
            {
              trace_id: 'tr-corr-9901',
              spans: [
                {
                  trace_id: 'tr-corr-9901',
                  span_id: 'sp-c1',
                  parent_span_id: null,
                  service_name: 'checkout-api',
                  operation_name: 'POST /checkout',
                  start_time: ts1,
                  duration_ms: 1450,
                  status: 'ERROR',
                  error_message: 'HTTP 500 user=oncall@corr.io',
                },
                {
                  trace_id: 'tr-corr-9901',
                  span_id: 'sp-c2',
                  parent_span_id: 'sp-c1',
                  service_name: 'aurora-pg-cluster',
                  operation_name: 'SELECT * FROM locks',
                  start_time: ts3,
                  duration_ms: 1380,
                  status: 'ERROR',
                  error_message: 'Connection pool exhausted',
                },
              ],
            },
          ],
        })
      );
      return;
    }
    res.writeHead(404).end();
  });

  await Promise.all([
    new Promise<void>((resolve) => mockPrometheus.listen(0, '127.0.0.1', resolve)),
    new Promise<void>((resolve) => mockHttpLogServer.listen(0, '127.0.0.1', resolve)),
    new Promise<void>((resolve) => mockHttpTraceServer.listen(0, '127.0.0.1', resolve)),
  ]);

  const promPort = (mockPrometheus.address() as AddressInfo).port;
  const logPort = (mockHttpLogServer.address() as AddressInfo).port;
  const tracePort = (mockHttpTraceServer.address() as AddressInfo).port;

  const testServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => testServer.once('listening', resolve));
  const testPort = (testServer.address() as AddressInfo).port;
  const TEST_URL = `http://127.0.0.1:${testPort}`;

  const origMetrics = getMetricsProvider();
  const origLogs = getLogProvider();
  const origTraces = getTraceProvider();
  const prevAnthropicKey = process.env.ANTHROPIC_API_KEY;

  try {
    delete process.env.ANTHROPIC_API_KEY;

    // 1. Unified chronological timeline & anomaly correlation via GET /api/correlation (SIMULATED mock mode)
    {
      setMetricsProvider(new MockMetricsProvider());
      setLogProvider(new MockLogProvider());
      setTraceProvider(new MockTraceProvider());

      const res = await fetch(`${TEST_URL}/api/correlation?service=auth-gateway-prod&since=30m`);
      const data: any = await res.json();
      const corr = data.correlation;
      const badSinceRes = await fetch(`${TEST_URL}/api/correlation?since=bad-window`);

      const typesPresent = new Set((corr?.timeline || []).map((e: any) => e.evidence_type));
      const allSimulated =
        (corr?.timeline || []).length > 0 &&
        (corr?.timeline || []).every((e: any) => e.data_source === 'SIMULATED');

      let chronological = true;
      for (let i = 1; i < (corr?.timeline || []).length; i++) {
        if (Date.parse(corr.timeline[i].timestamp) < Date.parse(corr.timeline[i - 1].timestamp)) {
          chronological = false;
          break;
        }
      }

      const passed =
        res.status === 200 &&
        data.success === true &&
        typesPresent.has('METRIC') &&
        typesPresent.has('LOG') &&
        typesPresent.has('TRACE') &&
        allSimulated &&
        corr?.source_provenance?.mixed_sources === false &&
        chronological &&
        (corr?.detected_anomalies?.errors?.length || 0) > 0 &&
        (corr?.detected_anomalies?.latency_spikes?.length || 0) > 0 &&
        (corr?.detected_anomalies?.failed_spans?.length || 0) > 0 &&
        (corr?.supporting_evidence_refs?.length || 0) > 0 &&
        corr?.hypothesis?.confidence >= 20 &&
        corr?.hypothesis?.confidence <= 95 &&
        Boolean(corr?.hypothesis?.confidence_explanation) &&
        corr?.hypothesis?.causation_disclaimer?.toLowerCase().includes('does not constitute proof of causation') &&
        badSinceRes.status === 400;

      logTest(
        'GET /api/correlation correlates metrics, logs, and traces chronologically with disclaimer',
        passed,
        `events=${corr?.timeline?.length}, groups=${corr?.groups?.length}, conf=${corr?.hypothesis?.confidence}%, chronological=${chronological}`
      );
    }

    // 2. Shared trace_id / request_id groups LOG + TRACE events together and redacts secrets/PII
    {
      setMetricsProvider(new MockMetricsProvider());
      setLogProvider(new HttpLogProvider({ baseUrl: `http://127.0.0.1:${logPort}` }));
      setTraceProvider(new HttpTraceProvider({ baseUrl: `http://127.0.0.1:${tracePort}` }));

      const res = await fetch(`${TEST_URL}/api/correlation?service=checkout-api&since=30m`);
      const data: any = await res.json();
      const corr = data.correlation;

      const traceGroup = (corr?.groups || []).find((g: any) => g.trace_id === 'tr-corr-9901');
      const serialized = JSON.stringify(corr);
      const redacted =
        !serialized.includes('corr-secret-99') &&
        !serialized.includes('oncall@corr.io') &&
        serialized.includes('[REDACTED_AUTH]') &&
        serialized.includes('[REDACTED_EMAIL]');

      const passed =
        res.status === 200 &&
        Boolean(traceGroup) &&
        traceGroup.request_id === 'req-corr-55' &&
        traceGroup.event_count === 3 &&
        traceGroup.evidence_types.includes('LOG') &&
        traceGroup.evidence_types.includes('TRACE') &&
        corr.source_provenance.metrics === 'SIMULATED' &&
        corr.source_provenance.logs === 'LIVE' &&
        corr.source_provenance.traces === 'LIVE' &&
        corr.source_provenance.mixed_sources === true &&
        corr.hypothesis.confidence_explanation.includes('direct trace_id link') &&
        redacted;

      logTest(
        'Shared trace_id/request_id groups LOG+TRACE signals, preserves mixed provenance, and redacts secrets',
        passed,
        `groupEvents=${traceGroup?.event_count}, mixed=${corr?.source_provenance?.mixed_sources}, redacted=${redacted}`
      );
    }

    // 3. Mixed LIVE Prometheus + SIMULATED Logs + LIVE Trace preserves exact per-item provenance
    {
      setMetricsProvider(new PrometheusMetricsProvider({ baseUrl: `http://127.0.0.1:${promPort}` }));
      setLogProvider(new MockLogProvider());
      setTraceProvider(new HttpTraceProvider({ baseUrl: `http://127.0.0.1:${tracePort}` }));

      const res = await fetch(`${TEST_URL}/api/correlation?service=checkout-api&since=30m`);
      const data: any = await res.json();
      const corr = data.correlation;
      const metricEvents = (corr?.timeline || []).filter((e: any) => e.evidence_type === 'METRIC');
      const logEvents = (corr?.timeline || []).filter((e: any) => e.evidence_type === 'LOG');
      const traceEvents = (corr?.timeline || []).filter((e: any) => e.evidence_type === 'TRACE');

      const passed =
        res.status === 200 &&
        corr?.source_provenance?.metrics === 'LIVE' &&
        corr?.source_provenance?.logs === 'SIMULATED' &&
        corr?.source_provenance?.traces === 'LIVE' &&
        corr?.source_provenance?.mixed_sources === true &&
        metricEvents.length > 0 &&
        metricEvents.every((e: any) => e.data_source === 'LIVE') &&
        logEvents.length > 0 &&
        logEvents.every((e: any) => e.data_source === 'SIMULATED') &&
        traceEvents.length > 0 &&
        traceEvents.every((e: any) => e.data_source === 'LIVE');

      logTest(
        'Mixed LIVE and SIMULATED telemetry preserves exact per-item provenance on timeline',
        passed,
        `metrics=${corr?.source_provenance?.metrics}, logs=${corr?.source_provenance?.logs}, traces=${corr?.source_provenance?.traces}`
      );
    }

    // 4. Partial failure (1-2 providers down) continues diagnosis/workflow, labels UNAVAILABLE, reduces confidence, keeps approval/audit
    {
      const deadServer = http.createServer();
      await new Promise<void>((resolve) => deadServer.listen(0, '127.0.0.1', resolve));
      const deadPort = (deadServer.address() as AddressInfo).port;
      await new Promise<void>((resolve) => deadServer.close(() => resolve()));

      setMetricsProvider(new PrometheusMetricsProvider({ baseUrl: `http://127.0.0.1:${deadPort}` }));
      setLogProvider(new MockLogProvider());
      setTraceProvider(new HttpTraceProvider({ baseUrl: `http://127.0.0.1:${deadPort}` }));

      const incId = `INC-CORR-FAIL-${Date.now()}`;
      const startRes = await fetch(`${TEST_URL}/api/workflows/incidents/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: incId,
          service: 'auth-gateway-prod',
          severity: 'SEV-1',
          simulation_mode: true,
          notify_slack: false,
          skip_live_claude: true,
        }),
      });
      const startData: any = await startRes.json();
      const diag = startData.workflow?.diagnosis;
      const corr = diag?.correlation;

      const unavailMetrics = (corr?.timeline || []).find((e: any) => e.evidence_type === 'METRIC' && e.data_source === 'UNAVAILABLE');
      const unavailTraces = (corr?.timeline || []).find((e: any) => e.evidence_type === 'TRACE' && e.data_source === 'UNAVAILABLE');
      const availableLogs = (corr?.timeline || []).filter((e: any) => e.evidence_type === 'LOG' && e.data_source === 'SIMULATED');

      // Direct pure unit check when all 3 are unavailable
      const zeroSignalCorr = correlateIncidentEvidence({ service: 'payment-ledger', since: '15m' });

      // Ensure human decision + audit trail remain intact
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

      const passed =
        startRes.status === 201 &&
        Boolean(corr) &&
        corr.source_provenance.metrics === 'UNAVAILABLE' &&
        corr.source_provenance.traces === 'UNAVAILABLE' &&
        corr.source_provenance.logs === 'SIMULATED' &&
        Boolean(unavailMetrics) &&
        Boolean(unavailTraces) &&
        availableLogs.length > 0 &&
        corr.hypothesis.confidence_explanation.includes('unavailable telemetry source(s)') &&
        Array.isArray(diag?.observed_evidence?.timeline) &&
        Boolean(diag?.ai_hypothesis?.title) &&
        Boolean(diag?.ai_hypothesis?.causation_disclaimer) &&
        zeroSignalCorr.hypothesis.title.includes('Insufficient') &&
        decRes.status === 200 &&
        decData.simulation_mode === true &&
        decData.workflow_status === 'simulated_success';

      logTest(
        'Partial provider failures emit UNAVAILABLE entries, lower confidence, and preserve approval/audit safety',
        passed,
        `start=${startRes.status}, unavailMetric=${Boolean(unavailMetrics)}, unavailTrace=${Boolean(unavailTraces)}, conf=${corr?.hypothesis?.confidence}%, dec=${decRes.status}`
      );
    }
  } finally {
    setMetricsProvider(origMetrics);
    setLogProvider(origLogs);
    setTraceProvider(origTraces);
    if (prevAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevAnthropicKey;
    testServer.close();
    mockPrometheus.close();
    mockHttpLogServer.close();
    mockHttpTraceServer.close();
  }

  console.log('\n--- Cross-Signal Correlation Test Summary ---');
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total: ${results.length}, Passed: ${results.length - failed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runCorrelationTests();
