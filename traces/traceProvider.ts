import { parseSinceTimestamp, redactLogMessage } from '../logs/logProvider';

export type TraceProviderMode = 'mock' | 'http';
export type TraceDataSource = 'SIMULATED' | 'LIVE';
export type TraceSpanStatus = 'OK' | 'ERROR';

export interface DistributedSpan {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  service_name: string;
  operation_name: string;
  start_time: string;
  duration_ms: number;
  status: TraceSpanStatus;
  error_message?: string;
  data_source: TraceDataSource;
}

export interface DistributedTrace {
  trace_id: string;
  root_service: string;
  root_operation: string;
  start_time: string;
  total_duration_ms: number;
  status: TraceSpanStatus;
  has_error: boolean;
  has_slow_span: boolean;
  slow_threshold_ms: number;
  spans: DistributedSpan[];
  slow_spans: DistributedSpan[];
  failed_spans: DistributedSpan[];
  data_source: TraceDataSource;
}

export interface TraceQueryOptions {
  service?: string;
  since?: string;
  limit?: number;
  slow_threshold_ms?: number;
}

export interface TraceStatusResult {
  provider: TraceProviderMode;
  configured: boolean;
  connected: boolean;
  data_source: TraceDataSource;
  simulated: boolean;
  trace_source_url_configured: boolean;
  message: string;
  code?: string;
}

export interface TraceQueryResult {
  service: string;
  since?: string;
  timestamp: string;
  provider: TraceProviderMode;
  data_source: TraceDataSource;
  simulated: boolean;
  total: number;
  traces: DistributedTrace[];
}

export interface SingleTraceResult {
  trace: DistributedTrace;
  timestamp: string;
  provider: TraceProviderMode;
  data_source: TraceDataSource;
  simulated: boolean;
}

export interface TraceProvider {
  readonly mode: TraceProviderMode;
  getStatus(): Promise<TraceStatusResult>;
  queryTraces(options?: TraceQueryOptions): Promise<TraceQueryResult>;
  getTraceById(traceId: string, options?: { slow_threshold_ms?: number }): Promise<SingleTraceResult>;
}

export class TraceProviderError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, code: string, statusCode = 502) {
    super(message);
    this.name = 'TraceProviderError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const DEFAULT_SLOW_SPAN_MS = 500;

function sanitizeSpan(span: DistributedSpan, dataSource: TraceDataSource): DistributedSpan {
  return {
    trace_id: String(span.trace_id),
    span_id: String(span.span_id),
    parent_span_id: span.parent_span_id ?? null,
    service_name: String(span.service_name),
    operation_name: redactLogMessage(String(span.operation_name)),
    start_time: String(span.start_time),
    duration_ms: Number.isFinite(Number(span.duration_ms)) ? Number(span.duration_ms) : 0,
    status: span.status === 'ERROR' ? 'ERROR' : 'OK',
    ...(span.error_message ? { error_message: redactLogMessage(String(span.error_message)) } : {}),
    data_source: dataSource,
  };
}

/**
 * Orders spans deterministically in parent-before-child hierarchy order,
 * preserving parent-child relationships and computing slow/failed span summaries.
 */
function buildDistributedTrace(
  traceId: string,
  rawSpans: DistributedSpan[],
  dataSource: TraceDataSource,
  slowThresholdMs = DEFAULT_SLOW_SPAN_MS
): DistributedTrace {
  const sanitized = rawSpans
    .map((s) => sanitizeSpan(s, dataSource))
    .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));

  const spanById = new Map(sanitized.map((s) => [s.span_id, s]));
  const childrenMap = new Map<string, DistributedSpan[]>();
  const roots: DistributedSpan[] = [];

  for (const s of sanitized) {
    if (!s.parent_span_id || !spanById.has(s.parent_span_id)) {
      roots.push(s);
    } else {
      const list = childrenMap.get(s.parent_span_id) || [];
      list.push(s);
      childrenMap.set(s.parent_span_id, list);
    }
  }

  const ordered: DistributedSpan[] = [];
  const visited = new Set<string>();
  const visit = (s: DistributedSpan) => {
    if (visited.has(s.span_id)) return;
    visited.add(s.span_id);
    ordered.push(s);
    for (const child of childrenMap.get(s.span_id) || []) {
      visit(child);
    }
  };
  for (const r of roots) visit(r);
  for (const s of sanitized) visit(s);

  const rootSpan = roots[0] || ordered[0];
  const failedSpans = ordered.filter((s) => s.status === 'ERROR');
  const slowSpans = ordered.filter((s) => s.duration_ms >= slowThresholdMs);
  const totalDuration = rootSpan
    ? rootSpan.duration_ms
    : ordered.reduce((max, s) => Math.max(max, s.duration_ms), 0);

  return {
    trace_id: traceId,
    root_service: rootSpan?.service_name || 'unknown',
    root_operation: rootSpan?.operation_name || 'unknown',
    start_time: rootSpan?.start_time || new Date().toISOString(),
    total_duration_ms: totalDuration,
    status: failedSpans.length > 0 ? 'ERROR' : 'OK',
    has_error: failedSpans.length > 0,
    has_slow_span: slowSpans.length > 0,
    slow_threshold_ms: slowThresholdMs,
    spans: ordered,
    slow_spans: slowSpans,
    failed_spans: failedSpans,
    data_source: dataSource,
  };
}

