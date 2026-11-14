import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WebClient } from '@slack/web-api';

import {
  WorkflowStore,
  InMemoryStore,
  FirestoreStore,
  createWorkflowStoreFromEnv,
  ServerAuditEvent,
  ApprovalRecord,
  IncidentWorkflowState,
} from './storage/workflowStore';
import {
  MetricsProvider,
  MockMetricsProvider,
  PrometheusMetricsProvider,
  MetricsProviderError,
  createMetricsProviderFromEnv,
} from './metrics/metricsProvider';
import {
  LogProvider,
  MockLogProvider,
  HttpLogProvider,
  LogProviderError,
  StructuredLogEntry,
  normalizeLogSeverity,
  parseSinceTimestamp,
  redactLogMessage,
  createLogProviderFromEnv,
} from './logs/logProvider';
import {
  TraceProvider,
  MockTraceProvider,
  HttpTraceProvider,
  TraceProviderError,
  DistributedTrace,
  createTraceProviderFromEnv,
} from './traces/traceProvider';
import {
  correlateIncidentEvidence,
  EvidenceCorrelationResult,
} from './correlation/evidenceCorrelator';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

interface RawBodyRequest extends Request {
  rawBody?: string;
}

const captureRawBody = (req: RawBodyRequest, _res: Response, buf: Buffer) => {
  req.rawBody = buf.toString('utf8');
};

app.use(express.json({ verify: captureRawBody }));
app.use(express.urlencoded({ extended: false, verify: captureRawBody }));

// Allowed simulated remediation actions (strict allowlist)
export const ALLOWED_ACTIONS = [
  'scale_connection_pool_canary',
  'apply_hotfix_patch',
  'drain_stale_connections',
  'rolling_restart_canary',
  'enable_token_cache_bypass',
  'test_connection',
];

export type { ServerAuditEvent, ApprovalRecord, IncidentWorkflowState, WorkflowStore, MetricsProvider, LogProvider, TraceProvider, EvidenceCorrelationResult };
export { InMemoryStore, FirestoreStore, createWorkflowStoreFromEnv };
export { MockMetricsProvider, PrometheusMetricsProvider, MetricsProviderError, createMetricsProviderFromEnv };
export { MockLogProvider, HttpLogProvider, LogProviderError, createLogProviderFromEnv, redactLogMessage };
export { MockTraceProvider, HttpTraceProvider, TraceProviderError, createTraceProviderFromEnv };
export { correlateIncidentEvidence };

export const approvalRegistry = new Map<string, ApprovalRecord>();
export const workflowRegistry = new Map<string, IncidentWorkflowState>();
export const serverAuditEvents: ServerAuditEvent[] = [];

let activeWorkflowStore: WorkflowStore = createWorkflowStoreFromEnv({
  workflows: workflowRegistry,
  approvals: approvalRegistry,
  auditEvents: serverAuditEvents,
});

export function getWorkflowStore(): WorkflowStore {
  return activeWorkflowStore;
}

export function setWorkflowStore(store: WorkflowStore): void {
  activeWorkflowStore = store;
}

let activeMetricsProvider: MetricsProvider = createMetricsProviderFromEnv();

export function getMetricsProvider(): MetricsProvider {
  return activeMetricsProvider;
}

export function setMetricsProvider(provider: MetricsProvider): void {
  activeMetricsProvider = provider;
}

let activeLogProvider: LogProvider = createLogProviderFromEnv();

export function getLogProvider(): LogProvider {
  return activeLogProvider;
}

export function setLogProvider(provider: LogProvider): void {
  activeLogProvider = provider;
}

let activeTraceProvider: TraceProvider = createTraceProviderFromEnv();

export function getTraceProvider(): TraceProvider {
  return activeTraceProvider;
}

export function setTraceProvider(provider: TraceProvider): void {
  activeTraceProvider = provider;
}

