export type MetricsProviderMode = 'mock' | 'prometheus';
export type MetricsDataSource = 'SIMULATED' | 'LIVE';

export interface PerformanceMetricValues {
  cpu_usage_percent: number | null;
  memory_usage_percent: number | null;
  http_request_rate_rps: number | null;
  http_error_rate_percent: number | null;
  api_latency_p95_ms: number | null;
}

export interface MetricsStatusResult {
  provider: MetricsProviderMode;
  configured: boolean;
  connected: boolean;
  data_source: MetricsDataSource;
  simulated: boolean;
  prometheus_url_configured: boolean;
  message: string;
  code?: string;
}

export interface MetricsQueryResult {
  service: string;
  timestamp: string;
  provider: MetricsProviderMode;
  data_source: MetricsDataSource;
  simulated: boolean;
  metrics: PerformanceMetricValues;
  missing_metrics: string[];
}

export interface MetricsProvider {
  readonly mode: MetricsProviderMode;
  getStatus(): Promise<MetricsStatusResult>;
  getMetrics(service: string, options?: { mitigated?: boolean }): Promise<MetricsQueryResult>;
}

export class MetricsProviderError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, code: string, statusCode = 502) {
    super(message);
    this.name = 'MetricsProviderError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function sanitizeServiceLabel(service: string): string {
  const cleaned = service.trim().replace(/[^a-zA-Z0-9._-]/g, '');
  return cleaned || 'auth-gateway-prod';
}

/**
 * Local simulated metrics provider for development and testing.
 * Always labels every response as SIMULATED (simulated=true).
 */
export class MockMetricsProvider implements MetricsProvider {
  public readonly mode = 'mock' as const;

  async getStatus(): Promise<MetricsStatusResult> {
    return {
      provider: 'mock',
      configured: true,
      connected: true,
      data_source: 'SIMULATED',
      simulated: true,
      prometheus_url_configured: false,
      message: 'Local simulated metrics provider active (SIMULATED telemetry for dev/testing).',
    };
  }

  async getMetrics(service: string, options?: { mitigated?: boolean }): Promise<MetricsQueryResult> {
    const safeService = sanitizeServiceLabel(service);
    const mitigated = options?.mitigated === true;

    const metrics: PerformanceMetricValues = mitigated
      ? {
          cpu_usage_percent: 38.4,
          memory_usage_percent: 54.2,
          http_request_rate_rps: 1420.5,
          http_error_rate_percent: 0.08,
          api_latency_p95_ms: 36.8,
        }
      : {
          cpu_usage_percent: 87.6,
          memory_usage_percent: 78.4,
          http_request_rate_rps: 1685.2,
          http_error_rate_percent: 14.8,
          api_latency_p95_ms: 1420.0,
        };

    return {
      service: safeService,
      timestamp: new Date().toISOString(),
      provider: 'mock',
      data_source: 'SIMULATED',
      simulated: true,
      metrics,
      missing_metrics: [],
    };
  }
}

/**
 * Prometheus HTTP API v1 provider (/api/v1/query).
 * Fails explicitly on connection errors, timeouts, or missing config;
 * never silently falls back to simulated data.
 */