function matchesServiceFilter(spanService: string, filter?: string): boolean {
  if (!filter) return true;
  const f = filter.trim().toLowerCase();
  const s = spanService.trim().toLowerCase();
  if (s === f) return true;
  if (f === 'auth-gateway' && s === 'auth-gateway-prod') return true;
  if (f === 'auth-gateway-prod' && s === 'auth-gateway') return true;
  return false;
}

function filterAndRankTraces(
  spans: DistributedSpan[],
  options: TraceQueryOptions,
  dataSource: TraceDataSource
): DistributedTrace[] {
  const sinceMs = parseSinceTimestamp(options.since);
  const slowThreshold = options.slow_threshold_ms ?? DEFAULT_SLOW_SPAN_MS;
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));

  const grouped = new Map<string, DistributedSpan[]>();
  for (const span of spans) {
    const list = grouped.get(span.trace_id) || [];
    list.push(span);
    grouped.set(span.trace_id, list);
  }

  const traces: DistributedTrace[] = [];
  for (const [traceId, traceSpans] of grouped.entries()) {
    const built = buildDistributedTrace(traceId, traceSpans, dataSource, slowThreshold);

    if (options.service) {
      const hasMatchingSpan = built.spans.some((sp) => matchesServiceFilter(sp.service_name, options.service));
      if (!hasMatchingSpan) continue;
    }

    if (sinceMs !== undefined) {
      const traceStartMs = Date.parse(built.start_time);
      if (!Number.isFinite(traceStartMs) || traceStartMs < sinceMs) {
        continue;
      }
    }

    traces.push(built);
  }

  // Prioritize failed/slow traces first, then most recent
  return traces
    .sort((a, b) => {
      if (a.has_error !== b.has_error) return a.has_error ? -1 : 1;
      if (a.has_slow_span !== b.has_slow_span) return a.has_slow_span ? -1 : 1;
      return Date.parse(b.start_time) - Date.parse(a.start_time);
    })
    .slice(0, limit);
}

/**
 * Local simulated distributed trace provider with multi-hop parent-child spans:
 * checkout-api -> auth-gateway-prod -> payment-ledger -> aurora-pg-cluster.
 */
export class MockTraceProvider implements TraceProvider {
  public readonly mode = 'mock' as const;

