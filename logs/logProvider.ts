export type LogProviderMode = 'mock' | 'http';
export type LogDataSource = 'SIMULATED' | 'LIVE';
export type LogSeverity = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface StructuredLogEntry {
  id: string;
  timestamp: string;
  service: string;
  severity: LogSeverity;
  message: string;
  trace_id?: string;
  request_id?: string;
  data_source: LogDataSource;
}

export interface LogQueryOptions {
  service?: string;
  since?: string;
  severity?: LogSeverity;
  limit?: number;
}

export interface LogStatusResult {
  provider: LogProviderMode;
  configured: boolean;
  connected: boolean;
  data_source: LogDataSource;
  simulated: boolean;
  log_source_url_configured: boolean;
  message: string;
  code?: string;
}

export interface LogQueryResult {
  service: string;
  since?: string;
  severity?: LogSeverity;
  timestamp: string;
  provider: LogProviderMode;
  data_source: LogDataSource;
  simulated: boolean;
  total: number;
  logs: StructuredLogEntry[];
}

export interface LogProvider {
  readonly mode: LogProviderMode;
  getStatus(): Promise<LogStatusResult>;
  queryLogs(options?: LogQueryOptions): Promise<LogQueryResult>;
}

export class LogProviderError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, code: string, statusCode = 502) {
    super(message);
    this.name = 'LogProviderError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const SEVERITY_PRIORITY: Record<LogSeverity, number> = {
  FATAL: 5,
  ERROR: 4,
  WARN: 3,
  INFO: 2,
  DEBUG: 1,
};

export function normalizeLogSeverity(raw?: string): LogSeverity | undefined {
  if (!raw) return undefined;
  const upper = raw.trim().toUpperCase();
  if (upper === 'DEBUG' || upper === 'INFO' || upper === 'WARN' || upper === 'ERROR' || upper === 'FATAL') {
    return upper;
  }
  if (upper === 'CRIT' || upper === 'CRITICAL') return 'FATAL';
  if (upper === 'WARNING') return 'WARN';
  return undefined;
}

/**
 * Redacts authorization headers, bearer/API tokens, passwords, and email PII
 * before logs are exposed to API responses, AI diagnosis prompts, or UI.
 */