async function recordServerAudit(
  event: Omit<ServerAuditEvent, 'id' | 'timestamp'>
): Promise<ServerAuditEvent> {
  const entry: ServerAuditEvent = {
    id: `aud-srv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toTimeString().split(' ')[0] + ' UTC',
    created_at_ms: Date.now(),
    ...event,
  };
  return activeWorkflowStore.appendAuditEvent(entry);
}

function computeApprovalBindingHash(incidentId: string, action: string): string {
  return crypto
    .createHash('sha256')
    .update(`${incidentId}:${action}:simulation_only`)
    .digest('hex');
}

function getSlackConfig() {
  const botToken = process.env.SLACK_BOT_TOKEN?.trim() || '';
  const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim() || '';
  const channelId = process.env.SLACK_CHANNEL_ID?.trim() || '';
  const authorizedRaw = process.env.AUTHORIZED_COMMANDERS?.trim() || '';

  const botTokenConfigured = Boolean(botToken && botToken !== 'MY_SLACK_BOT_TOKEN');
  const signingSecretConfigured = Boolean(signingSecret && signingSecret !== 'MY_SLACK_SIGNING_SECRET');
  const channelConfigured = Boolean(channelId && channelId !== 'MY_SLACK_CHANNEL_ID');
  const authorizedCommanders = authorizedRaw
    ? authorizedRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  return {
    botToken: botTokenConfigured ? botToken : '',
    signingSecret: signingSecretConfigured ? signingSecret : '',
    channelId: channelConfigured ? channelId : '',
    botTokenConfigured,
    signingSecretConfigured,
    channelConfigured,
    authorizedCommanders,
    authorizedCommandersConfigured: authorizedCommanders.length > 0,
  };
}

function createSlackClient(botToken: string): WebClient {
  const customApiUrl = process.env.SLACK_API_BASE_URL?.trim();
  return new WebClient(
    botToken,
    customApiUrl ? { slackApiUrl: customApiUrl, retryConfig: { retries: 0 } } : { timeout: 8000 }
  );
}

function verifySlackSignature(
  signingSecret: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  rawBody: string
): { valid: boolean; code?: string; error?: string } {
  if (!timestampHeader || !signatureHeader) {
    return {
      valid: false,
      code: 'SLACK_SIGNATURE_MISSING',
      error: 'Missing required X-Slack-Signature or X-Slack-Request-Timestamp headers.',
    };
  }

  const tsSeconds = Number(timestampHeader);
  if (!Number.isFinite(tsSeconds)) {
    return {
      valid: false,
      code: 'INVALID_SLACK_TIMESTAMP',
      error: 'Invalid X-Slack-Request-Timestamp header.',
    };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - tsSeconds) > 300) {
    return {
      valid: false,
      code: 'SLACK_TIMESTAMP_EXPIRED',
      error: 'Slack request timestamp is outside the 5-minute replay protection window.',
    };
  }

  const sigBaseString = `v0:${timestampHeader}:${rawBody}`;
  const expectedSig =
    'v0=' + crypto.createHmac('sha256', signingSecret).update(sigBaseString, 'utf8').digest('hex');

  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  const actualBuf = Buffer.from(signatureHeader, 'utf8');

  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return {
      valid: false,
      code: 'INVALID_SLACK_SIGNATURE',
      error: 'Slack request signature verification failed.',
    };
  }

  return { valid: true };
}

/**
 * Health check
 */
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Prometheus-compatible metrics provider status
 */
app.get('/api/metrics/status', async (_req: Request, res: Response) => {
  try {
    const status = await activeMetricsProvider.getStatus();
    const httpCode = status.provider === 'prometheus' && (!status.configured || !status.connected) ? 503 : 200;
    res.status(httpCode).json(status);
  } catch (err: any) {
    res.status(503).json({
      provider: activeMetricsProvider.mode,
      configured: false,
      connected: false,
      data_source: activeMetricsProvider.mode === 'prometheus' ? 'LIVE' : 'SIMULATED',
      simulated: activeMetricsProvider.mode === 'mock',
      prometheus_url_configured: false,
      code: 'METRICS_PROVIDER_ERROR',
      message: err?.message || 'Unable to inspect metrics provider status.',
    });
  }
});

/**
 * Retrieve service performance metrics (CPU, Memory, HTTP RPS, HTTP Error Rate, API p95 Latency)
 * Never falls back to simulated data when provider=prometheus fails.
 */
app.get('/api/metrics', async (req: Request, res: Response) => {
  const service = typeof req.query.service === 'string' && req.query.service.trim()
    ? req.query.service.trim()
    : 'auth-gateway-prod';
  const mitigated = req.query.mitigated === 'true';

  try {
    const data = await activeMetricsProvider.getMetrics(service, { mitigated });
    res.json({
      success: true,
      ...data,
    });
  } catch (err: any) {
    if (err instanceof MetricsProviderError) {
      res.status(err.statusCode).json({
        success: false,
        service,
        provider: activeMetricsProvider.mode,
        data_source: 'LIVE',
        simulated: false,
        code: err.code,
        error: err.message,
      });
      return;
    }
    res.status(502).json({
      success: false,
      service,
      provider: activeMetricsProvider.mode,
      data_source: activeMetricsProvider.mode === 'prometheus' ? 'LIVE' : 'SIMULATED',
      simulated: activeMetricsProvider.mode === 'mock',
      code: 'METRICS_QUERY_FAILED',
      error: err?.message || 'Failed to retrieve metrics.',
    });
  }
});

/**
 * Structured log provider status
 */
app.get('/api/logs/status', async (_req: Request, res: Response) => {
  try {
    const status = await activeLogProvider.getStatus();
    const httpCode = status.provider === 'http' && (!status.configured || !status.connected) ? 503 : 200;
    res.status(httpCode).json(status);
  } catch (err: any) {
    res.status(503).json({
      provider: activeLogProvider.mode,
      configured: false,
      connected: false,
      data_source: activeLogProvider.mode === 'http' ? 'LIVE' : 'SIMULATED',
      simulated: activeLogProvider.mode === 'mock',
      log_source_url_configured: false,
      code: 'LOG_PROVIDER_ERROR',
      message: err?.message || 'Unable to inspect log provider status.',
    });
  }
});

/**
 * Retrieve structured application log events filtered by service, time window (since), and severity.
 * Prioritizes FATAL/ERROR logs and redacts secrets/PII. Never falls back to simulated data when provider=http fails.
 */
app.get('/api/logs', async (req: Request, res: Response) => {
  const service = typeof req.query.service === 'string' && req.query.service.trim()
    ? req.query.service.trim()
    : undefined;
  const rawSince = typeof req.query.since === 'string' && req.query.since.trim()
    ? req.query.since.trim()
    : undefined;
  const rawSeverity = typeof req.query.severity === 'string' && req.query.severity.trim()
    ? req.query.severity.trim()
    : undefined;
  const rawLimit = typeof req.query.limit === 'string' && req.query.limit.trim()
    ? Number(req.query.limit.trim())
    : undefined;

  if (rawSince && parseSinceTimestamp(rawSince) === undefined) {
    res.status(400).json({
      success: false,
      service: service || 'all',
      provider: activeLogProvider.mode,
      data_source: activeLogProvider.mode === 'http' ? 'LIVE' : 'SIMULATED',
      simulated: activeLogProvider.mode === 'mock',
      code: 'INVALID_SINCE_TIMESTAMP',
      error: `Invalid since parameter "${rawSince}". Use an ISO-8601 timestamp or relative duration (e.g. 15m, 1h, 1d).`,
    });
    return;
  }

  const normalizedSeverity = rawSeverity ? normalizeLogSeverity(rawSeverity) : undefined;
  if (rawSeverity && !normalizedSeverity) {
    res.status(400).json({
      success: false,
      service: service || 'all',
      provider: activeLogProvider.mode,
      data_source: activeLogProvider.mode === 'http' ? 'LIVE' : 'SIMULATED',
      simulated: activeLogProvider.mode === 'mock',
      code: 'INVALID_LOG_SEVERITY',
      error: `Invalid severity "${rawSeverity}". Allowed values: DEBUG, INFO, WARN, ERROR, FATAL.`,
    });
    return;
  }

  try {
    const data = await activeLogProvider.queryLogs({
      service,
      since: rawSince,
      severity: normalizedSeverity,
      limit: Number.isFinite(rawLimit) ? rawLimit : undefined,
    });
    res.json({
      success: true,
      ...data,
    });
  } catch (err: any) {
    if (err instanceof LogProviderError) {
      res.status(err.statusCode).json({
        success: false,
        service: service || 'all',
        provider: activeLogProvider.mode,
        data_source: 'LIVE',
        simulated: false,
        code: err.code,
        error: err.message,
      });
      return;
    }
    res.status(502).json({
      success: false,
      service: service || 'all',
      provider: activeLogProvider.mode,
      data_source: activeLogProvider.mode === 'http' ? 'LIVE' : 'SIMULATED',
      simulated: activeLogProvider.mode === 'mock',
      code: 'LOG_QUERY_FAILED',
      error: err?.message || 'Failed to retrieve structured logs.',
    });
  }
});

/**
 * Distributed trace provider status
 */
app.get('/api/traces/status', async (_req: Request, res: Response) => {
  try {
    const status = await activeTraceProvider.getStatus();
    const httpCode = status.provider === 'http' && (!status.configured || !status.connected) ? 503 : 200;
    res.status(httpCode).json(status);
  } catch (err: any) {
    res.status(503).json({
      provider: activeTraceProvider.mode,
      configured: false,
      connected: false,
      data_source: activeTraceProvider.mode === 'http' ? 'LIVE' : 'SIMULATED',
      simulated: activeTraceProvider.mode === 'mock',
      trace_source_url_configured: false,
      code: 'TRACE_PROVIDER_ERROR',
      message: err?.message || 'Unable to inspect trace provider status.',
    });
  }
});

/**
 * Retrieve distributed traces filtered by service and time window (since).
 * Preserves parent-child span relationships and identifies slow/failed spans.
 * Never falls back to simulated data when provider=http fails.
 */
app.get('/api/traces', async (req: Request, res: Response) => {
  const service = typeof req.query.service === 'string' && req.query.service.trim()
    ? req.query.service.trim()
    : undefined;
  const rawSince = typeof req.query.since === 'string' && req.query.since.trim()
    ? req.query.since.trim()
    : undefined;
  const rawLimit = typeof req.query.limit === 'string' && req.query.limit.trim()
    ? Number(req.query.limit.trim())
    : undefined;

  if (rawSince && parseSinceTimestamp(rawSince) === undefined) {
    res.status(400).json({
      success: false,
      service: service || 'all',
      provider: activeTraceProvider.mode,
      data_source: activeTraceProvider.mode === 'http' ? 'LIVE' : 'SIMULATED',
      simulated: activeTraceProvider.mode === 'mock',
      code: 'INVALID_SINCE_TIMESTAMP',
      error: `Invalid since parameter "${rawSince}". Use an ISO-8601 timestamp or relative duration (e.g. 15m, 1h, 1d).`,
    });
    return;
  }

  try {
    const data = await activeTraceProvider.queryTraces({
      service,
      since: rawSince,
      limit: Number.isFinite(rawLimit) ? rawLimit : undefined,
    });
    res.json({
      success: true,
      ...data,
    });
  } catch (err: any) {
    if (err instanceof TraceProviderError) {
      res.status(err.statusCode).json({
        success: false,
        service: service || 'all',
        provider: activeTraceProvider.mode,
        data_source: 'LIVE',
        simulated: false,
        code: err.code,
        error: err.message,
      });
      return;
    }
    res.status(502).json({
      success: false,
      service: service || 'all',
      provider: activeTraceProvider.mode,
      data_source: activeTraceProvider.mode === 'http' ? 'LIVE' : 'SIMULATED',
      simulated: activeTraceProvider.mode === 'mock',
      code: 'TRACE_QUERY_FAILED',
      error: err?.message || 'Failed to retrieve distributed traces.',
    });
  }
});

/**
 * Retrieve a single distributed trace and its parent-child spans by traceId
 */
app.get('/api/traces/:traceId', async (req: Request, res: Response) => {
  const traceId = (req.params.traceId || '').trim();
  if (!traceId) {
    res.status(400).json({
      success: false,
      code: 'INVALID_TRACE_ID',
      error: 'Validation failed: traceId is required.',
    });
    return;
  }

  try {
    const data = await activeTraceProvider.getTraceById(traceId);
    res.json({
      success: true,
      ...data,
    });
  } catch (err: any) {
    if (err instanceof TraceProviderError) {
      res.status(err.statusCode).json({
        success: false,
        provider: activeTraceProvider.mode,
        data_source: activeTraceProvider.mode === 'http' ? 'LIVE' : 'SIMULATED',
        simulated: activeTraceProvider.mode === 'mock',
        code: err.code,
        error: err.message,
      });
      return;
    }
    res.status(502).json({
      success: false,
      provider: activeTraceProvider.mode,
      data_source: activeTraceProvider.mode === 'http' ? 'LIVE' : 'SIMULATED',
      simulated: activeTraceProvider.mode === 'mock',
      code: 'TRACE_LOOKUP_FAILED',
      error: err?.message || 'Failed to retrieve distributed trace.',
    });
  }
});

/**
 * Cross-signal evidence correlation endpoint.
 * Aggregates metrics, structured logs, and distributed traces for a service/time window,
 * building a chronological timeline with per-item provenance (SIMULATED / LIVE / UNAVAILABLE),
 * grouped signal summaries, transparent confidence, and causation disclaimer.
 */
app.get('/api/correlation', async (req: Request, res: Response) => {
  const service = typeof req.query.service === 'string' && req.query.service.trim()
    ? req.query.service.trim()
    : 'auth-gateway-prod';
  const since = typeof req.query.since === 'string' && req.query.since.trim()
    ? req.query.since.trim()
    : '30m';

  if (parseSinceTimestamp(since) === undefined) {
    res.status(400).json({
      success: false,
      code: 'INVALID_SINCE_TIMESTAMP',
      error: `Invalid since parameter "${since}". Use an ISO-8601 timestamp or relative duration (e.g. 15m, 1h, 1d).`,
    });
    return;
  }

  const [metricsEvidence, logsEvidence, tracesEvidence] = await Promise.all([
    collectServiceMetricEvidence(service),
    collectServiceLogEvidence(service, since),
    collectServiceTraceEvidence(service, since),
  ]);

  const correlation = correlateIncidentEvidence({
    service,
    since,
    metrics_evidence: metricsEvidence,
    logs_evidence: logsEvidence,
    traces_evidence: tracesEvidence,
  });

  res.json({
    success: true,
    correlation,
  });
});

/**
 * Get webhook configuration status (without exposing secrets to client)
 */
app.get('/api/webhook/status', (_req: Request, res: Response) => {
  const isConfigured = Boolean(process.env.N8N_WEBHOOK_URL && process.env.N8N_WEBHOOK_URL.trim() !== '');
  res.json({
    configured: isConfigured,
    simulation_enforced: true,
    env_variable: 'N8N_WEBHOOK_URL',
    message: isConfigured
      ? 'n8n production webhook endpoint is configured in server environment.'
      : 'N8N_WEBHOOK_URL is not set in server environment. Please configure it in your environment variables/secrets.',
  });
});

/**
 * Runtime Claude Inference Health Tracker
 * Distinguishes: API key configured vs live inference working vs fallback active
 */
export const claudeRuntimeState: {
  status: 'untested' | 'live_ok' | 'fallback_active';
  checkedAt: string | null;
  lastError?: string;
  lastCode?: string;
} = {
  status: 'untested',
  checkedAt: null,
};

/**
 * Anthropic Claude Configuration & Inference Status
 */
app.get('/api/claude/status', (_req: Request, res: Response) => {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const isConfigured = Boolean(apiKey && apiKey !== '' && apiKey !== 'MY_ANTHROPIC_API_KEY');
  const inferenceStatus = !isConfigured ? 'unconfigured' : claudeRuntimeState.status;
  const liveWorking = isConfigured && claudeRuntimeState.status === 'live_ok';
  const fallbackActive = !isConfigured || claudeRuntimeState.status === 'fallback_active';

  res.json({
    configured: isConfigured,
    inference_status: inferenceStatus,
    live_inference_working: liveWorking,
    fallback_active: fallbackActive,
    last_checked_at: claudeRuntimeState.checkedAt,
    ...(isConfigured && claudeRuntimeState.status === 'fallback_active' && claudeRuntimeState.lastError
      ? { last_error: claudeRuntimeState.lastError }
      : {}),
    model: 'claude-3-7-sonnet-20250219',
    provider: 'Anthropic Claude',
    simulation_enforced: true,
    message: !isConfigured
      ? 'ANTHROPIC_API_KEY is not configured in server environment (demo/fallback diagnosis active).'
      : liveWorking
      ? 'Anthropic Claude live inference verified and operational.'
      : claudeRuntimeState.status === 'fallback_active'
      ? 'ANTHROPIC_API_KEY is configured, but live inference failed; demo/fallback diagnosis is active.'
      : 'ANTHROPIC_API_KEY is configured; live inference has not been verified yet (grounded fallback ready).',
  });
});

interface MetricEvidenceObservation {
  name: string;
  label: string;
  value: number | null;
  unit: string;
  status: 'observed' | 'missing' | 'unavailable';
}

interface MetricEvidenceSummary {
  available: boolean;
  service: string;
  timestamp: string;
  provider: 'mock' | 'prometheus';
  data_source: 'SIMULATED' | 'LIVE';
  simulated: boolean;
  observations: MetricEvidenceObservation[];
  missing_metrics: string[];
  unavailable_reason?: string;
}

const METRIC_SPECS: { key: keyof MetricEvidenceValues; label: string; unit: string }[] = [
  { key: 'cpu_usage_percent', label: 'CPU Usage', unit: '%' },
  { key: 'memory_usage_percent', label: 'Memory Usage', unit: '%' },
  { key: 'http_request_rate_rps', label: 'HTTP Request Rate', unit: 'rps' },
  { key: 'http_error_rate_percent', label: 'HTTP Error Rate', unit: '%' },
  { key: 'api_latency_p95_ms', label: 'API Latency (p95)', unit: 'ms' },
];

type MetricEvidenceValues = {
  cpu_usage_percent: number | null;
  memory_usage_percent: number | null;
  http_request_rate_rps: number | null;
  http_error_rate_percent: number | null;
  api_latency_p95_ms: number | null;
};

async function collectServiceMetricEvidence(service: string): Promise<MetricEvidenceSummary> {
  const targetService = service || 'auth-gateway-prod';
  try {
    const result = await activeMetricsProvider.getMetrics(targetService);
    const observations: MetricEvidenceObservation[] = METRIC_SPECS.map((spec) => {
      const val = result.metrics[spec.key];
      return {
        name: spec.key,
        label: spec.label,
        value: val,
        unit: spec.unit,
        status: val === null ? 'missing' : 'observed',
      };
    });

    return {
      available: true,
      service: result.service,
      timestamp: result.timestamp,
      provider: result.provider,
      data_source: result.data_source,
      simulated: result.simulated,
      observations,
      missing_metrics: result.missing_metrics,
    };
  } catch (err: any) {
    // Never silently replace failed LIVE Prometheus metrics with simulated data
    return {
      available: false,
      service: targetService,
      timestamp: new Date().toISOString(),
      provider: activeMetricsProvider.mode,
      data_source: activeMetricsProvider.mode === 'prometheus' ? 'LIVE' : 'SIMULATED',
      simulated: activeMetricsProvider.mode === 'mock',
      observations: METRIC_SPECS.map((spec) => ({
        name: spec.key,
        label: spec.label,
        value: null,
        unit: spec.unit,
        status: 'unavailable',
      })),
      missing_metrics: METRIC_SPECS.map((s) => s.key),
      unavailable_reason: err?.message || 'Metrics provider unavailable.',
    };
  }
}

interface LogEvidenceSummary {
  available: boolean;
  service: string;
  since?: string;
  timestamp: string;
  provider: 'mock' | 'http';
  data_source: 'SIMULATED' | 'LIVE';
  simulated: boolean;
  total: number;
  logs: StructuredLogEntry[];
  unavailable_reason?: string;
}

async function collectServiceLogEvidence(service: string, since = '30m'): Promise<LogEvidenceSummary> {
  const targetService = service || 'auth-gateway-prod';
  try {
    const result = await activeLogProvider.queryLogs({
      service: targetService,
      since,
      limit: 6,
    });
    return {
      available: true,
      service: targetService,
      since: result.since || since,
      timestamp: result.timestamp,
      provider: result.provider,
      data_source: result.data_source,
      simulated: result.simulated,
      total: result.total,
      logs: result.logs,
    };
  } catch (err: any) {
    // Never silently replace failed LIVE log retrieval with simulated logs
    return {
      available: false,
      service: targetService,
      since,
      timestamp: new Date().toISOString(),
      provider: activeLogProvider.mode,
      data_source: activeLogProvider.mode === 'http' ? 'LIVE' : 'SIMULATED',
      simulated: activeLogProvider.mode === 'mock',
      total: 0,
      logs: [],
      unavailable_reason: err?.message || 'Log provider unavailable.',
    };
  }
}

interface TraceEvidenceSummary {
  available: boolean;
  service: string;
  since?: string;
  timestamp: string;
  provider: 'mock' | 'http';
  data_source: 'SIMULATED' | 'LIVE';
  simulated: boolean;
  total: number;
  traces: DistributedTrace[];
  slow_spans_count: number;
  failed_spans_count: number;
  unavailable_reason?: string;
}

async function collectServiceTraceEvidence(service: string, since = '30m'): Promise<TraceEvidenceSummary> {
  const targetService = service || 'auth-gateway-prod';
  try {
    const result = await activeTraceProvider.queryTraces({
      service: targetService,
      since,
      limit: 5,
    });
    const slowCount = result.traces.reduce((acc, tr) => acc + tr.slow_spans.length, 0);
    const failedCount = result.traces.reduce((acc, tr) => acc + tr.failed_spans.length, 0);
    return {
      available: true,
      service: targetService,
      since: result.since || since,
      timestamp: result.timestamp,
      provider: result.provider,
      data_source: result.data_source,
      simulated: result.simulated,
      total: result.total,
      traces: result.traces,
      slow_spans_count: slowCount,
      failed_spans_count: failedCount,
    };
  } catch (err: any) {
    // Never silently replace failed LIVE trace retrieval with simulated traces
    return {
      available: false,
      service: targetService,
      since,
      timestamp: new Date().toISOString(),
      provider: activeTraceProvider.mode,
      data_source: activeTraceProvider.mode === 'http' ? 'LIVE' : 'SIMULATED',
      simulated: activeTraceProvider.mode === 'mock',
      total: 0,
      traces: [],
      slow_spans_count: 0,
      failed_spans_count: 0,
      unavailable_reason: err?.message || 'Trace provider unavailable.',
    };
  }
}

function formatMetricEvidenceNarrative(me: MetricEvidenceSummary): string {
  if (!me.available) {
    return `[${me.data_source} telemetry unavailable at ${me.timestamp}: ${me.unavailable_reason || 'provider error'} — missing metrics were not invented]`;
  }
  const observedParts = me.observations
    .filter((o) => o.status === 'observed' && o.value !== null)
    .map((o) => `${o.name}=${o.value}${o.unit}`);
  const missingParts = me.observations
    .filter((o) => o.status !== 'observed')
    .map((o) => o.name);

  const observedText = observedParts.length > 0 ? observedParts.join(', ') : 'none';
  const missingText = missingParts.length > 0 ? `; unavailable/missing=[${missingParts.join(', ')}]` : '';
  return `[${me.data_source} metrics via ${me.provider} @ ${me.timestamp}]: ${observedText}${missingText}`;
}

function formatLogEvidenceLines(le: LogEvidenceSummary): string[] {
  if (!le.available) {
    return [
      `[${le.data_source} logs unavailable via ${le.provider} @ ${le.timestamp}: ${le.unavailable_reason || 'provider error'} — missing log events were not invented]`,
    ];
  }
  if (le.logs.length === 0) {
    return [
      `[${le.data_source} logs via ${le.provider} @ ${le.timestamp}]: No log events matched service="${le.service}" within window="${le.since || '30m'}" — missing log events were not invented.`,
    ];
  }
  return le.logs.map(
    (entry) =>
      `[${entry.severity}][${entry.data_source}][${entry.timestamp}] (${entry.service}${
        entry.trace_id ? ` trace=${entry.trace_id}` : ''
      }): ${redactLogMessage(entry.message)}`
  );
}

/**
 * Deterministic evidence-grounded fallback diagnosis
 * Used when ANTHROPIC_API_KEY is unset, unavailable, or skip_live_claude=true
 */
function generateFallbackStructuredDiagnosis(incidentId: string, evidence: any) {
  const culprit =
    evidence?.alert?.service ||
    evidence?.metrics_evidence?.service ||
    evidence?.logs_evidence?.service ||
    evidence?.traces_evidence?.service ||
    'auth-gateway-prod';
  const deployCommit = evidence?.deployments?.[0]?.commitSha || 'v2.14.8 (commit 3a8f9c1)';
  const me: MetricEvidenceSummary | undefined = evidence?.metrics_evidence;
  const le: LogEvidenceSummary | undefined = evidence?.logs_evidence;
  const te: TraceEvidenceSummary | undefined = evidence?.traces_evidence;
  const correlation: EvidenceCorrelationResult =
    evidence?.correlation ||
    correlateIncidentEvidence({
      service: culprit,
      since: le?.since || te?.since || '30m',
      metrics_evidence: me,
      logs_evidence: le,
      traces_evidence: te,
    });
  const metricsNarrative = me ? formatMetricEvidenceNarrative(me) : null;

  const primaryTrace = te?.available && te.traces.length > 0 ? te.traces[0] : undefined;
  const culpritTraceSpan =
    primaryTrace?.failed_spans?.[primaryTrace.failed_spans.length - 1] ||
    primaryTrace?.slow_spans?.[primaryTrace.slow_spans.length - 1] ||
    primaryTrace?.spans?.[primaryTrace.spans.length - 1];

  const traceId =
    primaryTrace?.trace_id ||
    evidence?.logs_evidence?.logs?.find((l: StructuredLogEntry) => l.trace_id)?.trace_id ||
    evidence?.traces?.[0]?.id ||
    (te && (!te.available || te.traces.length === 0) ? 'UNAVAILABLE' : 'tr-8892-hikari-exhaustion');

  const observedLatencyObs = me?.observations.find((o) => o.name === 'api_latency_p95_ms' && o.status === 'observed');
  const observedErrorObs = me?.observations.find((o) => o.name === 'http_error_rate_percent' && o.status === 'observed');
  const sourceTag = me ? `${me.data_source} (${me.provider})` : 'UNATTACHED';

  const topLog = le?.available && le.logs.length > 0 ? le.logs[0] : undefined;
  const highSevCount = le?.available ? le.logs.filter((l) => l.severity === 'FATAL' || l.severity === 'ERROR').length : 0;
  const logSummaryClause = le
    ? le.available
      ? topLog
        ? ` Structured ${le.data_source} logs (${le.logs.length} events, ${highSevCount} ERROR/FATAL, latest ${topLog.severity} @ ${topLog.timestamp}) corroborate downstream strain.`
        : ` Structured ${le.data_source} logs returned 0 matching events for ${le.service} (missing logs were not invented).`
      : ` Structured ${le.data_source} log retrieval failed (${le.unavailable_reason || 'unavailable'}) and missing logs were not invented.`
    : '';

  const traceSummaryClause = te
    ? te.available
      ? primaryTrace
        ? ` Distributed ${te.data_source} traces (${te.total} trace(s), ${te.failed_spans_count} failed span(s), ${te.slow_spans_count} slow span(s); root ${primaryTrace.trace_id} across ${primaryTrace.spans.map((s) => s.service_name).join(' -> ')}) show span timing propagation.`
        : ` Distributed ${te.data_source} trace query returned 0 traces for ${te.service} (missing spans were not invented).`
      : ` Distributed ${te.data_source} trace retrieval failed (${te.unavailable_reason || 'unavailable'}) and missing spans were not invented.`
    : '';

  const summary = me
    ? me.available
      ? `Incident ${incidentId} on ${culprit} shows resource/latency pressure correlated with canary ${deployCommit} (${metricsNarrative}).${logSummaryClause}${traceSummaryClause} Neither metrics correlation, log messages, nor trace timing alone establish causation.`
      : `Incident ${incidentId} on ${culprit} correlated with canary ${deployCommit}; ${me.data_source} metrics are currently unavailable (${me.unavailable_reason || 'provider failure'}) and were not invented.${logSummaryClause}${traceSummaryClause}`
    : `Connection pool exhaustion on ${culprit} correlated with canary release ${deployCommit}.${logSummaryClause}${traceSummaryClause}`;

  const probableRootCause = me
    ? me.available
      ? `Observed ${sourceTag} metrics at ${me.timestamp}${
          observedLatencyObs ? ` (api_latency_p95_ms=${observedLatencyObs.value}ms` : ''
        }${observedErrorObs ? `${observedLatencyObs ? ', ' : ' ('}http_error_rate_percent=${observedErrorObs.value}%` : ''}${
          observedLatencyObs || observedErrorObs ? ')' : ''
        }, structured ${le ? `${le.data_source} logs (${le.total} events)` : 'telemetry'}, and ${
          te
            ? te.available
              ? `${te.data_source} distributed traces (${te.total} trace(s)${
                  culpritTraceSpan
                    ? `, leaf culprit ${culpritTraceSpan.service_name}:${culpritTraceSpan.operation_name} ${culpritTraceSpan.duration_ms}ms [${culpritTraceSpan.status}]`
                    : ''
                })`
              : `${te.data_source} traces unavailable`
            : 'span context'
        } align with canary release ${deployCommit} HikariCP pool contention (${correlation.timeline.length} timeline events across ${correlation.groups.length} group(s)). Observed correlation across signals does not by itself prove causation.`
      : `Canary release ${deployCommit} HikariCP pool contention is hypothesized from alert/trace evidence. ${me.data_source} metrics retrieval failed (${me.unavailable_reason || 'unavailable'}), so numeric metric values remain unverified.${logSummaryClause}${traceSummaryClause}`
    : `Canary release ${deployCommit} deployed with un-tuned HikariCP maximumPoolSize (10 connections), causing thread contention across worker pods.${logSummaryClause}${traceSummaryClause}`;

  const hypothesisExplanation = me
    ? `Telemetry (${metricsNarrative}${le ? `; logs=${le.data_source}/${le.provider}:${le.total}` : ''}${
        te ? `; traces=${te.data_source}/${te.provider}:${te.total}` : ''
      }) indicates elevated service strain following deploy ${deployCommit}. ${correlation.hypothesis.explanation}`
    : 'Telemetry indicates db connection acquisition latency elevated immediately following the v2.14.8 canary deploy.';

  const structuredLogLines = le ? formatLogEvidenceLines(le) : [];
  const providedLogs = Array.isArray(evidence?.logs)
    ? evidence.logs.slice(0, 3).map((l: any) =>
        typeof l === 'string'
          ? redactLogMessage(l)
          : `[${l.severity || 'INFO'}] ${redactLogMessage(String(l.message || l.payload || ''))}`
      )
    : [];

  const traceLine = te
    ? te.available
      ? primaryTrace
        ? `[TRACES:${te.data_source} (${te.provider})] ${primaryTrace.trace_id}: ${primaryTrace.spans
            .map((s) => `${s.service_name}:${s.operation_name}(${s.duration_ms}ms,${s.status})`)
            .join(' -> ')}`
        : `[TRACES:${te.data_source} (${te.provider})]: No matching traces in window (${te.since || '30m'}) — missing spans were not invented.`
      : `[TRACES:${te.data_source} (${te.provider}) UNAVAILABLE]: ${te.unavailable_reason || 'provider error'} — missing spans were not invented.`
    : null;

  const keyLogLines =
    structuredLogLines.length > 0
      ? [
          ...structuredLogLines,
          ...(metricsNarrative ? [`[METRICS:${sourceTag}] ${metricsNarrative}`] : []),
          ...(traceLine ? [traceLine] : []),
        ]
      : [
          ...providedLogs,
          ...(metricsNarrative ? [`[METRICS:${sourceTag}] ${metricsNarrative}`] : []),
          ...(traceLine ? [traceLine] : []),
        ];

  return {
    summary,
    probable_root_cause: probableRootCause,
    confidence: correlation.hypothesis.confidence,
    observed_evidence: {
      culprit_resource: culpritTraceSpan?.service_name || culprit,
      trace_id: traceId,
      culprit_span: culpritTraceSpan?.operation_name || (te && !te.available ? 'Unavailable' : 'HikariPool.getConnection()'),
      duration_ms: culpritTraceSpan?.duration_ms ?? (te && (!te.available || te.traces.length === 0) ? 0 : 1240),
      baseline_ms: 12,
      deploy_commit: deployCommit,
      key_log_lines: keyLogLines,
      ...(me ? { metrics_evidence: me } : {}),
      ...(le ? { logs_evidence: le } : {}),
      ...(te ? { traces_evidence: te } : {}),
      timeline: correlation.timeline,
      source_provenance: correlation.source_provenance,
      missing_and_limitations: correlation.missing_and_limitations,
    },
    ai_hypothesis: {
      title: 'HikariCP Connection Pool Exhaustion (v2.14.8 Canary Driver Regression)',
      explanation: hypothesisExplanation,
      affected_components: ['auth-gateway-canary-01', 'auth-gateway-canary-02', 'auth-gateway-worker-03', 'auth-gateway-worker-04'],
      confidence_explanation: correlation.hypothesis.confidence_explanation,
      causation_disclaimer: correlation.hypothesis.causation_disclaimer,
    },
    proposed_remediation: {
      action: 'scale_connection_pool_canary',
      command: 'kubectl patch configmap auth-gateway-config -n prod --patch-file patch-hikaricp-pool.yaml --dry-run=client -o yaml',
      old_config: 'spring.datasource.hikari.maximum-pool-size: 10\nspring.datasource.hikari.connection-timeout: 30000\nspring.datasource.hikari.leak-detection-threshold: 0',
      new_config: 'spring.datasource.hikari.maximum-pool-size: 60\nspring.datasource.hikari.connection-timeout: 5000\nspring.datasource.hikari.leak-detection-threshold: 2000',
      estimated_mitigation_seconds: 45,
      flags: [
        { name: 'DRAIN_STALE_CONNECTIONS', value: 'true', description: 'Drain hanging sockets before rolling pod restart', enabled: true },
        { name: 'ROLLING_CANARY_FIRST', value: 'true', description: 'Apply configuration patch to canary pod partition first', enabled: true },
        { name: 'AUTO_REVERT_ON_ERROR_SPIKE', value: 'true', description: 'Trigger automatic rollback if 5xx errors do not recover in 60s', enabled: true },
      ],
    },
    risks: [
      'Brief 150ms socket renegotiation blip during pool resize',
      'Target PostgreSQL instance connection limit will increase by 50 pool slots',
    ],
    correlation,
  };
}

/**
 * Shared Claude AI diagnosis helper (reused by /api/claude/diagnose and unified workflow orchestrator)
 * Never executes commands; strictly returns structured diagnosis + allowlist-clamped action.
 */
async function runClaudeDiagnosisService(
  incidentId: string,
  evidence: {
    alert?: any;
    logs?: any[];
    traces?: any[];
    deployments?: any[];
    historical_incidents?: any[];
    metrics_evidence?: MetricEvidenceSummary;
    logs_evidence?: LogEvidenceSummary;
    traces_evidence?: TraceEvidenceSummary;
    correlation?: EvidenceCorrelationResult;
  }
): Promise<{
  success: boolean;
  live: boolean;
  model: string;
  provider: string;
  diagnosis_source: 'claude_live' | 'demo_fallback';
  diagnosis: any;
  error?: string;
  code?: string;
  httpStatus: number;
  raw?: string;
}> {
  const serviceName =
    evidence.alert?.service ||
    evidence.metrics_evidence?.service ||
    evidence.logs_evidence?.service ||
    evidence.traces_evidence?.service ||
    'auth-gateway-prod';
  const [metricEvidence, logEvidence, traceEvidence] = await Promise.all([
    evidence.metrics_evidence ? Promise.resolve(evidence.metrics_evidence) : collectServiceMetricEvidence(serviceName),
    evidence.logs_evidence ? Promise.resolve(evidence.logs_evidence) : collectServiceLogEvidence(serviceName),
    evidence.traces_evidence ? Promise.resolve(evidence.traces_evidence) : collectServiceTraceEvidence(serviceName),
  ]);
  const correlation =
    evidence.correlation ||
    correlateIncidentEvidence({
      service: serviceName,
      since: logEvidence.since || traceEvidence.since || '30m',
      metrics_evidence: metricEvidence,
      logs_evidence: logEvidence,
      traces_evidence: traceEvidence,
    });
  const sanitizedAdHocLogs = (evidence.logs || []).slice(0, 10).map((entry) =>
    typeof entry === 'string'
      ? redactLogMessage(entry)
      : {
          ...entry,
          ...(entry.message ? { message: redactLogMessage(String(entry.message)) } : {}),
          ...(entry.payload ? { payload: redactLogMessage(String(entry.payload)) } : {}),
        }
  );
  const enrichedEvidence = {
    ...evidence,
    logs: sanitizedAdHocLogs,
    metrics_evidence: metricEvidence,
    logs_evidence: logEvidence,
    traces_evidence: traceEvidence,
    correlation,
  };
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

  if (!apiKey || apiKey === 'MY_ANTHROPIC_API_KEY') {
    claudeRuntimeState.status = 'fallback_active';
    claudeRuntimeState.checkedAt = new Date().toISOString();
    claudeRuntimeState.lastCode = 'ANTHROPIC_API_KEY_MISSING';
    claudeRuntimeState.lastError = 'ANTHROPIC_API_KEY is not configured in server environment.';
    return {
      success: false,
      live: false,
      model: 'claude-3-7-sonnet-20250219',
      provider: 'Anthropic Claude',
      diagnosis_source: 'demo_fallback',
      diagnosis: generateFallbackStructuredDiagnosis(incidentId, enrichedEvidence),
      error: 'ANTHROPIC_API_KEY is not configured in server environment. Configure ANTHROPIC_API_KEY in server secrets.',
      code: 'ANTHROPIC_API_KEY_MISSING',
      httpStatus: 503,
    };
  }

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey });

    const systemPrompt = `You are IncidentPilot, an expert Site Reliability Engineer (SRE) and distributed systems architect.
Analyze the provided incident evidence (alerts, service performance metrics, structured application logs, distributed traces/spans, recent deployments, and historical incidents) and generate a rigorous technical diagnosis.

CRITICAL INSTRUCTIONS:
1. Clearly distinguish OBSERVED EVIDENCE (facts extracted directly from metrics, structured logs, distributed trace spans, and git commits) from AI HYPOTHESES (inferences, deductive conclusions, and root-cause theories).
2. Cite exact metric names, values, timestamps, log severities, trace/span IDs, service names, operation names, durations, parent-child span links, and data_source (SIMULATED vs LIVE) from the provided telemetry. Never invent or interpolate missing or unavailable metrics, log events, or spans, never treat correlation as proof of causation, and never treat a single log/span alone as proof of root cause.
3. Recommend a safe, declarative remediation action chosen STRICTLY from this allowlist:
   ['scale_connection_pool_canary', 'apply_hotfix_patch', 'drain_stale_connections', 'rolling_restart_canary', 'enable_token_cache_bypass', 'test_connection']
4. You must NEVER execute shell commands, Kubernetes commands, or infrastructure modifications directly. Produce ONLY a declarative dry-run configuration diff and remediation parameter safeguards.
5. You MUST return your response as valid, raw JSON conforming exactly to this structure (no markdown wrapping, no explanation outside JSON):
{
  "summary": "<Concise 1-2 sentence executive technical summary>",
  "probable_root_cause": "<Detailed technical explanation of the failure mechanism noting correlation vs causation>",
  "confidence": <number between 0 and 100>,
  "observed_evidence": {
    "culprit_resource": "<Specific service, pool, or database resource identified in telemetry>",
    "trace_id": "<Trace ID from evidence or 'N/A'>",
    "culprit_span": "<Span operation name causing the delay>",
    "duration_ms": <Observed latency/duration in ms>,
    "baseline_ms": <Normal expected latency in ms>,
    "deploy_commit": "<Correlated git commit or version from deployment evidence>",
    "key_log_lines": ["<Directly quoted redacted key log messages with timestamp, severity, service, data_source>"]
  },
  "ai_hypothesis": {
    "title": "<Concise title of root cause hypothesis>",
    "explanation": "<Deductive reasoning linking observed evidence to the root cause without claiming correlation or log/span lines alone prove causation>",
    "affected_components": ["<List of affected Kubernetes pods or services>"]
  },
  "proposed_remediation": {
    "action": "<Must strictly match an allowed action from the list>",
    "command": "<Declarative CLI dry-run command>",
    "old_config": "<Failing configuration snippet>",
    "new_config": "<Proposed patched configuration snippet>",
    "estimated_mitigation_seconds": <number of seconds estimated to mitigate>,
    "flags": [
      {
        "name": "<FLAG_NAME>",
        "value": "<value>",
        "description": "<What this safeguard flag enforces>",
        "enabled": true
      }
    ]
  },
  "risks": [
    "<Operational risk or trade-off of applying this remediation>"
  ]
}`;

    const userPrompt = `Incident: "${incidentId}"
Alert context: ${JSON.stringify(evidence.alert || {})}
Service performance metrics (${metricEvidence.data_source} via ${metricEvidence.provider} at ${metricEvidence.timestamp}): ${JSON.stringify(metricEvidence)}
Structured log evidence (${logEvidence.data_source} via ${logEvidence.provider} at ${logEvidence.timestamp}): ${JSON.stringify(logEvidence)}
Distributed trace evidence (${traceEvidence.data_source} via ${traceEvidence.provider} at ${traceEvidence.timestamp}): ${JSON.stringify(traceEvidence)}
Cross-signal correlation summary (chronological timeline, provenance, anomalies, limitations): ${JSON.stringify({
  source_provenance: correlation.source_provenance,
  detected_anomalies: correlation.detected_anomalies,
  key_observations: correlation.key_observations,
  supporting_evidence_refs: correlation.supporting_evidence_refs,
  missing_and_limitations: correlation.missing_and_limitations,
  timeline: correlation.timeline.slice(0, 15),
})}
Additional sanitized logs: ${JSON.stringify(sanitizedAdHocLogs)}
Additional trace spans: ${JSON.stringify((evidence.traces || []).slice(0, 5))}
Recent deployments: ${JSON.stringify(evidence.deployments || [])}
Historical incident correlations: ${JSON.stringify(evidence.historical_incidents || [])}`;

    const generatePromise = anthropic.messages.create({
      model: 'claude-3-7-sonnet-20250219',
      max_tokens: 1800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Claude API call timed out in sandbox after 5000ms')), 5000)
    );

    const message: any = await Promise.race([generatePromise, timeoutPromise]);
    const rawContent = message.content?.[0]?.type === 'text' ? message.content[0].text : '';

    let cleaned = rawContent.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }

    let parsedDiagnosis: any;
    try {
      parsedDiagnosis = JSON.parse(cleaned);
    } catch {
      claudeRuntimeState.status = 'fallback_active';
      claudeRuntimeState.checkedAt = new Date().toISOString();
      claudeRuntimeState.lastCode = 'MALFORMED_CLAUDE_RESPONSE';
      claudeRuntimeState.lastError = 'Claude returned a malformed non-JSON response.';
      return {
        success: false,
        live: false,
        model: message.model || 'claude-3-7-sonnet-20250219',
        provider: 'Anthropic Claude',
        diagnosis_source: 'demo_fallback',
        diagnosis: generateFallbackStructuredDiagnosis(incidentId, enrichedEvidence),
        error: 'Claude returned a malformed non-JSON response.',
        code: 'MALFORMED_CLAUDE_RESPONSE',
        raw: rawContent,
        httpStatus: 502,
      };
    }

    if (!ALLOWED_ACTIONS.includes(parsedDiagnosis.proposed_remediation?.action)) {
      parsedDiagnosis.proposed_remediation.action = 'scale_connection_pool_canary';
    }
    const existingLogLines: string[] = Array.isArray(parsedDiagnosis.observed_evidence?.key_log_lines)
      ? parsedDiagnosis.observed_evidence.key_log_lines.map((line: any) => redactLogMessage(String(line)))
      : formatLogEvidenceLines(logEvidence);
    parsedDiagnosis.observed_evidence = {
      ...(parsedDiagnosis.observed_evidence || {}),
      key_log_lines: existingLogLines,
      metrics_evidence: metricEvidence,
      logs_evidence: logEvidence,
      traces_evidence: traceEvidence,
      timeline: correlation.timeline,
      source_provenance: correlation.source_provenance,
      missing_and_limitations: correlation.missing_and_limitations,
    };
    parsedDiagnosis.ai_hypothesis = {
      ...(parsedDiagnosis.ai_hypothesis || {}),
      confidence_explanation: correlation.hypothesis.confidence_explanation,
      causation_disclaimer: correlation.hypothesis.causation_disclaimer,
    };
    parsedDiagnosis.correlation = correlation;

    claudeRuntimeState.status = 'live_ok';
    claudeRuntimeState.checkedAt = new Date().toISOString();
    delete claudeRuntimeState.lastCode;
    delete claudeRuntimeState.lastError;

    return {
      success: true,
      live: true,
      model: message.model || 'claude-3-7-sonnet-20250219',
      provider: 'Anthropic Claude',
      diagnosis_source: 'claude_live',
      diagnosis: parsedDiagnosis,
      httpStatus: 200,
    };
  } catch (err: any) {
    claudeRuntimeState.status = 'fallback_active';
    claudeRuntimeState.checkedAt = new Date().toISOString();
    claudeRuntimeState.lastCode = 'CLAUDE_API_ERROR';
    claudeRuntimeState.lastError = `Claude diagnosis API call failed: ${err.message}`;
    return {
      success: false,
      live: false,
      model: 'claude-3-7-sonnet-20250219',
      provider: 'Anthropic Claude',
      diagnosis_source: 'demo_fallback',
      diagnosis: generateFallbackStructuredDiagnosis(incidentId, enrichedEvidence),
      error: `Claude diagnosis API call failed: ${err.message}`,
      httpStatus: 502,
    };
  }
}

/**
 * Claude Root Cause Diagnosis Endpoint
 * Evaluates incident evidence (alerts, metrics, logs, traces, deploys) via Anthropic API
 */
app.post('/api/claude/diagnose', async (req: Request, res: Response) => {
  const { incident_id, alert, logs, traces, deployments, historical_incidents } = req.body;

  if (!incident_id || typeof incident_id !== 'string') {
    res.status(400).json({
      error: 'Validation failed: incident_id is required and must be a string.',
      code: 'INVALID_INCIDENT_ID',
    });
    return;
  }

  const result = await runClaudeDiagnosisService(incident_id, {
    alert,
    logs,
    traces,
    deployments,
    historical_incidents,
  });

  if (!result.success) {
    res.status(result.httpStatus).json({
      success: false,
      live: result.live,
      error: result.error,
      code: result.code,
      ...(result.raw ? { raw: result.raw } : {}),
      fallback_available: true,
      fallback_diagnosis: result.diagnosis,
    });
    return;
  }

  res.json({
    success: true,
    live: true,
    model: result.model,
    provider: result.provider,
    diagnosis: result.diagnosis,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Gemini Root Cause Diagnosis Endpoint
 * Evaluates incident telemetry via Gemini API (preserved for dual-engine support)
 */
app.post('/api/gemini/diagnose', async (req: Request, res: Response) => {
  const { incident_id, telemetry } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    res.status(503).json({
      error: 'GEMINI_API_KEY is not configured in server environment.',
      code: 'GEMINI_API_KEY_MISSING',
      live: false,
    });
    return;
  }

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI();
    const prompt = `You are IncidentPilot SRE Copilot. Given incident "${incident_id}" with telemetry evidence: ${JSON.stringify(telemetry || {})}, provide a concise technical diagnosis of the root cause and a safe remediation strategy.`;

    const generatePromise = ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Gemini API call timed out in sandbox after 4000ms')), 4000)
    );

    const response: any = await Promise.race([generatePromise, timeoutPromise]);

    res.json({
      success: true,
      live: true,
      model: 'gemini-3.8-flash',
      diagnosis: response.text,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(502).json({
      success: false,
      live: false,
      error: `Gemini API call failed: ${err.message}`,
      fallback_available: true,
    });
  }
});

/**
 * Dispatch human approval to n8n webhook
 *
 * Requirements:
 * 1. Validates incident_id
 * 2. Validates human_approval record (must be approved=true)
 * 3. Validates action against allowed list
 * 4. Enforces simulation_mode=true (rejects simulation_mode=false with HTTP 400)
 * 5. Calls N8N_WEBHOOK_URL with timeout and parses actual HTTP response
 */
app.post('/api/approvals/dispatch', async (req: Request, res: Response) => {
  const { incident_id, approval_id, action, approved_action, simulation_mode, human_approval, parameters } = req.body;
  const targetAction = approved_action || action;

  // 1. Validate Incident ID
  if (!incident_id || typeof incident_id !== 'string') {
    res.status(400).json({
      error: 'Validation failed: incident_id is required and must be a string.',
      code: 'INVALID_INCIDENT_ID',
    });
    return;
  }

  // 2. Validate Approval Record ID
  if (!approval_id || typeof approval_id !== 'string') {
    res.status(400).json({
      error: 'Validation failed: approval_id is required.',
      code: 'INVALID_APPROVAL_ID',
    });
    return;
  }

  // 3. Validate Explicit Human Approval
  if (!human_approval || typeof human_approval !== 'object' || human_approval.approved !== true) {
    res.status(403).json({
      error: 'Dispatch rejected: Action requires explicit human approval from an authorized Incident Commander.',
      code: 'HUMAN_APPROVAL_REQUIRED',
    });
    return;
  }

  // 4. Validate Allowed Action
  if (!targetAction || !ALLOWED_ACTIONS.includes(targetAction)) {
    res.status(400).json({
      error: `Validation failed: Action "${targetAction}" is not allowed. Allowed actions: ${ALLOWED_ACTIONS.join(', ')}.`,
      code: 'INVALID_ACTION',
    });
    return;
  }

  // 5. Strict Enforcement: simulation_mode MUST be true
  if (simulation_mode !== true) {
    res.status(400).json({
      error: 'Safety violation: Unsimulated actions are prohibited. simulation_mode must be explicitly set to true.',
      code: 'SIMULATION_MODE_REQUIRED',
    });
    return;
  }

  // 6. Check Server Environment for N8N_WEBHOOK_URL
  const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL?.trim();
  if (!n8nWebhookUrl) {
    res.status(503).json({
      error: 'N8N_WEBHOOK_URL is not configured in the server environment. Configure N8N_WEBHOOK_URL in environment secrets.',
      code: 'N8N_WEBHOOK_NOT_CONFIGURED',
      missing_secret: 'N8N_WEBHOOK_URL',
    });
    return;
  }

  // 7. Prepare n8n Payload (including approved_action as required by n8n workflow)
  const n8nPayload = {
    incident_id,
    approval_id,
    action: targetAction,
    approved_action: targetAction,
    simulation_mode: true,
    commander: {
      name: human_approval.commander_name || 'Sarah Chen',
      id: human_approval.commander_id || 's-chen-882',
      role: human_approval.commander_role || 'Staff SRE / Incident Commander',
    },
    parameters: parameters || {},
    timestamp: human_approval.timestamp || new Date().toISOString(),
  };

  // 8. Dispatch to n8n Webhook with 10-second timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'IncidentPilot-Commander/1.0',
        'Accept': 'application/json',
      },
      body: JSON.stringify(n8nPayload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseText = await response.text();
    let responseData: any;

    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { message: responseText };
    }

    if (!response.ok) {
      res.status(response.status).json({
        error: `n8n webhook returned HTTP ${response.status}`,
        code: 'N8N_WORKFLOW_ERROR',
        details: responseData,
      });
      return;
    }

    // Parse the n8n response: incident_id, approval_id, workflow_status, result_message, execution_timestamp
    const actualData = Array.isArray(responseData) ? responseData[0] : responseData;

    const parsedResult = {
      success: true,
      incident_id: actualData.incident_id || incident_id,
      approval_id: actualData.approval_id || approval_id,
      workflow_status: actualData.workflow_status || 'completed',
      result_message: actualData.result_message || 'Simulated remediation action executed successfully by n8n workflow.',
      execution_timestamp: actualData.execution_timestamp || new Date().toISOString(),
      raw: actualData,
    };

    res.status(200).json(parsedResult);
  } catch (err: any) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      res.status(504).json({
        error: 'n8n webhook dispatch timed out after 10 seconds. Check n8n service connectivity.',
        code: 'TIMEOUT',
      });
      return;
    }

    res.status(502).json({
      error: `Failed to connect to n8n webhook: ${err.message || 'Network error'}`,
      code: 'CONNECTION_FAILED',
    });
  }
});

/**
 * Get server-recorded audit history (Slack notifications, approvals, rejections, security checks)
 */
app.get('/api/audit', async (_req: Request, res: Response) => {
  try {
    const events = await activeWorkflowStore.listAuditEvents(200);
    res.json({ events });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to read audit log' });
  }
});

/**
 * Get Slack configuration status without exposing secrets, tokens, or channel IDs
 */
app.get('/api/slack/status', (_req: Request, res: Response) => {
  const cfg = getSlackConfig();
  const missingVariables: string[] = [];
  if (!cfg.botTokenConfigured) missingVariables.push('SLACK_BOT_TOKEN');
  if (!cfg.signingSecretConfigured) missingVariables.push('SLACK_SIGNING_SECRET');
  if (!cfg.channelConfigured) missingVariables.push('SLACK_CHANNEL_ID');

  const configured = cfg.botTokenConfigured && cfg.signingSecretConfigured && cfg.channelConfigured;

  res.json({
    configured,
    bot_token_configured: cfg.botTokenConfigured,
    signing_secret_configured: cfg.signingSecretConfigured,
    channel_configured: cfg.channelConfigured,
    authorized_commanders_configured: cfg.authorizedCommandersConfigured,
    simulation_enforced: true,
    missing_variables: missingVariables,
    message: configured
      ? 'Slack Web API bot token, signing secret, and channel are configured in server environment.'
      : `Slack integration is missing required server environment variables: ${missingVariables.join(', ')}.`,
  });
});

/**
 * List pending/decided approval summaries (no secrets exposed)
 */
app.get('/api/slack/approvals', async (_req: Request, res: Response) => {
  try {
    const allApprovals = await activeWorkflowStore.listApprovals();
    const approvals = allApprovals.map((rec) => ({
      approval_id: rec.approval_id,
      incident_id: rec.incident_id,
      action: rec.action,
      simulation_mode: rec.simulation_mode,
      diagnosis_source: rec.diagnosis_source,
      status: rec.status,
      created_at: new Date(rec.created_at).toISOString(),
      expires_at: new Date(rec.expires_at).toISOString(),
      decided_at: rec.decided_at,
      decided_by: rec.decided_by ? rec.decided_by.username || rec.decided_by.id : undefined,
    }));
    res.json({ approvals });
  } catch (err: any) {
    res.status(503).json({
      error: err?.message || 'Workflow store unavailable while listing approvals.',
      code: 'WORKFLOW_STORE_UNAVAILABLE',
    });
  }
});

/**
 * Send structured incident diagnosis to Slack with interactive Approve / Reject buttons
 */
app.post('/api/slack/notify', async (req: Request, res: Response) => {
  const {
    incident_id,
    severity,
    service,
    diagnosis,
    is_fallback,
    diagnosis_source,
    simulation_mode,
  } = req.body || {};

  // 1. Validate core incident metadata
  if (!incident_id || typeof incident_id !== 'string' || incident_id.trim() === '') {
    res.status(400).json({
      error: 'Validation failed: incident_id is required and must be a non-empty string.',
      code: 'INVALID_INCIDENT_ID',
    });
    return;
  }

  if (!severity || typeof severity !== 'string') {
    res.status(400).json({
      error: 'Validation failed: severity is required (e.g., SEV-1).',
      code: 'INVALID_SEVERITY',
    });
    return;
  }

  if (!service || typeof service !== 'string') {
    res.status(400).json({
      error: 'Validation failed: service is required.',
      code: 'INVALID_SERVICE',
    });
    return;
  }

  // 2. Enforce simulation_mode=true
  if (simulation_mode !== undefined && simulation_mode !== true) {
    res.status(400).json({
      error: 'Safety violation: Unsimulated Slack remediation proposals are prohibited. simulation_mode must be true.',
      code: 'SIMULATION_MODE_REQUIRED',
    });
    return;
  }

  // 3. Validate structured diagnosis format
  if (
    !diagnosis ||
    typeof diagnosis !== 'object' ||
    !diagnosis.summary ||
    !diagnosis.probable_root_cause ||
    !diagnosis.observed_evidence ||
    !diagnosis.ai_hypothesis ||
    !diagnosis.proposed_remediation
  ) {
    res.status(400).json({
      error: 'Validation failed: structured diagnosis with summary, probable_root_cause, observed_evidence, ai_hypothesis, and proposed_remediation is required.',
      code: 'INVALID_DIAGNOSIS_PAYLOAD',
    });
    return;
  }

  // 4. Validate proposed action against strict allowlist
  const proposedAction = diagnosis.proposed_remediation.action;
  if (!proposedAction || !ALLOWED_ACTIONS.includes(proposedAction)) {
    res.status(400).json({
      error: `Validation failed: Proposed action "${proposedAction}" is not in ALLOWED_ACTIONS.`,
      code: 'INVALID_ACTION',
    });
    return;
  }

  // 5. Verify Slack credentials are configured server-side
  const cfg = getSlackConfig();
  if (!cfg.botTokenConfigured || !cfg.signingSecretConfigured || !cfg.channelConfigured) {
    const missing: string[] = [];
    if (!cfg.botTokenConfigured) missing.push('SLACK_BOT_TOKEN');
    if (!cfg.signingSecretConfigured) missing.push('SLACK_SIGNING_SECRET');
    if (!cfg.channelConfigured) missing.push('SLACK_CHANNEL_ID');
    res.status(503).json({
      error: `Slack integration is not configured. Missing server secrets: ${missing.join(', ')}.`,
      code: 'SLACK_NOT_CONFIGURED',
      missing_variables: missing,
    });
    return;
  }

  // 6. Create single-use, bound, time-limited approval record
  const approvalId = `appr-slk-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const bindingHash = computeApprovalBindingHash(incident_id, proposedAction);
  const now = Date.now();
  const ttlMs = 15 * 60 * 1000; // 15-minute approval window
  const sourceLabel: 'claude_live' | 'demo_fallback' =
    diagnosis_source === 'demo_fallback' || is_fallback === true ? 'demo_fallback' : 'claude_live';

  const diagnosisBanner =
    sourceLabel === 'demo_fallback'
      ? '⚠️ *DEMO / FALLBACK DIAGNOSIS* _(Live Claude inference unavailable — grounded telemetry baseline)_'
      : '🤖 *LIVE CLAUDE DIAGNOSIS* _(Anthropic Claude 3.7 Sonnet)_';

  const evidence = diagnosis.observed_evidence || {};
  const hypothesis = diagnosis.ai_hypothesis || {};
  const remediation = diagnosis.proposed_remediation || {};
  const risksList: string[] = Array.isArray(diagnosis.risks) ? diagnosis.risks : [];
  const logPreview = Array.isArray(evidence.key_log_lines)
    ? evidence.key_log_lines.slice(0, 3).join('\n')
    : 'No log lines attached';

  const buttonPayload = JSON.stringify({
    approval_id: approvalId,
    incident_id,
    action: proposedAction,
    simulation_mode: true,
    binding_hash: bindingHash,
  });

  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🚨 [${severity}] ${incident_id} — ${service}`,
        emoji: true,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `${diagnosisBanner}  |  Confidence: *${diagnosis.confidence ?? 'N/A'}%*  |  Mode: *SIMULATION ONLY*`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Claude Diagnosis Summary*\n${diagnosis.summary}\n\n*Probable Root Cause*\n${diagnosis.probable_root_cause}`,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*[OBSERVED EVIDENCE]*\n` +
          `• *Resource:* \`${evidence.culprit_resource || service}\`  |  *Trace:* \`${evidence.trace_id || 'N/A'}\`\n` +
          `• *Span:* \`${evidence.culprit_span || 'N/A'}\` (${evidence.duration_ms ?? '?'}ms vs ${evidence.baseline_ms ?? '?'}ms baseline)\n` +
          `• *Recent Deploy:* \`${evidence.deploy_commit || 'N/A'}\`\n` +
          `\`\`\`${logPreview}\`\`\``,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*[AI HYPOTHESIS]*\n` +
          `*${hypothesis.title || 'Root Cause Hypothesis'}*\n${hypothesis.explanation || ''}\n` +
          `• *Affected Components:* ${(hypothesis.affected_components || []).join(', ') || service}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*Proposed Remediation (Simulated Only)*\n` +
          `• *Allowed Action:* \`${proposedAction}\`  |  *Est. Mitigation:* ${remediation.estimated_mitigation_seconds ?? 45}s\n` +
          `• *Dry-Run Command:* \`${remediation.command || 'N/A'}\`\n` +
          `\`\`\`- ${remediation.old_config || ''}\n+ ${remediation.new_config || ''}\`\`\`\n` +
          `*Risks & Trade-offs:*\n${risksList.map((r) => `• ${r}`).join('\n') || '• Standard rolling restart variance'}`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Approval ID: \`${approvalId}\`  |  Expires in 15m  |  Human authorization required before execution`,
        },
      ],
    },
    {
      type: 'actions',
      block_id: 'incidentpilot_approval_actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '✅ Approve & Execute (Simulated)',
            emoji: true,
          },
          style: 'primary',
          action_id: 'approve_remediation',
          value: buttonPayload,
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '❌ Reject Remediation',
            emoji: true,
          },
          style: 'danger',
          action_id: 'reject_remediation',
          value: buttonPayload,
        },
      ],
    },
  ];

  const approvalRecord: ApprovalRecord = {
    approval_id: approvalId,
    incident_id,
    action: proposedAction,
    simulation_mode: true,
    binding_hash: bindingHash,
    diagnosis_source: sourceLabel,
    status: 'pending',
    created_at: now,
    expires_at: now + ttlMs,
    channel_id: cfg.channelId,
  };

  try {
    const slackClient = createSlackClient(cfg.botToken);
    const postResult = await slackClient.chat.postMessage({
      channel: cfg.channelId,
      text: `[${severity}] ${incident_id} (${service}): ${diagnosis.summary}`,
      blocks,
    });

    if (!postResult.ok) {
      res.status(502).json({
        success: false,
        error: `Slack API returned an error: ${postResult.error || 'unknown_error'}`,
        code: 'SLACK_API_ERROR',
      });
      return;
    }

    approvalRecord.message_ts = postResult.ts;
    await activeWorkflowStore.saveApproval(approvalRecord);

    const auditEvent = await recordServerAudit({
      actorType: 'SLACK_NOTIFICATION',
      actorName: 'IncidentPilot Slack Notifier',
      action: `Posted ${sourceLabel === 'demo_fallback' ? 'Demo/Fallback' : 'Claude'} Diagnosis to Slack (${incident_id})`,
      details: `[Approval ID: ${approvalId}] Action "${proposedAction}" queued for human review on ${service} (simulation_mode=true).`,
      verificationStatus: 'verified',
    });

    res.status(200).json({
      success: true,
      incident_id,
      approval_id: approvalId,
      action: proposedAction,
      diagnosis_source: sourceLabel,
      message_ts: postResult.ts,
      simulation_mode: true,
      expires_at: new Date(approvalRecord.expires_at).toISOString(),
      audit_event: auditEvent,
    });
  } catch (err: any) {
    res.status(502).json({
      success: false,
      error: `Failed to post Slack notification: ${err.message || 'Slack API error'}`,
      code: 'SLACK_API_ERROR',
    });
  }
});