  private buildSimulatedSpans(): DistributedSpan[] {
    const now = Date.now();
    const isoOffset = (minutesAgo: number, plusMs = 0) =>
      new Date(now - minutesAgo * 60_000 + plusMs).toISOString();

    return [
      // Trace 1: Full failing cascade checkout-api -> auth-gateway-prod -> payment-ledger -> aurora-pg-cluster (HTTP 500 + Slow DB)
      {
        trace_id: 'tr-8892-checkout-auth-db',
        span_id: 'sp-8892-01',
        parent_span_id: null,
        service_name: 'checkout-api',
        operation_name: 'POST /v2/checkout/confirm',
        start_time: isoOffset(2, 0),
        duration_ms: 1920,
        status: 'ERROR',
        error_message: 'HTTP 500 Internal Server Error waiting on upstream auth token & ledger confirmation',
        data_source: 'SIMULATED',
      },
      {
        trace_id: 'tr-8892-checkout-auth-db',
        span_id: 'sp-8892-02',
        parent_span_id: 'sp-8892-01',
        service_name: 'auth-gateway-prod',
        operation_name: 'POST /v1/oauth2/token/verify',
        start_time: isoOffset(2, 12),
        duration_ms: 1840,
        status: 'ERROR',
        error_message: 'HTTP 500 Internal Server Error: Authorization: Bearer sk-ant-trace-demo-secret failed ledger/DB validation',
        data_source: 'SIMULATED',
      },
      {
        trace_id: 'tr-8892-checkout-auth-db',
        span_id: 'sp-8892-03',
        parent_span_id: 'sp-8892-02',
        service_name: 'payment-ledger',
        operation_name: 'POST /v1/ledger/authorize',
        start_time: isoOffset(2, 30),
        duration_ms: 1410,
        status: 'ERROR',
        error_message: 'Payment ledger authorization failed due to aurora-pg-cluster query timeout after 1320ms',
        data_source: 'SIMULATED',
      },
      {
        trace_id: 'tr-8892-checkout-auth-db',
        span_id: 'sp-8892-04',
        parent_span_id: 'sp-8892-03',
        service_name: 'aurora-pg-cluster',
        operation_name: 'SELECT revoked_at FROM oauth_tokens WHERE token_hash = $1',
        start_time: isoOffset(2, 48),
        duration_ms: 1320,
        status: 'ERROR',
        error_message: 'Slow database span & HikariPool-1 exhaustion (connection acquisition stalled 1320ms)',
        data_source: 'SIMULATED',
      },

      // Trace 2: Authentication failure + slow DB query
      {
        trace_id: 'tr-8893-auth-payment-slow',
        span_id: 'sp-8893-01',
        parent_span_id: null,
        service_name: 'auth-gateway-prod',
        operation_name: 'TokenValidatorService.verifySession',
        start_time: isoOffset(5, 0),
        duration_ms: 685,
        status: 'ERROR',
        error_message: 'Authentication span failed with HTTP 500 user=alice@example.com password=trace_secret',
        data_source: 'SIMULATED',
      },
      {
        trace_id: 'tr-8893-auth-payment-slow',
        span_id: 'sp-8893-02',
        parent_span_id: 'sp-8893-01',
        service_name: 'payment-ledger',
        operation_name: 'LedgerService.fetchStanding',
        start_time: isoOffset(5, 18),
        duration_ms: 610,
        status: 'OK',
        data_source: 'SIMULATED',
      },
      {
        trace_id: 'tr-8893-auth-payment-slow',
        span_id: 'sp-8893-03',
        parent_span_id: 'sp-8893-02',
        service_name: 'aurora-pg-cluster',
        operation_name: 'SELECT balance FROM merchant_accounts WHERE id = $1',
        start_time: isoOffset(5, 32),
        duration_ms: 560,
        status: 'OK',
        data_source: 'SIMULATED',
      },

      // Trace 3: Older healthy baseline trace (180m ago) for time-window filtering verification
      {
        trace_id: 'tr-8800-baseline-ok',
        span_id: 'sp-8800-01',
        parent_span_id: null,
        service_name: 'checkout-api',
        operation_name: 'GET /v2/checkout/health',
        start_time: isoOffset(180, 0),
        duration_ms: 42,
        status: 'OK',
        data_source: 'SIMULATED',
      },
      {
        trace_id: 'tr-8800-baseline-ok',
        span_id: 'sp-8800-02',
        parent_span_id: 'sp-8800-01',
        service_name: 'auth-gateway-prod',
        operation_name: 'GET /v1/oauth2/jwks',
        start_time: isoOffset(180, 8),
        duration_ms: 19,
        status: 'OK',
        data_source: 'SIMULATED',
      },
      {
        trace_id: 'tr-8800-baseline-ok',
        span_id: 'sp-8800-03',
        parent_span_id: 'sp-8800-02',
        service_name: 'aurora-pg-cluster',
        operation_name: 'SELECT 1',
        start_time: isoOffset(180, 14),
        duration_ms: 6,
        status: 'OK',
        data_source: 'SIMULATED',
      },
    ];
  }

  async getStatus(): Promise<TraceStatusResult> {
    return {
      provider: 'mock',
      configured: true,
      connected: true,
      data_source: 'SIMULATED',
      simulated: true,
      trace_source_url_configured: false,
      message: 'Local simulated distributed trace provider active (SIMULATED trace evidence for dev/testing).',
    };
  }

