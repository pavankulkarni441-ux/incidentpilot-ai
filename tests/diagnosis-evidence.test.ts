import http from 'http';
import { AddressInfo } from 'net';

process.env.INCIDENTPILOT_NO_AUTOSTART = 'true';

async function runDiagnosisEvidenceTests() {
  const {
    app,
    getMetricsProvider,
    setMetricsProvider,
    MockMetricsProvider,
    PrometheusMetricsProvider,
  } = await import('../server.ts');

  const results: { name: string; passed: boolean; detail: string }[] = [];
  const logTest = (name: string, passed: boolean, detail: string) => {
    results.push({ name, passed, detail });
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
  };

  // Local in-process mock Prometheus server (returns partial metrics: p95 latency missing)
  const mockPrometheus = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const promQl = reqUrl.searchParams.get('query') || '';

    let val: string | null = '1';
    if (promQl.includes('process_cpu_seconds_total')) val = '91.4';
    else if (promQl.includes('process_resident_memory_bytes')) val = '83.2';
    else if (promQl.includes('http_requests_total') && promQl.includes('5..')) val = '9.6';
    else if (promQl.includes('http_requests_total')) val = '1540.0';
    else if (promQl.includes('histogram_quantile')) val = null; // missing metric

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'success',
        data: {
          resultType: 'vector',
          result: val === null ? [] : [{ metric: {}, value: [1700000000, val] }],
        },
      })
    );
  });

  await new Promise<void>((resolve) => mockPrometheus.listen(0, '127.0.0.1', resolve));
  const mockPromPort = (mockPrometheus.address() as AddressInfo).port;

  const testServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => testServer.once('listening', resolve));
  const testPort = (testServer.address() as AddressInfo).port;
  const TEST_URL = `http://127.0.0.1:${testPort}`;

  const originalProvider = getMetricsProvider();
  const prevAnthropicKey = process.env.ANTHROPIC_API_KEY;

  try {
    // Ensure zero paid Claude API calls during this test suite
    delete process.env.ANTHROPIC_API_KEY;

    // 1. Simulated metrics appear as SIMULATED evidence separated from hypothesis + cautious causation wording
    {
      setMetricsProvider(new MockMetricsProvider());
      const incId = `INC-EVID-SIM-${Date.now()}`;
      const res = await fetch(`${TEST_URL}/api/workflows/incidents/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: incId,
          service: 'checkout-api',
          severity: 'SEV-1',
          simulation_mode: true,
          notify_slack: false,
          skip_live_claude: true,
        }),
      });
      const data: any = await res.json();
      const diag = data.workflow?.diagnosis;
      const me = diag?.observed_evidence?.metrics_evidence;
      const explanation = `${diag?.summary || ''} ${diag?.probable_root_cause || ''} ${diag?.ai_hypothesis?.explanation || ''}`.toLowerCase();

      const passed =
        res.status === 201 &&
        me?.available === true &&
        me?.data_source === 'SIMULATED' &&
        me?.simulated === true &&
        me?.provider === 'mock' &&
        typeof me?.timestamp === 'string' &&
        Array.isArray(me?.observations) &&
        me.observations.length === 5 &&
        Boolean(diag?.ai_hypothesis?.title) &&
        explanation.includes('correlation') &&
        explanation.includes('simulated');
      logTest(
        'Simulated metrics appear as SIMULATED evidence separated from hypothesis',
        passed,
        `HTTP ${res.status}, source=${me?.data_source}, obsCount=${me?.observations?.length}`
      );
    }

    // 2. Live Prometheus partial metrics appear as LIVE without inventing missing values
    {
      setMetricsProvider(new PrometheusMetricsProvider({ baseUrl: `http://127.0.0.1:${mockPromPort}` }));
      const res = await fetch(`${TEST_URL}/api/claude/diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: `INC-EVID-LIVE-${Date.now()}`,
          alert: { service: 'auth-gateway-prod', severity: 'SEV-1' },
        }),
      });
      const data: any = await res.json();
      const diag = data.fallback_diagnosis;
      const me = diag?.observed_evidence?.metrics_evidence;
      const cpuObs = me?.observations?.find((o: any) => o.name === 'cpu_usage_percent');
      const p95Obs = me?.observations?.find((o: any) => o.name === 'api_latency_p95_ms');

      const passed =
        res.status === 503 &&
        me?.available === true &&
        me?.data_source === 'LIVE' &&
        me?.simulated === false &&
        me?.provider === 'prometheus' &&
        cpuObs?.value === 91.4 &&
        cpuObs?.status === 'observed' &&
        p95Obs?.value === null &&
        p95Obs?.status === 'missing' &&
        Array.isArray(me?.missing_metrics) &&
        me.missing_metrics.includes('api_latency_p95_ms');
      logTest(
        'Missing Prometheus metrics are not invented and LIVE source is preserved',
        passed,
        `source=${me?.data_source}, cpu=${cpuObs?.value}, p95=${String(p95Obs?.value)}/${p95Obs?.status}`
      );
    }

    // 3. Prometheus connection failure does not trigger simulated fallback and workflow + approval/audit still work
    {
      const deadServer = http.createServer();
      await new Promise<void>((resolve) => deadServer.listen(0, '127.0.0.1', resolve));
      const deadPort = (deadServer.address() as AddressInfo).port;
      await new Promise<void>((resolve) => deadServer.close(() => resolve()));

      setMetricsProvider(new PrometheusMetricsProvider({ baseUrl: `http://127.0.0.1:${deadPort}` }));

      const incFail = `INC-EVID-FAIL-${Date.now()}`;
      const startRes = await fetch(`${TEST_URL}/api/workflows/incidents/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: incFail,
          service: 'payment-ledger',
          severity: 'SEV-1',
          simulation_mode: true,
          notify_slack: false,
          skip_live_claude: true,
        }),
      });
      const startData: any = await startRes.json();
      const me = startData.workflow?.diagnosis?.observed_evidence?.metrics_evidence;
      const allUnavailable =
        Array.isArray(me?.observations) &&
        me.observations.every((o: any) => o.status === 'unavailable' && o.value === null);

      const decRes = await fetch(`${TEST_URL}/api/workflows/incidents/${incFail}/decision`, {
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
      const hasAudit = Array.isArray(audData.events) && audData.events.some((e: any) => e.action.includes(incFail));

      const passed =
        startRes.status === 201 &&
        me?.available === false &&
        me?.data_source === 'LIVE' &&
        me?.simulated === false &&
        typeof me?.unavailable_reason === 'string' &&
        allUnavailable &&
        decRes.status === 200 &&
        decData.workflow_status === 'simulated_success' &&
        decData.simulation_mode === true &&
        hasAudit;
      logTest(
        'Prometheus failure reports unavailable telemetry without simulated fallback & preserves approval/audit',
        passed,
        `start=${startRes.status}, available=${me?.available}, simulated=${me?.simulated}, approve=${decRes.status}, audited=${hasAudit}`
      );
    }
  } finally {
    setMetricsProvider(originalProvider);
    if (prevAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevAnthropicKey;
    testServer.close();
    mockPrometheus.close();
  }

  console.log('\n--- Evidence-Based Diagnosis Test Summary ---');
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total: ${results.length}, Passed: ${results.length - failed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runDiagnosisEvidenceTests();
