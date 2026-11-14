import http from 'http';
import { AddressInfo } from 'net';

process.env.INCIDENTPILOT_NO_AUTOSTART = 'true';

async function runMetricsTests() {
  const {
    app,
    getMetricsProvider,
    setMetricsProvider,
    MockMetricsProvider,
    PrometheusMetricsProvider,
    createMetricsProviderFromEnv,
  } = await import('../server.ts');

  const results: { name: string; passed: boolean; detail: string }[] = [];
  const logTest = (name: string, passed: boolean, detail: string) => {
    results.push({ name, passed, detail });
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
  };

  let mockPromMode: 'ok' | 'partial' | 'timeout' = 'ok';
  const mockPrometheus = http.createServer((req, res) => {
    if (mockPromMode === 'timeout') {
      setTimeout(() => {
        if (!res.writableEnded) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'success', data: { resultType: 'vector', result: [] } }));
        }
      }, 400);
      return;
    }

    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const promQl = reqUrl.searchParams.get('query') || '';

    let val: string | null = '1';
    if (promQl.includes('process_cpu_seconds_total')) val = '64.25';
    else if (promQl.includes('process_resident_memory_bytes')) val = '71.5';
    else if (promQl.includes('http_requests_total') && promQl.includes('5..')) val = '3.12';
    else if (promQl.includes('http_requests_total')) val = '920.4';
    else if (promQl.includes('histogram_quantile')) {
      val = mockPromMode === 'partial' ? null : '215.8';
    }

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
  const prevMetricsEnv = process.env.METRICS_PROVIDER;
  const prevPromUrlEnv = process.env.PROMETHEUS_URL;

  try {
    // 1. Default env selection & /api/metrics/status in mock mode
    {
      delete process.env.METRICS_PROVIDER;
      const defaultProv = createMetricsProviderFromEnv();
      setMetricsProvider(new MockMetricsProvider());

      const res = await fetch(`${TEST_URL}/api/metrics/status`);
      const data: any = await res.json();

      const passed =
        defaultProv.mode === 'mock' &&
        res.status === 200 &&
        data.provider === 'mock' &&
        data.data_source === 'SIMULATED' &&
        data.simulated === true &&
        data.connected === true;
      logTest(
        'Metrics status endpoint reports mock provider as SIMULATED',
        passed,
        `HTTP ${res.status}, provider=${data.provider}, data_source=${data.data_source}`
      );
    }

    // 2. Mock metrics response includes all 5 required metrics, service name, timestamp, and SIMULATED label
    {
      const res = await fetch(`${TEST_URL}/api/metrics?service=checkout-api`);
      const data: any = await res.json();
      const m = data.metrics || {};

      const passed =
        res.status === 200 &&
        data.success === true &&
        data.service === 'checkout-api' &&
        typeof data.timestamp === 'string' &&
        data.provider === 'mock' &&
        data.data_source === 'SIMULATED' &&
        data.simulated === true &&
        typeof m.cpu_usage_percent === 'number' &&
        typeof m.memory_usage_percent === 'number' &&
        typeof m.http_request_rate_rps === 'number' &&
        typeof m.http_error_rate_percent === 'number' &&
        typeof m.api_latency_p95_ms === 'number';
      logTest(
        'Mock metrics returns all 5 metrics with service, timestamp & SIMULATED label',
        passed,
        `HTTP ${res.status}, service=${data.service}, cpu=${m.cpu_usage_percent}%, p95=${m.api_latency_p95_ms}ms`
      );
    }

    // 3. Prometheus provider queries /api/v1/query and reports LIVE + partial missing metrics
    {
      mockPromMode = 'partial';
      setMetricsProvider(new PrometheusMetricsProvider({ baseUrl: `http://127.0.0.1:${mockPromPort}` }));

      const [statusRes, metricsRes] = await Promise.all([
        fetch(`${TEST_URL}/api/metrics/status`),
        fetch(`${TEST_URL}/api/metrics?service=auth-gateway-prod`),
      ]);
      const [statusData, metricsData]: any[] = await Promise.all([statusRes.json(), metricsRes.json()]);

      const passed =
        statusRes.status === 200 &&
        statusData.provider === 'prometheus' &&
        statusData.data_source === 'LIVE' &&
        statusData.simulated === false &&
        metricsRes.status === 200 &&
        metricsData.provider === 'prometheus' &&
        metricsData.data_source === 'LIVE' &&
        metricsData.simulated === false &&
        metricsData.metrics?.cpu_usage_percent === 64.25 &&
        metricsData.metrics?.api_latency_p95_ms === null &&
        Array.isArray(metricsData.missing_metrics) &&
        metricsData.missing_metrics.includes('api_latency_p95_ms');
      logTest(
        'Prometheus provider returns LIVE metrics and flags missing series honestly',
        passed,
        `status=${statusRes.status}/${statusData.data_source}, cpu=${metricsData.metrics?.cpu_usage_percent}, missing=${metricsData.missing_metrics?.join(',')}`
      );
    }

    // 4. Prometheus missing URL, unreachable server, and timeout fail loudly without falling back to SIMULATED
    {
      setMetricsProvider(new PrometheusMetricsProvider({ baseUrl: '' }));
      const unconfRes = await fetch(`${TEST_URL}/api/metrics`);
      const unconfData: any = await unconfRes.json();

      // Connection refused on an unused port
      const deadServer = http.createServer();
      await new Promise<void>((resolve) => deadServer.listen(0, '127.0.0.1', resolve));
      const deadPort = (deadServer.address() as AddressInfo).port;
      await new Promise<void>((resolve) => deadServer.close(() => resolve()));

      setMetricsProvider(new PrometheusMetricsProvider({ baseUrl: `http://127.0.0.1:${deadPort}` }));
      const connFailRes = await fetch(`${TEST_URL}/api/metrics`);
      const connFailData: any = await connFailRes.json();
      const statusFailRes = await fetch(`${TEST_URL}/api/metrics/status`);
      const statusFailData: any = await statusFailRes.json();

      // Timeout
      mockPromMode = 'timeout';
      setMetricsProvider(new PrometheusMetricsProvider({ baseUrl: `http://127.0.0.1:${mockPromPort}`, timeoutMs: 80 }));
      const timeoutRes = await fetch(`${TEST_URL}/api/metrics`);
      const timeoutData: any = await timeoutRes.json();

      const passed =
        unconfRes.status === 503 &&
        unconfData.code === 'PROMETHEUS_NOT_CONFIGURED' &&
        unconfData.simulated === false &&
        connFailRes.status === 502 &&
        connFailData.code === 'PROMETHEUS_CONNECTION_FAILED' &&
        connFailData.simulated === false &&
        statusFailRes.status === 503 &&
        statusFailData.connected === false &&
        timeoutRes.status === 504 &&
        timeoutData.code === 'PROMETHEUS_TIMEOUT' &&
        timeoutData.simulated === false;
      logTest(
        'Prometheus errors (unconfigured/unreachable/timeout) never fall back to SIMULATED',
        passed,
        `unconf=${unconfRes.status}/${unconfData.code}, connFail=${connFailRes.status}/${connFailData.code}, timeout=${timeoutRes.status}/${timeoutData.code}`
      );
    }
  } finally {
    setMetricsProvider(originalProvider);
    if (prevMetricsEnv === undefined) delete process.env.METRICS_PROVIDER;
    else process.env.METRICS_PROVIDER = prevMetricsEnv;
    if (prevPromUrlEnv === undefined) delete process.env.PROMETHEUS_URL;
    else process.env.PROMETHEUS_URL = prevPromUrlEnv;
    testServer.close();
    mockPrometheus.close();
  }

  console.log('\n--- Prometheus Metrics Integration Test Summary ---');
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total: ${results.length}, Passed: ${results.length - failed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runMetricsTests();