/**
 * Slack Interactive Components Endpoint (Approve / Reject button handler)
 * Verifies HMAC-SHA256 signature, replay timestamp, engineer authorization,
 * incident/action binding, single-use state, expiration, and simulation_mode=true.
 */
app.post('/api/slack/interactions', async (req: RawBodyRequest, res: Response) => {
  try {
    const cfg = getSlackConfig();

  // 1. Ensure Slack Signing Secret is configured
  if (!cfg.signingSecretConfigured) {
    res.status(503).json({
      error: 'SLACK_SIGNING_SECRET is not configured in server environment.',
      code: 'SLACK_SIGNING_SECRET_MISSING',
    });
    return;
  }

  // 2. Verify Slack HMAC-SHA256 request signature and replay window
  const timestampHeader = req.headers['x-slack-request-timestamp'] as string | undefined;
  const signatureHeader = req.headers['x-slack-signature'] as string | undefined;
  const rawBody = req.rawBody ?? '';

  const sigCheck = verifySlackSignature(cfg.signingSecret, timestampHeader, signatureHeader, rawBody);
  if (!sigCheck.valid) {
    await recordServerAudit({
      actorType: 'SLACK_INTERACTION',
      actorName: 'Slack Security Gate',
      action: 'Rejected Invalid Slack Request Signature',
      details: `Blocked interaction request: ${sigCheck.code} (${sigCheck.error}).`,
      verificationStatus: 'failed',
    });
    res.status(401).json({
      error: sigCheck.error,
      code: sigCheck.code,
    });
    return;
  }

  // 3. Parse Slack interaction payload
  let payload: any;
  try {
    if (typeof req.body?.payload === 'string') {
      payload = JSON.parse(req.body.payload);
    } else if (req.body && typeof req.body === 'object' && req.body.type) {
      payload = req.body;
    } else {
      throw new Error('Missing Slack interaction payload');
    }
  } catch {
    res.status(400).json({
      error: 'Invalid Slack interaction payload format.',
      code: 'INVALID_SLACK_PAYLOAD',
    });
    return;
  }

  if (payload.type !== 'block_actions' || !Array.isArray(payload.actions) || payload.actions.length === 0) {
    res.status(400).json({
      error: 'Unsupported Slack interaction type. Expected block_actions with action payload.',
      code: 'INVALID_SLACK_PAYLOAD',
    });
    return;
  }

  const slackUser = payload.user;
  const actionObj = payload.actions[0];
  const actionId = actionObj?.action_id;

  let actionData: any;
  try {
    actionData = typeof actionObj.value === 'string' ? JSON.parse(actionObj.value) : actionObj.value;
    if (!actionData || typeof actionData !== 'object') {
      throw new Error('Empty action value');
    }
  } catch {
    res.status(400).json({
      error: 'Malformed action value JSON in Slack interaction.',
      code: 'INVALID_ACTION_PAYLOAD',
    });
    return;
  }

  // 4. Authenticate and authorize the Slack engineer
  const userId = slackUser?.id;
  const username = slackUser?.username || slackUser?.name || 'unknown';
  const isAuthorized =
    Boolean(userId) &&
    cfg.authorizedCommandersConfigured &&
    (cfg.authorizedCommanders.includes(userId) ||
      (slackUser?.username && cfg.authorizedCommanders.includes(slackUser.username)));

  if (!isAuthorized) {
    await recordServerAudit({
      actorType: 'SLACK_INTERACTION',
      actorName: `${username} (${userId || 'unknown'})`,
      action: 'Unauthorized Slack Approval Attempt Blocked',
      details: `[Incident: ${actionData.incident_id || 'unknown'}] Engineer ${username} (${userId || 'unauthenticated'}) is not in AUTHORIZED_COMMANDERS.`,
      verificationStatus: 'failed',
    });
    res.status(403).json({
      error: 'Authorization denied: Slack user is not an authorized Incident Commander.',
      code: 'UNAUTHORIZED_COMMANDER',
    });
    return;
  }

  // 5. Enforce simulation_mode=true
  if (actionData.simulation_mode !== true) {
    await recordServerAudit({
      actorType: 'SLACK_INTERACTION',
      actorName: `${username} (${userId})`,
      action: 'Rejected Non-Simulated Slack Remediation Request',
      details: `[Approval ID: ${actionData.approval_id}] Safety check blocked simulation_mode=${String(actionData.simulation_mode)}.`,
      verificationStatus: 'failed',
    });
    res.status(400).json({
      error: 'Safety violation: Unsimulated actions are prohibited. simulation_mode must be true.',
      code: 'SIMULATION_MODE_REQUIRED',
    });
    return;
  }

  // 6. Enforce strict ALLOWED_ACTIONS allowlist
  if (!actionData.action || !ALLOWED_ACTIONS.includes(actionData.action)) {
    await recordServerAudit({
      actorType: 'SLACK_INTERACTION',
      actorName: `${username} (${userId})`,
      action: 'Rejected Disallowed Action from Slack',
      details: `[Approval ID: ${actionData.approval_id}] Action "${actionData.action}" is not on ALLOWED_ACTIONS allowlist.`,
      verificationStatus: 'failed',
    });
    res.status(400).json({
      error: `Validation failed: Action "${actionData.action}" is not allowed.`,
      code: 'INVALID_ACTION',
    });
    return;
  }

  if (actionId !== 'reject_remediation' && actionId !== 'approve_remediation') {
    res.status(400).json({
      error: `Unknown Slack action_id "${actionId}".`,
      code: 'INVALID_INTERACTION_ACTION',
    });
    return;
  }

  const decision: 'approve' | 'reject' = actionId === 'reject_remediation' ? 'reject' : 'approve';
  const decidedAt = new Date().toISOString();
  const commanderMeta = {
    id: userId,
    username: slackUser?.username,
    name: slackUser?.name,
  };

  // 7-11. Atomic transaction: binding validation, single-use, expiry, and workflow/approval updates
  const txResult = await activeWorkflowStore.resolveApprovalTransaction({
    approvalId: actionData.approval_id,
    incidentId: actionData.incident_id,
    action: actionData.action,
    expectedBindingHash: computeApprovalBindingHash,
    providedBindingHash: actionData.binding_hash,
    decision,
    decidedBy: commanderMeta,
    decidedAt,
    nowMs: Date.now(),
    buildRemediationResult: (_wf, rec) => ({
      workflow_status: 'simulated_success',
      result_message: `Simulated remediation "${rec.action}" verified for ${rec.incident_id} (simulation_mode=true, zero live infrastructure changes).`,
      execution_timestamp: decidedAt,
      approval_id: rec.approval_id,
      action: rec.action,
      commander: { id: userId, name: slackUser?.name || username, role: 'Authorized Slack Commander' },
      simulation_mode: true,
    }),
  });

  if (!txResult.ok) {
    if (txResult.outcome === 'APPROVAL_NOT_FOUND') {
      res.status(404).json({
        error: `Approval record "${actionData.approval_id}" not found.`,
        code: 'APPROVAL_NOT_FOUND',
      });
      return;
    }

    const rec = txResult.record!;
    if (txResult.outcome === 'APPROVAL_MISMATCH') {
      await recordServerAudit({
        actorType: 'SLACK_INTERACTION',
        actorName: `${username} (${userId})`,
        action: 'Rejected Mismatched Slack Approval Payload',
        details: `[Approval ID: ${rec.approval_id}] Expected (${rec.incident_id} / ${rec.action}), received (${actionData.incident_id} / ${actionData.action}).`,
        verificationStatus: 'failed',
      });
      res.status(409).json({
        error: 'Approval binding mismatch: incident_id or proposed action does not match the issued approval record.',
        code: 'APPROVAL_MISMATCH',
      });
      return;
    }

    if (txResult.outcome === 'DUPLICATE_APPROVAL') {
      await recordServerAudit({
        actorType: 'SLACK_INTERACTION',
        actorName: `${username} (${userId})`,
        action: 'Duplicate Slack Decision Rejected',
        details: `[Approval ID: ${rec.approval_id}] Approval was already ${rec.status} by ${rec.decided_by?.username || rec.decided_by?.id || 'another commander'}.`,
        verificationStatus: 'failed',
      });
      res.status(409).json({
        error: `Duplicate approval rejected: approval "${rec.approval_id}" is already ${rec.status}.`,
        code: 'DUPLICATE_APPROVAL',
      });
      return;
    }

    if (txResult.outcome === 'APPROVAL_EXPIRED') {
      await recordServerAudit({
        actorType: 'SLACK_INTERACTION',
        actorName: `${username} (${userId})`,
        action: 'Expired Slack Approval Rejected',
        details: `[Approval ID: ${rec.approval_id}] Approval expired at ${new Date(rec.expires_at).toISOString()}.`,
        verificationStatus: 'failed',
      });
      res.status(410).json({
        error: `Approval "${rec.approval_id}" has expired. Trigger a new diagnosis notification to re-approve.`,
        code: 'APPROVAL_EXPIRED',
      });
      return;
    }

    res.status(409).json({
      error: `Approval transaction rejected (${txResult.outcome}).`,
      code: txResult.outcome,
    });
    return;
  }

  const record = txResult.record;

  // Helper to update the Slack message in-place (best effort)
  const updateSlackMessage = async (statusText: string) => {
    const channelToUpdate = payload.channel?.id || record.channel_id;
    const tsToUpdate = payload.message?.ts || record.message_ts;
    if (cfg.botTokenConfigured && channelToUpdate && tsToUpdate) {
      try {
        const slackClient = createSlackClient(cfg.botToken);
        await slackClient.chat.update({
          channel: channelToUpdate,
          ts: tsToUpdate,
          text: statusText,
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: statusText },
            },
          ],
        });
      } catch {
        // Non-fatal if Slack message update fails
      }
    }
  };

  if (txResult.outcome === 'REJECTED') {
    const auditEvent = await recordServerAudit({
      actorType: 'SLACK_INTERACTION',
      actorName: `${username} (Slack)`,
      action: `Remediation Rejected via Slack (${record.incident_id})`,
      details: `[Approval ID: ${record.approval_id}] Proposed action "${record.action}" was rejected by @${username}. No remediation executed.`,
      verificationStatus: 'verified',
    });

    await updateSlackMessage(
      `❌ *Remediation Rejected* for *${record.incident_id}* (\`${record.action}\`) by *@${username}* at ${decidedAt}. No action executed.`
    );

    res.status(200).json({
      success: true,
      decision: 'rejected',
      remediation_executed: false,
      simulation_mode: true,
      approval_id: record.approval_id,
      incident_id: record.incident_id,
      action: record.action,
      decided_by: commanderMeta,
      decided_at: decidedAt,
      audit_event: auditEvent,
    });
    return;
  }

  const simulatedMessage =
    txResult.workflow?.remediation_result?.result_message ||
    `Simulated remediation "${record.action}" verified for ${record.incident_id} (simulation_mode=true, zero live infrastructure changes).`;

  const auditEvent = await recordServerAudit({
    actorType: 'SLACK_INTERACTION',
    actorName: `${username} (Slack)`,
    action: `Simulated Remediation Approved & Executed via Slack (${record.incident_id})`,
    details: `[Approval ID: ${record.approval_id}] Authorized by @${username}. ${simulatedMessage}`,
    verificationStatus: 'verified',
  });

  await updateSlackMessage(
    `✅ *Simulated Remediation Executed* for *${record.incident_id}* (\`${record.action}\`) — Approved by *@${username}* at ${decidedAt} (\`simulation_mode=true\`).`
  );

    res.status(200).json({
      success: true,
      decision: 'approved',
      remediation_executed: true,
      simulation_mode: true,
      workflow_status: 'simulated_success',
      approval_id: record.approval_id,
      incident_id: record.incident_id,
      action: record.action,
      result_message: simulatedMessage,
      execution_timestamp: decidedAt,
      decided_by: commanderMeta,
      audit_event: auditEvent,
    });
  } catch (err: any) {
    res.status(503).json({
      error: err?.message || 'Workflow store unavailable while processing Slack interaction.',
      code: 'WORKFLOW_STORE_UNAVAILABLE',
    });
  }
});