  async queryTraces(options: TraceQueryOptions = {}): Promise<TraceQueryResult> {
    const spans = this.buildSimulatedSpans();
    const traces = filterAndRankTraces(spans, options, 'SIMULATED');

    return {
      service: options.service?.trim() || 'all',
      ...(options.since ? { since: options.since } : {}),
      timestamp: new Date().toISOString(),
      provider: 'mock',
      data_source: 'SIMULATED',
      simulated: true,
      total: traces.length,
      traces,
    };
  }

  async getTraceById(traceId: string, options?: { slow_threshold_ms?: number }): Promise<SingleTraceResult> {
    const spans = this.buildSimulatedSpans().filter((s) => s.trace_id === traceId);
    if (spans.length === 0) {
      throw new TraceProviderError(`Trace "${traceId}" was not found.`, 'TRACE_NOT_FOUND', 404);
    }

    const trace = buildDistributedTrace(
      traceId,
      spans,
      'SIMULATED',
      options?.slow_threshold_ms ?? DEFAULT_SLOW_SPAN_MS
    );

    return {
      trace,
      timestamp: new Date().toISOString(),
      provider: 'mock',
      data_source: 'SIMULATED',
      simulated: true,
    };
  }
}

/**
 * Future-compatible live external HTTP trace provider (TRACE_PROVIDER=http + TRACE_SOURCE_URL).
 * Fails explicitly without silently falling back to simulated traces.
 */