export function redactLogMessage(message: string): string {
  return message
    .replace(/\b(Authorization\s*:\s*(?:Bearer|Basic)\s+)[^\s,;"]+/gi, '$1[REDACTED_AUTH]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi, '$1 [REDACTED_AUTH]')
    .replace(/\b(sk-ant-[A-Za-z0-9\-_]+|xox[bpas]-[A-Za-z0-9\-]+|AIza[0-9A-Za-z\-_]{10,}|eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)\b/g, '[REDACTED_TOKEN]')
    .replace(/\b(password|passwd|pwd|secret|client_secret|api_key|apikey|access_token|refresh_token|token)\s*([=:])\s*(?!\[REDACTED)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1$2[REDACTED]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]');
}

export function parseSinceTimestamp(since?: string): number | undefined {
  if (!since || !since.trim()) return undefined;
  const trimmed = since.trim();
  const relMatch = /^(\d+)([mhd])$/i.exec(trimmed);
  if (relMatch) {
    const amount = Number(relMatch[1]);
    const unit = relMatch[2].toLowerCase();
    const mult = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return Date.now() - amount * mult;
  }
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : undefined;
}

function filterAndPrioritizeLogs(
  entries: StructuredLogEntry[],
  options: LogQueryOptions,
  dataSource: LogDataSource
): StructuredLogEntry[] {
  const serviceFilter = options.service?.trim().toLowerCase();
  const sinceMs = parseSinceTimestamp(options.since);
  const sevFilter = options.severity;
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));

  return entries
    .map((entry) => ({
      ...entry,
      message: redactLogMessage(entry.message),
      data_source: dataSource,
    }))
    .filter((entry) => {
      if (serviceFilter && entry.service.toLowerCase() !== serviceFilter) {
        return false;
      }
      if (sinceMs !== undefined) {
        const entryMs = Date.parse(entry.timestamp);
        if (!Number.isFinite(entryMs) || entryMs < sinceMs) {
          return false;
        }
      }
      if (sevFilter && entry.severity !== sevFilter) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const prioDiff = SEVERITY_PRIORITY[b.severity] - SEVERITY_PRIORITY[a.severity];
      if (prioDiff !== 0) return prioDiff;
      return Date.parse(b.timestamp) - Date.parse(a.timestamp);
    })
    .slice(0, limit);
}

/**
 * Local simulated structured log provider covering HTTP 500, DB timeouts,
 * pool exhaustion, auth failures (with secret redaction), and latency warnings.
 */
export class MockLogProvider implements LogProvider {
  public readonly mode = 'mock' as const;

  private buildSimulatedEntries(): StructuredLogEntry[] {
    const now = Date.now();
    const isoAgo = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

    return [
      {
        id: 'slog-01',
        timestamp: isoAgo(1),
        service: 'auth-gateway-prod',
        severity: 'FATAL',
        message: 'HikariPool-1 exhausted: 60/60 active connections blocked waiting on aurora-pg-master; worker threads starved.',
        trace_id: 'tr-8892-hikari-exhaustion',
        request_id: 'req-gw-99104',
        data_source: 'SIMULATED',
      },
      {
        id: 'slog-02',
        timestamp: isoAgo(2),
        service: 'auth-gateway-prod',
        severity: 'ERROR',
        message: 'Database connection acquisition timed out after 30005ms on pool HikariPool-1 (query: SELECT revoked FROM token_blacklist).',
        trace_id: 'tr-8892-hikari-exhaustion',
        request_id: 'req-gw-99102',
        data_source: 'SIMULATED',
      },
      {
        id: 'slog-03',
        timestamp: isoAgo(3),
        service: 'auth-gateway-prod',
        severity: 'ERROR',
        message: 'POST /v1/oauth2/token/verify returned HTTP 500 Internal Server Error; Authorization: Bearer sk-ant-secret-demo-token user=alice@example.com failed session validation.',
        trace_id: 'tr-8892-auth-500',
        request_id: 'req-gw-99088',
        data_source: 'SIMULATED',
      },
      {
        id: 'slog-04',
        timestamp: isoAgo(4),
        service: 'auth-gateway-prod',
        severity: 'WARN',
        message: 'Request latency warning: p95 response time reached 1,420ms (SLA threshold: 500ms) after canary v2.14.8 rollout.',
        trace_id: 'tr-8892-lat-warn',
        request_id: 'req-gw-99071',
        data_source: 'SIMULATED',
      },
      {
        id: 'slog-05',
        timestamp: isoAgo(6),
        service: 'auth-gateway-prod',
        severity: 'INFO',
        message: 'Canary pod auth-gateway-canary-01 received 25% weighted ingress traffic for v2.14.8.',
        request_id: 'req-gw-99020',
        data_source: 'SIMULATED',
      },
      {
        id: 'slog-06',
        timestamp: isoAgo(180),
        service: 'auth-gateway-prod',
        severity: 'DEBUG',
        message: 'Routine pre-incident connection pool health probe passed (12/60 active).',
        request_id: 'req-gw-88001',
        data_source: 'SIMULATED',
      },
      {
        id: 'slog-07',
        timestamp: isoAgo(2),
        service: 'checkout-api',
        severity: 'ERROR',
        message: 'Upstream auth-gateway-prod returned HTTP 500 during POST /v2/checkout/confirm; api_key=demo_key_12345.',
        trace_id: 'tr-chk-4410',
        request_id: 'req-chk-7721',
        data_source: 'SIMULATED',
      },
      {
        id: 'slog-08',
        timestamp: isoAgo(3),
        service: 'checkout-api',
        severity: 'WARN',
        message: 'Request latency warning: downstream token check latency 1,610ms exceeded circuit-breaker warning threshold.',
        trace_id: 'tr-chk-4408',
        request_id: 'req-chk-7718',
        data_source: 'SIMULATED',
      },
      {
        id: 'slog-09',
        timestamp: isoAgo(2),
        service: 'payment-ledger',
        severity: 'ERROR',
        message: 'Authentication failure calling auth-gateway-prod: invalid JWT signature with token=eyJhbGciOiJIUzI1NiJ9.demo.sig password=supersecret.',
        trace_id: 'tr-pay-3021',
        request_id: 'req-pay-5510',
        data_source: 'SIMULATED',
      },
      {
        id: 'slog-10',
        timestamp: isoAgo(4),
        service: 'aurora-pg-cluster',
        severity: 'FATAL',
        message: 'Connection pool exhaustion near max_connections (98/100 slots occupied by auth-gateway-prod clients).',
        trace_id: 'tr-db-1102',
        request_id: 'req-db-3011',
        data_source: 'SIMULATED',
      },
    ];
  }

  async getStatus(): Promise<LogStatusResult> {
    return {
      provider: 'mock',
      configured: true,
      connected: true,
      data_source: 'SIMULATED',
      simulated: true,
      log_source_url_configured: false,
      message: 'Local simulated structured log provider active (SIMULATED log evidence for dev/testing).',
    };
  }

  async queryLogs(options: LogQueryOptions = {}): Promise<LogQueryResult> {
    const entries = this.buildSimulatedEntries();
    const filtered = filterAndPrioritizeLogs(entries, options, 'SIMULATED');

    return {
      service: options.service?.trim() || 'all',
      ...(options.since ? { since: options.since } : {}),
      ...(options.severity ? { severity: options.severity } : {}),
      timestamp: new Date().toISOString(),
      provider: 'mock',
      data_source: 'SIMULATED',
      simulated: true,
      total: filtered.length,
      logs: filtered,
    };
  }
}

/**
 * Future-compatible live HTTP log provider (LOG_PROVIDER=http + LOG_SOURCE_URL).
 * Fails explicitly without silently falling back to simulated logs.
 */
export class HttpLogProvider implements LogProvider {
  public readonly mode = 'http' as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options?: { baseUrl?: string; timeoutMs?: number }) {
    const raw = (options?.baseUrl ?? process.env.LOG_SOURCE_URL ?? '').trim();
    this.baseUrl = raw.replace(/\/+$/, '');
    this.timeoutMs = options?.timeoutMs ?? 4000;
  }

  private isConfigured(): boolean {
    return Boolean(this.baseUrl && this.baseUrl !== 'MY_LOG_SOURCE_URL');
  }

  async getStatus(): Promise<LogStatusResult> {
    if (!this.isConfigured()) {
      return {
        provider: 'http',
        configured: false,
        connected: false,
        data_source: 'LIVE',
        simulated: false,
        log_source_url_configured: false,
        code: 'LOG_SOURCE_NOT_CONFIGURED',
        message: 'LOG_SOURCE_URL is not configured in the server environment.',
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
          log_source_url_configured: true,
          code: 'LOG_SOURCE_API_ERROR',
          message: `External log source health check returned HTTP ${res.status}.`,
        };
      }
      return {
        provider: 'http',
        configured: true,
        connected: true,
        data_source: 'LIVE',
        simulated: false,
        log_source_url_configured: true,
        message: 'Connected to external HTTP log source (LIVE log evidence).',
      };
    } catch (err: any) {
      return {
        provider: 'http',
        configured: true,
        connected: false,
        data_source: 'LIVE',
        simulated: false,
        log_source_url_configured: true,
        code: err?.name === 'AbortError' ? 'LOG_SOURCE_TIMEOUT' : 'LOG_SOURCE_CONNECTION_FAILED',
        message: err?.message || 'Unable to connect to external log source.',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async queryLogs(options: LogQueryOptions = {}): Promise<LogQueryResult> {
    if (!this.isConfigured()) {
      throw new LogProviderError(
        'LOG_SOURCE_URL is not configured in the server environment.',
        'LOG_SOURCE_NOT_CONFIGURED',
        503
      );
    }

    const params = new URLSearchParams();
    if (options.service) params.set('service', options.service);
    if (options.since) params.set('since', options.since);
    if (options.severity) params.set('severity', options.severity);
    if (options.limit) params.set('limit', String(options.limit));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/logs?${params.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new LogProviderError(`External log source returned HTTP ${res.status}.`, 'LOG_SOURCE_API_ERROR', 502);
      }

      const body: any = await res.json();
      const rawLogs: any[] = Array.isArray(body?.logs) ? body.logs : [];
      const normalized: StructuredLogEntry[] = rawLogs.map((l, idx) => ({
        id: String(l.id || `live-log-${idx}`),
        timestamp: typeof l.timestamp === 'string' ? l.timestamp : new Date().toISOString(),
        service: String(l.service || options.service || 'unknown'),
        severity: normalizeLogSeverity(l.severity) || 'INFO',
        message: String(l.message || ''),
        ...(l.trace_id ? { trace_id: String(l.trace_id) } : {}),
        ...(l.request_id ? { request_id: String(l.request_id) } : {}),
        data_source: 'LIVE',
      }));

      const filtered = filterAndPrioritizeLogs(normalized, options, 'LIVE');
      return {
        service: options.service?.trim() || 'all',
        ...(options.since ? { since: options.since } : {}),
        ...(options.severity ? { severity: options.severity } : {}),
        timestamp: new Date().toISOString(),
        provider: 'http',
        data_source: 'LIVE',
        simulated: false,
        total: filtered.length,
        logs: filtered,
      };
    } catch (err: any) {
      if (err instanceof LogProviderError) throw err;
      if (err?.name === 'AbortError') {
        throw new LogProviderError(`Log source query timed out after ${this.timeoutMs}ms.`, 'LOG_SOURCE_TIMEOUT', 504);
      }
      throw new LogProviderError(
        `Failed to connect to external log source: ${err?.message || 'Network error'}`,
        'LOG_SOURCE_CONNECTION_FAILED',
        502
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createLogProviderFromEnv(): LogProvider {
  const mode = (process.env.LOG_PROVIDER || 'mock').trim().toLowerCase();
  if (mode === 'http' || mode === 'external' || mode === 'live') {
    return new HttpLogProvider();
  }
  if (mode !== 'mock') {
    throw new Error(`Invalid LOG_PROVIDER="${mode}". Expected "mock" or "http".`);
  }
  return new MockLogProvider();
}