/**
 * ============================================================================
 * PHASE 4: UNIFIED NODE.JS / EXPRESS WORKFLOW ORCHESTRATOR
 * Coordinates Investigation -> Claude Diagnosis -> Bound Approval & Slack ->
 * Human Authorization -> Simulated Remediation -> Audit History
 * ============================================================================
 */

const DEFAULT_DASHBOARD_COMMANDERS = ['s-chen-882', 'U_SRE_SARAH', 'sarah.chen', 'm-vance-419', 'marcus.vance'];

function isNativeCommanderAuthorized(commanderId?: string, commanderUsername?: string): boolean {
  const cfg = getSlackConfig();
  const roster = cfg.authorizedCommandersConfigured ? cfg.authorizedCommanders : DEFAULT_DASHBOARD_COMMANDERS;
  if (commanderId && roster.includes(commanderId)) return true;
  if (commanderUsername && roster.includes(commanderUsername)) return true;
  return false;
}

/**
 * Get unified Node.js orchestrator status (and legacy n8n readiness) without exposing secrets
 */
app.get('/api/workflows/status', async (_req: Request, res: Response) => {
  const slackCfg = getSlackConfig();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const claudeConfigured = Boolean(anthropicKey && anthropicKey !== '' && anthropicKey !== 'MY_ANTHROPIC_API_KEY');
  const n8nConfigured = Boolean(process.env.N8N_WEBHOOK_URL && process.env.N8N_WEBHOOK_URL.trim() !== '');
  const cloudRunDetected = Boolean(process.env.K_SERVICE);
  const firestoreDatabaseId = process.env.FIRESTORE_DATABASE_ID?.trim() || '(default)';

  const storeConn = await activeWorkflowStore.verifyConnectivity();
  if (!storeConn.ok) {
    res.status(503).json({
      engine: 'nodejs_express_native',
      ready: false,
      simulation_enforced: true,
      workflow_store: activeWorkflowStore.mode,
      workflow_store_connected: false,
      cloud_run_detected: cloudRunDetected,
      ...(activeWorkflowStore.mode === 'firestore' ? { firestore_database_id: firestoreDatabaseId } : {}),
      claude_configured: claudeConfigured,
      slack_configured: slackCfg.botTokenConfigured && slackCfg.signingSecretConfigured && slackCfg.channelConfigured,
      n8n_legacy_configured: n8nConfigured,
      active_workflows_count: 0,
      code: 'WORKFLOW_STORE_UNAVAILABLE',
      error: storeConn.error,
      message: `Workflow store (${activeWorkflowStore.mode}) failed connectivity check: ${storeConn.error}`,
    });
    return;
  }

  try {
    const activeCount = await activeWorkflowStore.countWorkflows();
    res.json({
      engine: 'nodejs_express_native',
      ready: true,
      simulation_enforced: true,
      workflow_store: activeWorkflowStore.mode,
      workflow_store_connected: true,
      cloud_run_detected: cloudRunDetected,
      ...(activeWorkflowStore.mode === 'firestore' ? { firestore_database_id: firestoreDatabaseId } : {}),
      claude_configured: claudeConfigured,
      slack_configured: slackCfg.botTokenConfigured && slackCfg.signingSecretConfigured && slackCfg.channelConfigured,
      n8n_legacy_configured: n8nConfigured,
      active_workflows_count: activeCount,
      message: `Node.js native incident workflow orchestrator is active (${activeWorkflowStore.mode} store, simulation_mode=true enforced).`,
    });
  } catch (err: any) {
    res.status(503).json({
      engine: 'nodejs_express_native',
      ready: false,
      simulation_enforced: true,
      workflow_store: activeWorkflowStore.mode,
      workflow_store_connected: false,
      cloud_run_detected: cloudRunDetected,
      code: 'WORKFLOW_STORE_UNAVAILABLE',
      error: err?.message || 'Workflow store failed while counting workflows.',
    });
  }
});