export class HttpTraceProvider implements TraceProvider {
  public readonly mode = 'http' as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options?: { baseUrl?: string; timeoutMs?: number }) {
    const raw = (options?.baseUrl ?? process.env.TRACE_SOURCE_URL ?? '').trim();
    this.baseUrl = raw.replace(/\/+$/, '');
    this.timeoutMs = options?.timeoutMs ?? 4000;
  }

  private isConfigured(): boolean {
    return Boolean(this.baseUrl && this.baseUrl !== 'MY_TRACE_SOURCE_URL');
  }

  private normalizeExternalSpans(rawSpans: any[], fallbackTraceId?: string): DistributedSpan[] {
    return rawSpans.map((sp, idx) => ({
      trace_id: String(sp.trace_id || fallbackTraceId || 'unknown-trace'),
      span_id: String(sp.span_id || `live-span-${idx}`),
      parent_span_id: sp.parent_span_id ? String(sp.parent_span_id) : null,
      service_name: String(sp.service_name || 'unknown-service'),
      operation_name: String(sp.operation_name || 'unknown-operation'),
      start_time: typeof sp.start_time === 'string' ? sp.start_time : new Date().toISOString(),
      duration_ms: Number.isFinite(Number(sp.duration_ms)) ? Number(spanNum(sp.duration_ms)) : 0,
      status: String(sp.status).toUpperCase() === 'ERROR' ? 'ERROR' : 'OK',
      ...(sp.error_message ? { error_message: String(sp.error_message) } : {}),
      data_source: 'LIVE',
    }));
  }

  async getStatus(): Promise<TraceStatusResult> {
    if (!this.isConfigured()) {
      return {
        provider: 'http',
        configured: false,
        connected: false,
        data_source: 'LIVE',
        simulated: false,
        trace_source_url_configured: false,
        code: 'TRACE_SOURCE_NOT_CONFIGURED',
        message: 'TRACE_SOURCE_URL is not configured in the server environment.',
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: controller.signal });
      if (!res.ok) {
        return {
          provider: 'http',
          configured: true,
          connected: false,
          data_source: 'LIVE',
          simulated: false,
          trace_source_url_configured: true,
          code: 'TRACE_SOURCE_API_ERROR',
          message: `External trace source health check returned HTTP ${res.status}.`,
        };
      }
      return {
        provider: 'http',
        configured: true,
        connected: true,
        data_source: 'LIVE',
        simulated: false,
        trace_source_url_configured: true,
        message: 'Connected to external HTTP trace source (LIVE trace evidence).',
      };
    } catch (err: any) {
      return {
        provider: 'http',
        configured: true,
        connected: false,
        data_source: 'LIVE',
        simulated: false,
        trace_source_url_configured: true,
        code: err?.name === 'AbortError' ? 'TRACE_SOURCE_TIMEOUT' : 'TRACE_SOURCE_CONNECTION_FAILED',
        message: err?.message || 'Unable to connect to external trace source.',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async queryTraces(options: TraceQueryOptions = {}): Promise<TraceQueryResult> {
    if (!this.isConfigured()) {
      throw new TraceProviderError(
        'TRACE_SOURCE_URL is not configured in the server environment.',
        'TRACE_SOURCE_NOT_CONFIGURED',
        503
      );
    }

    const params = new URLSearchParams();
    if (options.service) params.set('service', options.service);
    if (options.since) params.set('since', options.since);
    if (options.limit) params.set('limit', String(options.limit));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/traces?${params.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new TraceProviderError(`External trace source returned HTTP ${res.status}.`, 'TRACE_SOURCE_API_ERROR', 502);
      }

      const body: any = await res.json();
      let flattenedSpans: DistributedSpan[] = [];
      if (Array.isArray(body?.spans)) {
        flattenedSpans = this.normalizeExternalSpans(body.spans);
      } else if (Array.isArray(body?.traces)) {
        for (const tr of body.traces) {
          if (Array.isArray(tr?.spans)) {
            flattenedSpans.push(...this.normalizeExternalSpans(tr.spans, tr.trace_id));
          }
        }
      }

      const traces = filterAndRankTraces(flattenedSpans, options, 'LIVE');
      return {
        service: options.service?.trim() || 'all',
        ...(options.since ? { since: options.since } : {}),
        timestamp: new Date().toISOString(),
        provider: 'http',
        data_source: 'LIVE',
        simulated: false,
        total: traces.length,
        traces,
      };
    } catch (err: any) {
      if (err instanceof TraceProviderError) throw err;
      if (err?.name === 'AbortError') {
        throw new TraceProviderError(`Trace source query timed out after ${this.timeoutMs}ms.`, 'TRACE_SOURCE_TIMEOUT', 504);
      }
      throw new TraceProviderError(
        `Failed to connect to external trace source: ${err?.message || 'Network error'}`,
        'TRACE_SOURCE_CONNECTION_FAILED',
        502
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async getTraceById(traceId: string, options?: { slow_threshold_ms?: number }): Promise<SingleTraceResult> {
    if (!this.isConfigured()) {
      throw new TraceProviderError(
        'TRACE_SOURCE_URL is not configured in the server environment.',
        'TRACE_SOURCE_NOT_CONFIGURED',
        503
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/traces/${encodeURIComponent(traceId)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (res.status === 404) {
        throw new TraceProviderError(`Trace "${traceId}" was not found on external trace source.`, 'TRACE_NOT_FOUND', 404);
      }
      if (!res.ok) {
        throw new TraceProviderError(`External trace source returned HTTP ${res.status}.`, 'TRACE_SOURCE_API_ERROR', 502);
      }

      const body: any = await res.json();
      const rawSpans: any[] = Array.isArray(body?.spans)
        ? body.spans
        : Array.isArray(body?.trace?.spans)
        ? body.trace.spans
        : [];
      if (rawSpans.length === 0) {
        throw new TraceProviderError(`Trace "${traceId}" contains no spans.`, 'TRACE_NOT_FOUND', 404);
      }

      const normalized = this.normalizeExternalSpans(rawSpans, traceId);
      const trace = buildDistributedTrace(
        traceId,
        normalized,
        'LIVE',
        options?.slow_threshold_ms ?? DEFAULT_SLOW_SPAN_MS
      );

      return {
        trace,
        timestamp: new Date().toISOString(),
        provider: 'http',
        data_source: 'LIVE',
        simulated: false,
      };
    } catch (err: any) {
      if (err instanceof TraceProviderError) throw err;
      if (err?.name === 'AbortError') {
        throw new TraceProviderError(`Trace lookup timed out after ${this.timeoutMs}ms.`, 'TRACE_SOURCE_TIMEOUT', 504);
      }
      throw new TraceProviderError(
        `Failed to connect to external trace source: ${err?.message || 'Network error'}`,
        'TRACE_SOURCE_CONNECTION_FAILED',
        502
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

function spanNum(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

export function createTraceProviderFromEnv(): TraceProvider {
  const mode = (process.env.TRACE_PROVIDER || 'mock').trim().toLowerCase();
  if (mode === 'http' || mode === 'external' || mode === 'live') {
    return new HttpTraceProvider();
  }
  if (mode !== 'mock') {
    throw new Error(`Invalid TRACE_PROVIDER="${mode}". Expected "mock" or "http".`);
  }
  return new MockTraceProvider();
}