export class PrometheusMetricsProvider implements MetricsProvider {
  public readonly mode = 'prometheus' as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options?: { baseUrl?: string; timeoutMs?: number }) {
    const raw = (options?.baseUrl ?? process.env.PROMETHEUS_URL ?? '').trim();
    this.baseUrl = raw.replace(/\/+$/, '');
    this.timeoutMs = options?.timeoutMs ?? 4000;
  }

  private isConfigured(): boolean {
    return Boolean(this.baseUrl && this.baseUrl !== 'MY_PROMETHEUS_URL');
  }

  private async fetchPromJson(pathnameWithQuery: string): Promise<any> {
    if (!this.isConfigured()) {
      throw new MetricsProviderError(
        'PROMETHEUS_URL is not configured in the server environment.',
        'PROMETHEUS_NOT_CONFIGURED',
        503
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}${pathnameWithQuery}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      let body: any;
      try {
        body = await res.json();
      } catch {
        throw new MetricsProviderError(
          `Prometheus returned invalid JSON (HTTP ${res.status}).`,
          'PROMETHEUS_INVALID_RESPONSE',
          502
        );
      }

      if (!res.ok || body?.status === 'error') {
        throw new MetricsProviderError(
          body?.error || `Prometheus API returned HTTP ${res.status}.`,
          'PROMETHEUS_API_ERROR',
          502
        );
      }

      return body;
    } catch (err: any) {
      if (err instanceof MetricsProviderError) {
        throw err;
      }
      if (err?.name === 'AbortError') {
        throw new MetricsProviderError(
          `Prometheus query timed out after ${this.timeoutMs}ms.`,
          'PROMETHEUS_TIMEOUT',
          504
        );
      }
      throw new MetricsProviderError(
        `Failed to connect to Prometheus server: ${err?.message || 'Network error'}`,
        'PROMETHEUS_CONNECTION_FAILED',
        502
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async querySingleMetric(promQl: string): Promise<number | null> {
    const encoded = encodeURIComponent(promQl);
    const body = await this.fetchPromJson(`/api/v1/query?query=${encoded}`);
    const results = body?.data?.result;
    if (!Array.isArray(results) || results.length === 0) {
      return null;
    }
    const rawVal = results[0]?.value?.[1];
    const num = Number(rawVal);
    if (!Number.isFinite(num)) {
      return null;
    }
    return Math.round(num * 100) / 100;
  }

  async getStatus(): Promise<MetricsStatusResult> {
    if (!this.isConfigured()) {
      return {
        provider: 'prometheus',
        configured: false,
        connected: false,
        data_source: 'LIVE',
        simulated: false,
        prometheus_url_configured: false,
        code: 'PROMETHEUS_NOT_CONFIGURED',
        message: 'PROMETHEUS_URL is not configured in the server environment.',
      };
    }

    try {
      await this.fetchPromJson('/api/v1/query?query=up');
      return {
        provider: 'prometheus',
        configured: true,
        connected: true,
        data_source: 'LIVE',
        simulated: false,
        prometheus_url_configured: true,
        message: 'Connected to Prometheus HTTP API (LIVE telemetry).',
      };
    } catch (err: any) {
      return {
        provider: 'prometheus',
        configured: true,
        connected: false,
        data_source: 'LIVE',
        simulated: false,
        prometheus_url_configured: true,
        code: err?.code || 'PROMETHEUS_CONNECTION_FAILED',
        message: err?.message || 'Unable to reach Prometheus HTTP API.',
      };
    }
  }

  async getMetrics(service: string): Promise<MetricsQueryResult> {
    const safeService = sanitizeServiceLabel(service);

    const queries: { key: keyof PerformanceMetricValues; promQl: string }[] = [
      {
        key: 'cpu_usage_percent',
        promQl: `avg(rate(process_cpu_seconds_total{service="${safeService}"}[5m])) * 100`,
      },
      {
        key: 'memory_usage_percent',
        promQl: `avg(process_resident_memory_bytes{service="${safeService}"} / 1073741824) * 100`,
      },
      {
        key: 'http_request_rate_rps',
        promQl: `sum(rate(http_requests_total{service="${safeService}"}[5m]))`,
      },
      {
        key: 'http_error_rate_percent',
        promQl: `(sum(rate(http_requests_total{service="${safeService}",status=~"5.."}[5m])) / clamp_min(sum(rate(http_requests_total{service="${safeService}"}[5m])), 0.001)) * 100`,
      },
      {
        key: 'api_latency_p95_ms',
        promQl: `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{service="${safeService}"}[5m])) by (le)) * 1000`,
      },
    ];

    const values = await Promise.all(queries.map((q) => this.querySingleMetric(q.promQl)));

    const metrics: PerformanceMetricValues = {
      cpu_usage_percent: values[0],
      memory_usage_percent: values[1],
      http_request_rate_rps: values[2],
      http_error_rate_percent: values[3],
      api_latency_p95_ms: values[4],
    };

    const missing_metrics = queries
      .filter((_q, idx) => values[idx] === null)
      .map((q) => q.key);

    return {
      service: safeService,
      timestamp: new Date().toISOString(),
      provider: 'prometheus',
      data_source: 'LIVE',
      simulated: false,
      metrics,
      missing_metrics,
    };
  }
}

export function createMetricsProviderFromEnv(): MetricsProvider {
  const mode = (process.env.METRICS_PROVIDER || 'mock').trim().toLowerCase();
  if (mode === 'prometheus') {
    return new PrometheusMetricsProvider();
  }
  if (mode !== 'mock') {
    throw new Error(`Invalid METRICS_PROVIDER="${mode}". Expected "mock" or "prometheus".`);
  }
  return new MockMetricsProvider();
}