/**
 * Get workflow state for a specific incident
 */
app.get('/api/workflows/incidents/:incidentId', async (req: Request, res: Response) => {
  try {
    const wf = await activeWorkflowStore.getWorkflow(req.params.incidentId);
    if (!wf) {
      res.status(404).json({
        error: `No active workflow found for incident "${req.params.incidentId}".`,
        code: 'WORKFLOW_NOT_FOUND',
      });
      return;
    }
    res.json({ workflow: wf });
  } catch (err: any) {
    res.status(503).json({
      error: err?.message || 'Workflow store unavailable while retrieving workflow.',
      code: 'WORKFLOW_STORE_UNAVAILABLE',
    });
  }
});

/**
 * Start a unified Node.js incident workflow:
 * 1. Enforces unique incident_id atomically via WorkflowStore transaction
 * 2. Enforces simulation_mode=true
 * 3. Runs Claude AI diagnosis (falling back cleanly to grounded evidence if unavailable)
 * 4. Validates proposed action against ALLOWED_ACTIONS
 * 5. Creates a bound, single-use, 15-min TTL approval record
 * 6. Posts to Slack if configured (records error gracefully if Slack is unconfigured or fails)
 * 7. Records full chronology in persistent audit store
 */
app.post('/api/workflows/incidents/start', async (req: Request, res: Response) => {
  try {
    const {
    incident_id,
    severity,
    service,
    alert,
    logs,
    traces,
    deployments,
    historical_incidents,
    simulation_mode,
    notify_slack = true,
    skip_live_claude = false,
  } = req.body || {};

  // 1. Validate unique incident_id
  if (!incident_id || typeof incident_id !== 'string' || incident_id.trim() === '') {
    res.status(400).json({
      error: 'Validation failed: incident_id is required and must be a non-empty string.',
      code: 'INVALID_INCIDENT_ID',
    });
    return;
  }

  // 2. Enforce simulation_mode=true before creating workflow state
  if (simulation_mode !== undefined && simulation_mode !== true) {
    res.status(400).json({
      error: 'Safety violation: simulation_mode must be explicitly true.',
      code: 'SIMULATION_MODE_REQUIRED',
    });
    return;
  }

  const resolvedSeverity = typeof severity === 'string' && severity.trim() ? severity.trim() : 'SEV-1';
  const resolvedService = typeof service === 'string' && service.trim() ? service.trim() : 'auth-gateway-prod';
  const nowIso = new Date().toISOString();
  const workflowId = `wf-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;

  const workflow: IncidentWorkflowState = {
    workflow_id: workflowId,
    incident_id,
    severity: resolvedSeverity,
    service: resolvedService,
    phase: 'investigating',
    slack_notified: false,
    simulation_mode: true,
    created_at: nowIso,
    updated_at: nowIso,
  };

  // 3. Atomically create unique workflow record (prevents concurrent/duplicate starts)
  const createRes = await activeWorkflowStore.createWorkflowUnique(workflow);
  if (!createRes.created) {
    const existing = createRes.existing;
    await recordServerAudit({
      actorType: 'NODEJS_ORCHESTRATOR',
      actorName: 'IncidentPilot Node.js Orchestrator',
      action: `Duplicate Workflow Execution Prevented (${incident_id})`,
      details: `Blocked duplicate workflow start for "${incident_id}" (existing workflow: ${existing.workflow_id}, phase: ${existing.phase}).`,
      verificationStatus: 'failed',
    });
    res.status(409).json({
      error: `Workflow already exists for incident "${incident_id}" (phase: ${existing.phase}). Duplicate workflow execution prevented.`,
      code: 'DUPLICATE_INCIDENT_WORKFLOW',
      existing_workflow: existing,
    });
    return;
  }

  const [metricsEvidence, logsEvidence, tracesEvidence] = await Promise.all([
    collectServiceMetricEvidence(resolvedService),
    collectServiceLogEvidence(resolvedService),
    collectServiceTraceEvidence(resolvedService),
  ]);
  const correlation = correlateIncidentEvidence({
    service: resolvedService,
    since: logsEvidence.since || tracesEvidence.since || '30m',
    metrics_evidence: metricsEvidence,
    logs_evidence: logsEvidence,
    traces_evidence: tracesEvidence,
  });

  await recordServerAudit({
    actorType: 'NODEJS_ORCHESTRATOR',
    actorName: 'IncidentPilot Node.js Orchestrator',
    action: `Started Incident Investigation Workflow (${incident_id})`,
    details: `[Workflow: ${workflowId}] Aggregating alert, deploys, ${
      metricsEvidence.available
        ? `${metricsEvidence.data_source} metrics (${metricsEvidence.provider})`
        : `unavailable ${metricsEvidence.data_source} metrics (${metricsEvidence.unavailable_reason || 'error'})`
    }, ${
      logsEvidence.available
        ? `${logsEvidence.total} ${logsEvidence.data_source} structured logs (${logsEvidence.provider})`
        : `unavailable ${logsEvidence.data_source} logs (${logsEvidence.unavailable_reason || 'error'})`
    }, and ${
      tracesEvidence.available
        ? `${tracesEvidence.total} ${tracesEvidence.data_source} distributed traces (${tracesEvidence.provider})`
        : `unavailable ${tracesEvidence.data_source} traces (${tracesEvidence.unavailable_reason || 'error'})`
    }; correlated ${correlation.timeline.length} timeline event(s) across ${correlation.groups.length} group(s) (confidence=${correlation.hypothesis.confidence}%) for ${resolvedService} (${resolvedSeverity}).`,
    verificationStatus: 'in_progress',
  });

  // 4. Execute Claude AI diagnosis (or grounded fallback when skip_live_claude=true to conserve credits)
  const diagResult = skip_live_claude
    ? {
        success: false,
        live: false,
        model: 'claude-3-7-sonnet-20250219',
        provider: 'Anthropic Claude',
        diagnosis_source: 'demo_fallback' as const,
        diagnosis: generateFallbackStructuredDiagnosis(incident_id, {
          alert: alert || { service: resolvedService, severity: resolvedSeverity },
          logs,
          traces,
          deployments,
          historical_incidents,
          metrics_evidence: metricsEvidence,
          logs_evidence: logsEvidence,
          traces_evidence: tracesEvidence,
          correlation,
        }),
        error: 'Skipped live Claude call to conserve credits; using grounded fallback diagnosis.',
        httpStatus: 200,
      }
    : await runClaudeDiagnosisService(incident_id, {
        alert: alert || { service: resolvedService, severity: resolvedSeverity },
        logs,
        traces,
        deployments,
        historical_incidents,
        metrics_evidence: metricsEvidence,
        logs_evidence: logsEvidence,
        traces_evidence: tracesEvidence,
        correlation,
      });

  workflow.diagnosis = diagResult.diagnosis;
  workflow.diagnosis_source = diagResult.diagnosis_source;
  workflow.phase = 'diagnosed';
  workflow.updated_at = new Date().toISOString();
  if (!diagResult.success && diagResult.error) {
    workflow.last_error = diagResult.error;
  }

  const proposedAction = diagResult.diagnosis?.proposed_remediation?.action || 'scale_connection_pool_canary';
  if (!ALLOWED_ACTIONS.includes(proposedAction)) {
    workflow.phase = 'failed';
    workflow.last_error = `Action "${proposedAction}" rejected by ALLOWED_ACTIONS policy.`;
    await activeWorkflowStore.saveWorkflow(workflow);
    await recordServerAudit({
      actorType: 'NODEJS_ORCHESTRATOR',
      actorName: 'IncidentPilot Node.js Orchestrator',
      action: `Workflow Aborted: Disallowed Remediation Action (${incident_id})`,
      details: workflow.last_error,
      verificationStatus: 'failed',
    });
    res.status(400).json({
      error: workflow.last_error,
      code: 'INVALID_ACTION',
      workflow,
    });
    return;
  }

  await recordServerAudit({
    actorType: 'CLAUDE_AGENT',
    actorName: diagResult.live ? 'Anthropic Claude 3.7 Sonnet' : 'Claude Grounded Fallback Engine',
    action: `Completed Root-Cause Diagnosis (${incident_id})`,
    details: `[Source: ${diagResult.diagnosis_source}] Proposed allowlisted action "${proposedAction}" (Confidence: ${diagResult.diagnosis?.confidence ?? 'N/A'}%).`,
    verificationStatus: 'verified',
  });

  // 5. Issue single-use, bound, time-limited approval record
  const approvalId = `appr-wf-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const bindingHash = computeApprovalBindingHash(incident_id, proposedAction);
  const nowMs = Date.now();
  const ttlMs = 15 * 60 * 1000;

  const slackCfg = getSlackConfig();
  const approvalRecord: ApprovalRecord = {
    approval_id: approvalId,
    incident_id,
    action: proposedAction,
    simulation_mode: true,
    binding_hash: bindingHash,
    diagnosis_source: diagResult.diagnosis_source,
    status: 'pending',
    created_at: nowMs,
    expires_at: nowMs + ttlMs,
    channel_id: slackCfg.channelId || undefined,
  };
  await activeWorkflowStore.saveApproval(approvalRecord);

  workflow.approval_id = approvalId;
  workflow.proposed_action = proposedAction;
  workflow.phase = 'awaiting_human_approval';
  workflow.updated_at = new Date().toISOString();
  await activeWorkflowStore.saveWorkflow(workflow);

  // 6. Optional Slack notification via Slack Web API
  if (notify_slack && slackCfg.botTokenConfigured && slackCfg.signingSecretConfigured && slackCfg.channelConfigured) {
    try {
      const evidence = diagResult.diagnosis?.observed_evidence || {};
      const hypothesis = diagResult.diagnosis?.ai_hypothesis || {};
      const remediation = diagResult.diagnosis?.proposed_remediation || {};
      const risksList: string[] = Array.isArray(diagResult.diagnosis?.risks) ? diagResult.diagnosis.risks : [];
      const buttonPayload = JSON.stringify({
        approval_id: approvalId,
        incident_id,
        action: proposedAction,
        simulation_mode: true,
        binding_hash: bindingHash,
      });

      const banner =
        diagResult.diagnosis_source === 'demo_fallback'
          ? '⚠️ *DEMO / FALLBACK DIAGNOSIS* _(Live Claude inference unavailable — grounded telemetry baseline)_'
          : '🤖 *LIVE CLAUDE DIAGNOSIS* _(Anthropic Claude 3.7 Sonnet)_';

      const slackClient = createSlackClient(slackCfg.botToken);
      const postRes = await slackClient.chat.postMessage({
        channel: slackCfg.channelId,
        text: `[${resolvedSeverity}] ${incident_id} (${resolvedService}): ${diagResult.diagnosis?.summary || ''}`,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: `🚨 [${resolvedSeverity}] ${incident_id} — ${resolvedService}`, emoji: true },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `${banner}  |  Workflow: \`${workflowId}\`  |  Mode: *SIMULATION ONLY*`,
              },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Summary*\n${diagResult.diagnosis?.summary}\n\n*Probable Root Cause*\n${diagResult.diagnosis?.probable_root_cause}`,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text:
                `*[OBSERVED EVIDENCE]*\n• Resource: \`${evidence.culprit_resource || resolvedService}\`  |  Span: \`${evidence.culprit_span || 'N/A'}\` (${evidence.duration_ms ?? '?'}ms)\n` +
                `*[AI HYPOTHESIS]*\n• ${hypothesis.title || ''}\n` +
                `*Proposed Remediation (Simulated Only):* \`${proposedAction}\`\n` +
                `*Risks:* ${risksList.join('; ') || 'Rolling restart variance'}`,
            },
          },
          {
            type: 'actions',
            block_id: 'incidentpilot_approval_actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '✅ Approve & Execute (Simulated)', emoji: true },
                style: 'primary',
                action_id: 'approve_remediation',
                value: buttonPayload,
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '❌ Reject Remediation', emoji: true },
                style: 'danger',
                action_id: 'reject_remediation',
                value: buttonPayload,
              },
            ],
          },
        ],
      });

      if (postRes.ok) {
        approvalRecord.message_ts = postRes.ts;
        workflow.slack_notified = true;
        workflow.slack_status = 'delivered';
        workflow.slack_message_ts = postRes.ts;
        await activeWorkflowStore.saveApproval(approvalRecord);
        await activeWorkflowStore.saveWorkflow(workflow);
        await recordServerAudit({
          actorType: 'SLACK_NOTIFICATION',
          actorName: 'IncidentPilot Slack Notifier',
          action: `Dispatched Approval Notification to Slack (${incident_id})`,
          details: `[Approval ID: ${approvalId}] Workflow ${workflowId} awaiting Slack or Dashboard commander decision.`,
          verificationStatus: 'verified',
        });
      } else {
        workflow.slack_status = 'slack_api_error';
        workflow.last_error = `Slack postMessage error: ${postRes.error || 'unknown_error'}`;
        await activeWorkflowStore.saveWorkflow(workflow);
        await recordServerAudit({
          actorType: 'SLACK_NOTIFICATION',
          actorName: 'IncidentPilot Slack Notifier',
          action: `Slack Delivery Failed (${incident_id})`,
          details: workflow.last_error,
          verificationStatus: 'failed',
        });
      }
    } catch (err: any) {
      workflow.slack_status = 'slack_api_error';
      workflow.last_error = `Slack delivery exception: ${err.message || 'unknown_error'}`;
      await activeWorkflowStore.saveWorkflow(workflow);
      await recordServerAudit({
        actorType: 'SLACK_NOTIFICATION',
        actorName: 'IncidentPilot Slack Notifier',
        action: `Slack Delivery Failed (${incident_id})`,
        details: workflow.last_error,
        verificationStatus: 'failed',
      });
    }
  } else {
    workflow.slack_notified = false;
    workflow.slack_status = notify_slack ? 'slack_not_configured' : 'slack_skipped';
    await activeWorkflowStore.saveWorkflow(workflow);
  }

    res.status(201).json({
      success: true,
      workflow,
      approval_id: approvalId,
      expires_at: new Date(approvalRecord.expires_at).toISOString(),
    });
  } catch (err: any) {
    res.status(503).json({
      error: err?.message || 'Workflow store unavailable while starting incident workflow.',
      code: 'WORKFLOW_STORE_UNAVAILABLE',
    });
  }
});

/**
 * Native Node.js Human Decision Endpoint (Approve or Reject a workflow)
 * Uses atomic WorkflowStore transaction to enforce commander authorization, exact
 * incident/action binding, expiry, single-use approval, ALLOWED_ACTIONS, and simulation_mode=true.
 */
app.post('/api/workflows/incidents/:incidentId/decision', async (req: Request, res: Response) => {
  try {
    const incidentId = req.params.incidentId;
  const { approval_id, action, decision, simulation_mode, human_approval, rejection_reason } = req.body || {};

  // 1. Validate workflow exists
  const workflow = await activeWorkflowStore.getWorkflow(incidentId);
  if (!workflow) {
    res.status(404).json({
      error: `No active workflow found for incident "${incidentId}".`,
      code: 'WORKFLOW_NOT_FOUND',
    });
    return;
  }

  // 2. Validate decision parameter
  if (decision !== 'approve' && decision !== 'reject') {
    res.status(400).json({
      error: 'Validation failed: decision must be "approve" or "reject".',
      code: 'INVALID_DECISION',
    });
    return;
  }

  // 3. Validate explicit human commander record & authorization
  if (!human_approval || typeof human_approval !== 'object') {
    res.status(403).json({
      error: 'Dispatch rejected: human_approval metadata from an authorized engineer is required.',
      code: 'HUMAN_APPROVAL_REQUIRED',
    });
    return;
  }

  const commanderId = human_approval.commander_id;
  const commanderUsername = human_approval.commander_username;
  const commanderName = human_approval.commander_name || commanderUsername || commanderId || 'Unknown';

  if (!isNativeCommanderAuthorized(commanderId, commanderUsername)) {
    await recordServerAudit({
      actorType: 'NODEJS_ORCHESTRATOR',
      actorName: `${commanderName} (${commanderId || 'unauthenticated'})`,
      action: `Unauthorized Workflow Decision Blocked (${incidentId})`,
      details: `[Approval ID: ${approval_id || 'N/A'}] Engineer is not authorized to decide workflow ${workflow.workflow_id}.`,
      verificationStatus: 'failed',
    });
    res.status(403).json({
      error: 'Authorization denied: Engineer is not an authorized Incident Commander.',
      code: 'UNAUTHORIZED_COMMANDER',
    });
    return;
  }

  if (decision === 'approve' && human_approval.approved !== true) {
    res.status(403).json({
      error: 'Dispatch rejected: Action requires explicit human_approval.approved=true.',
      code: 'HUMAN_APPROVAL_REQUIRED',
    });
    return;
  }

  // 4. Strictly enforce simulation_mode=true
  if (simulation_mode !== true) {
    await recordServerAudit({
      actorType: 'NODEJS_ORCHESTRATOR',
      actorName: `${commanderName}`,
      action: `Blocked Unsimulated Workflow Execution (${incidentId})`,
      details: `[Approval ID: ${approval_id}] simulation_mode=${String(simulation_mode)} rejected by safety policy.`,
      verificationStatus: 'failed',
    });
    res.status(400).json({
      error: 'Safety violation: Unsimulated actions are prohibited. simulation_mode must be explicitly true.',
      code: 'SIMULATION_MODE_REQUIRED',
    });
    return;
  }

  // 5. Enforce ALLOWED_ACTIONS allowlist
  if (!action || !ALLOWED_ACTIONS.includes(action)) {
    res.status(400).json({
      error: `Validation failed: Action "${action}" is not in ALLOWED_ACTIONS.`,
      code: 'INVALID_ACTION',
    });
    return;
  }

  // 6. Validate approval_id parameter
  if (!approval_id || typeof approval_id !== 'string') {
    res.status(400).json({
      error: 'Validation failed: approval_id is required.',
      code: 'INVALID_APPROVAL_ID',
    });
    return;
  }

  const decidedAt = new Date().toISOString();
  const commanderMeta = {
    id: commanderId || 's-chen-882',
    username: commanderUsername,
    name: commanderName,
  };

  // 7-10. Atomic store transaction: binding, single-use, expiry, and workflow/approval updates
  const txResult = await activeWorkflowStore.resolveApprovalTransaction({
    approvalId: approval_id,
    incidentId,
    action,
    expectedBindingHash: computeApprovalBindingHash,
    decision,
    decidedBy: commanderMeta,
    decidedAt,
    nowMs: Date.now(),
    requireWorkflowExists: true,
    buildRemediationResult: (wf, rec) => ({
      workflow_status: 'simulated_success',
      result_message: `Node.js Orchestrator verified simulated "${rec.action}" on ${wf?.service || workflow.service} (simulation_mode=true, zero live infrastructure changes).`,
      execution_timestamp: decidedAt,
      approval_id: rec.approval_id,
      action: rec.action,
      commander: {
        id: commanderMeta.id,
        name: commanderName,
        role: human_approval.commander_role || 'Staff SRE / Incident Commander',
      },
      simulation_mode: true,
    }),
  });

  if (!txResult.ok) {
    if (txResult.outcome === 'WORKFLOW_NOT_FOUND') {
      res.status(404).json({
        error: `No active workflow found for incident "${incidentId}".`,
        code: 'WORKFLOW_NOT_FOUND',
      });
      return;
    }

    if (txResult.outcome === 'APPROVAL_NOT_FOUND') {
      res.status(404).json({
        error: `Approval record "${approval_id}" not found.`,
        code: 'APPROVAL_NOT_FOUND',
      });
      return;
    }

    const rec = txResult.record!;
    if (txResult.outcome === 'APPROVAL_MISMATCH') {
      await recordServerAudit({
        actorType: 'NODEJS_ORCHESTRATOR',
        actorName: `${commanderName}`,
        action: `Rejected Mismatched Workflow Approval (${incidentId})`,
        details: `[Approval ID: ${approval_id}] Expected (${rec.incident_id} / ${rec.action}), received (${incidentId} / ${action}).`,
        verificationStatus: 'failed',
      });
      res.status(409).json({
        error: 'Approval binding mismatch: incident_id or proposed action does not match the bound approval record.',
        code: 'APPROVAL_MISMATCH',
      });
      return;
    }

    if (txResult.outcome === 'DUPLICATE_APPROVAL') {
      await recordServerAudit({
        actorType: 'NODEJS_ORCHESTRATOR',
        actorName: `${commanderName}`,
        action: `Duplicate Workflow Decision Rejected (${incidentId})`,
        details: `[Approval ID: ${approval_id}] Already ${rec.status}.`,
        verificationStatus: 'failed',
      });
      res.status(409).json({
        error: `Duplicate approval rejected: approval "${approval_id}" is already ${rec.status}.`,
        code: 'DUPLICATE_APPROVAL',
      });
      return;
    }

    if (txResult.outcome === 'APPROVAL_EXPIRED') {
      await recordServerAudit({
        actorType: 'NODEJS_ORCHESTRATOR',
        actorName: `${commanderName}`,
        action: `Expired Workflow Approval Rejected (${incidentId})`,
        details: `[Approval ID: ${approval_id}] Expired at ${new Date(rec.expires_at).toISOString()}.`,
        verificationStatus: 'failed',
      });
      res.status(410).json({
        error: `Approval "${approval_id}" has expired.`,
        code: 'APPROVAL_EXPIRED',
      });
      return;
    }

    res.status(409).json({
      error: `Approval transaction rejected (${txResult.outcome}).`,
      code: txResult.outcome,
    });
    return;
  }

  const record = txResult.record;
  const updatedWorkflow = txResult.workflow || workflow;

  // Helper to update Slack message if one was posted
  const slackCfg = getSlackConfig();
  const updateSlackInPlace = async (msgText: string) => {
    if (slackCfg.botTokenConfigured && record.channel_id && record.message_ts) {
      try {
        const slackClient = createSlackClient(slackCfg.botToken);
        await slackClient.chat.update({
          channel: record.channel_id,
          ts: record.message_ts,
          text: msgText,
          blocks: [{ type: 'section', text: { type: 'mrkdwn', text: msgText } }],
        });
      } catch {
        // Non-fatal
      }
    }
  };

  // REJECT branch — NEVER runs remediation
  if (txResult.outcome === 'REJECTED') {
    const auditEvent = await recordServerAudit({
      actorType: 'NODEJS_ORCHESTRATOR',
      actorName: `${commanderName} (${human_approval.commander_role || 'Incident Commander'})`,
      action: `Workflow Remediation Rejected (${incidentId})`,
      details: `[Approval ID: ${approval_id}] Reason: ${rejection_reason || 'Commander rejected proposed patch'}. Zero remediation executed.`,
      verificationStatus: 'verified',
    });

    await updateSlackInPlace(
      `❌ *Remediation Rejected* for *${incidentId}* (\`${action}\`) by *${commanderName}* via IncidentPilot Console at ${decidedAt}. No action executed.`
    );

    res.status(200).json({
      success: true,
      decision: 'rejected',
      remediation_executed: false,
      simulation_mode: true,
      incident_id: incidentId,
      approval_id,
      action,
      workflow_status: 'rejected',
      workflow: updatedWorkflow,
      audit_event: auditEvent,
    });
    return;
  }

  // APPROVE branch — strictly simulation-only (zero shell/kubectl calls)
  const simulatedMessage =
    updatedWorkflow.remediation_result?.result_message ||
    `Node.js Orchestrator verified simulated "${action}" on ${updatedWorkflow.service} (simulation_mode=true, zero live infrastructure changes).`;

  const auditEvent = await recordServerAudit({
    actorType: 'NODEJS_ORCHESTRATOR',
    actorName: 'IncidentPilot Node.js Orchestrator',
    action: `Simulated Remediation Executed (${incidentId})`,
    details: `[Approval ID: ${approval_id}] Authorized by ${commanderName}. ${simulatedMessage}`,
    verificationStatus: 'verified',
  });

  await updateSlackInPlace(
    `✅ *Simulated Remediation Executed* for *${incidentId}* (\`${action}\`) — Approved by *${commanderName}* via IncidentPilot Console at ${decidedAt} (\`simulation_mode=true\`).`
  );

    res.status(200).json({
      success: true,
      decision: 'approved',
      remediation_executed: true,
      simulation_mode: true,
      incident_id: incidentId,
      approval_id,
      action,
      workflow_status: 'simulated_success',
      result_message: simulatedMessage,
      execution_timestamp: decidedAt,
      workflow: updatedWorkflow,
      audit_event: auditEvent,
    });
  } catch (err: any) {
    res.status(503).json({
      error: err?.message || 'Workflow store unavailable while recording commander decision.',
      code: 'WORKFLOW_STORE_UNAVAILABLE',
    });
  }
});

/**
 * Start Server (Mount Vite in dev, serve dist in production)
 */
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`IncidentPilot server listening on http://0.0.0.0:${PORT}`);
  });
}

if (process.env.INCIDENTPILOT_NO_AUTOSTART !== 'true') {
  startServer();
}
