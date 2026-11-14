export type SeverityLevel = 'SEV-0' | 'SEV-1' | 'SEV-2' | 'SEV-3';
export type IncidentStatus = 'investigating' | 'mitigating' | 'resolved' | 'monitoring';

export interface N8nWorkflowResponse {
  success: boolean;
  incident_id: string;
  approval_id: string;
  workflow_status: string;
  result_message: string;
  execution_timestamp: string;
  raw?: any;
  error?: string;
  code?: string;
}

export interface WebhookConfigStatus {
  configured: boolean;
  simulation_enforced: boolean;
  env_variable: string;
  message: string;
}

export interface Incident {
  id: string;
  code: string; // e.g. "INC-4892"
  title: string;
  severity: SeverityLevel;
  status: IncidentStatus;
  workflowStatus?: string; // e.g. "workflow_dispatched", "completed", "rejected", "pending_approval"
  service: string;
  commander: {
    name: string;
    role: string;
    avatar: string;
  };
  startedAt: string;
  durationMinutes: number;
  impactSummary: string;
  affectedUsersCount: number;
  blastRadius: string;
  p99LatencyMs: number;
  errorRatePercent: number;
  activeHypothesisId?: string;
  lastApprovalResult?: N8nWorkflowResponse;
}

export interface MetricEvidenceObservation {
  name: string;
  label: string;
  value: number | null;
  unit: string;
  status: 'observed' | 'missing' | 'unavailable';
}

export interface MetricEvidenceSummary {
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

export interface StructuredLogItem {
  id: string;
  timestamp: string;
  service: string;
  severity: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  message: string;
  trace_id?: string;
  request_id?: string;
  data_source: 'SIMULATED' | 'LIVE';
}

export interface LogEvidenceSummary {
  available: boolean;
  service: string;
  since?: string;
  timestamp: string;
  provider: 'mock' | 'http';
  data_source: 'SIMULATED' | 'LIVE';
  simulated: boolean;
  total: number;
  logs: StructuredLogItem[];
  unavailable_reason?: string;
}

export interface DistributedSpanItem {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  service_name: string;
  operation_name: string;
  start_time: string;
  duration_ms: number;
  status: 'OK' | 'ERROR';
  error_message?: string;
  data_source: 'SIMULATED' | 'LIVE';
}

export interface DistributedTraceItem {
  trace_id: string;
  root_service: string;
  root_operation: string;
  start_time: string;
  total_duration_ms: number;
  status: 'OK' | 'ERROR';
  has_error: boolean;
  has_slow_span: boolean;
  slow_threshold_ms: number;
  spans: DistributedSpanItem[];
  slow_spans: DistributedSpanItem[];
  failed_spans: DistributedSpanItem[];
  data_source: 'SIMULATED' | 'LIVE';
}

export interface TraceEvidenceSummary {
  available: boolean;
  service: string;
  since?: string;
  timestamp: string;
  provider: 'mock' | 'http';
  data_source: 'SIMULATED' | 'LIVE';
  simulated: boolean;
  total: number;
  traces: DistributedTraceItem[];
  slow_spans_count: number;
  failed_spans_count: number;
  unavailable_reason?: string;
}

export interface AiHypothesis {
  id: string;
  incidentId: string;
  confidence: number; // e.g. 94.2
  title: string;
  rootCause: string;
  telemetrySpanEvidence: {
    traceId: string;
    spanName: string;
    durationMs: number;
    normalBaselineMs: number;
    culpritResource: string;
  };
  metricsEvidence?: MetricEvidenceSummary;
  logsEvidence?: LogEvidenceSummary;
  tracesEvidence?: TraceEvidenceSummary;
  correlation?: EvidenceCorrelationResult;
  affectedPods: string[];
  recommendedAction: string;
  dryRunDiff: {
    command: string;
    oldConfig: string;
    newConfig: string;
    flags: { name: string; value: string; description: string; enabled: boolean }[];
  };
  estimatedMitigationSeconds: number;
  risks: string[];
  status: 'pending_human_review' | 'approved_executing' | 'executed_verified' | 'rejected';
}

export interface PodMetric {
  name: string;
  status: 'Running' | 'CrashLoopBackOff' | 'Terminating' | 'Degraded';
  cpuUsage: number; // %
  memoryMb: number;
  memoryLimitMb: number;
  activeConnections: number;
  maxConnections: number;
  restarts: number;
  uptime: string;
}

export interface TraceSpan {
  id: string;
  serviceName: string;
  operationName: string;
  durationMs: number;
  startOffsetMs: number;
  statusCode: number;
  hasError: boolean;
  tags: Record<string, string>;
  sqlQuery?: string;
  children?: TraceSpan[];
}

export interface TelemetryLog {
  id: string;
  timestamp: string;
  severity: 'CRIT' | 'WARN' | 'INFO';
  source: string;
  payload: string;
  latencyMs?: number;
  podId?: string;
}

export interface ServiceNode {
  id: string;
  name: string;
  tier: 'Edge' | 'Gateway' | 'Core' | 'Data';
  status: 'nominal' | 'degraded' | 'critical';
  p99Ms: number;
  errorRate: number;
  rps: number;
  dependencies: string[];
  deployedVersion: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  actorType:
    | 'AI_AGENT'
    | 'CLAUDE_AGENT'
    | 'HUMAN_COMMANDER'
    | 'SYSTEM_PROBE'
    | 'N8N_WORKFLOW'
    | 'SLACK_NOTIFICATION'
    | 'SLACK_INTERACTION'
    | 'NODEJS_ORCHESTRATOR';
  actorName: string;
  action: string;
  details: string;
  verificationStatus: 'verified' | 'failed' | 'in_progress';
}

export interface ClaudeConfigStatus {
  configured: boolean;
  inference_status?: 'unconfigured' | 'untested' | 'live_ok' | 'fallback_active';
  live_inference_working?: boolean;
  fallback_active?: boolean;
  last_checked_at?: string | null;
  last_error?: string;
  model: string;
  provider: string;
  simulation_enforced: boolean;
  message: string;
}

export interface StructuredDiagnosis {
  summary: string;
  probable_root_cause: string;
  confidence: number;
  observed_evidence: {
    culprit_resource: string;
    trace_id: string;
    culprit_span: string;
    duration_ms: number;
    baseline_ms: number;
    deploy_commit?: string;
    key_log_lines: string[];
    metrics_evidence?: MetricEvidenceSummary;
    logs_evidence?: LogEvidenceSummary;
    traces_evidence?: TraceEvidenceSummary;
    timeline?: CorrelatedTimelineEvent[];
    source_provenance?: EvidenceCorrelationResult['source_provenance'];
    missing_and_limitations?: string[];
  };
  ai_hypothesis: {
    title: string;
    explanation: string;
    affected_components: string[];
    confidence_explanation?: string;
    causation_disclaimer?: string;
  };
  proposed_remediation: {
    action: string;
    command: string;
    old_config: string;
    new_config: string;
    estimated_mitigation_seconds: number;
    flags: { name: string; value: string; description: string; enabled: boolean }[];
  };
  risks: string[];
  correlation?: EvidenceCorrelationResult;
  hypothesis?: AiHypothesis;
}

export interface ClaudeDiagnosisResponse {
  success: boolean;
  live: boolean;
  model: string;
  provider: string;
  diagnosis: StructuredDiagnosis;
  timestamp: string;
  error?: string;
  code?: string;
  fallback_available?: boolean;
}

export interface SlackConfigStatus {
  configured: boolean;
  bot_token_configured: boolean;
  signing_secret_configured: boolean;
  channel_configured: boolean;
  authorized_commanders_configured: boolean;
  simulation_enforced: boolean;
  missing_variables: string[];
  message: string;
}

export interface SlackNotifyResponse {
  success: boolean;
  incident_id: string;
  approval_id: string;
  action: string;
  diagnosis_source: 'claude_live' | 'demo_fallback';
  message_ts?: string;
  simulation_mode: boolean;
  expires_at: string;
  error?: string;
  code?: string;
}

export interface WorkflowConfigStatus {
  engine: 'nodejs_express_native';
  ready: boolean;
  simulation_enforced: boolean;
  claude_configured: boolean;
  slack_configured: boolean;
  n8n_legacy_configured: boolean;
  active_workflows_count: number;
  message: string;
}

export interface IncidentWorkflowState {
  workflow_id: string;
  incident_id: string;
  severity: string;
  service: string;
  phase:
    | 'investigating'
    | 'diagnosed'
    | 'awaiting_human_approval'
    | 'approved_simulated_remediated'
    | 'rejected'
    | 'failed';
  diagnosis_source?: 'claude_live' | 'demo_fallback';
  diagnosis?: StructuredDiagnosis;
  approval_id?: string;
  proposed_action?: string;
  slack_notified: boolean;
  slack_status?: string;
  simulation_mode: true;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  last_error?: string;
}

export interface MetricsStatusResponse {
  provider: 'mock' | 'prometheus';
  configured: boolean;
  connected: boolean;
  data_source: 'SIMULATED' | 'LIVE';
  simulated: boolean;
  prometheus_url_configured: boolean;
  message: string;
  code?: string;
}

export interface ServiceMetricsResponse {
  success: boolean;
  service: string;
  timestamp?: string;
  provider: 'mock' | 'prometheus';
  data_source: 'SIMULATED' | 'LIVE';
  simulated: boolean;
  metrics?: {
    cpu_usage_percent: number | null;
    memory_usage_percent: number | null;
    http_request_rate_rps: number | null;
    http_error_rate_percent: number | null;
    api_latency_p95_ms: number | null;
  };
  missing_metrics?: string[];
  code?: string;
  error?: string;
}

export interface LogStatusResponse {
  provider: 'mock' | 'http';
  configured: boolean;
  connected: boolean;
  data_source: 'SIMULATED' | 'LIVE';
  simulated: boolean;
  log_source_url_configured: boolean;
  message: string;
  code?: string;
}

export interface LogsQueryResponse {
  success: boolean;
  service: string;
  since?: string;
  severity?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  timestamp?: string;
  provider: 'mock' | 'http';
  data_source: 'SIMULATED' | 'LIVE';
  simulated: boolean;
  total?: number;
  logs?: StructuredLogItem[];
  code?: string;
  error?: string;
}

export interface TraceStatusResponse {
  provider: 'mock' | 'http';
  configured: boolean;
  connected: boolean;
  data_source: 'SIMULATED' | 'LIVE';
  simulated: boolean;
  trace_source_url_configured: boolean;
  message: string;
  code?: string;
}

export interface TracesQueryResponse {
  success: boolean;
  service: string;
  since?: string;
  timestamp?: string;
  provider: 'mock' | 'http';
  data_source: 'SIMULATED' | 'LIVE';
  simulated: boolean;
  total?: number;
  traces?: DistributedTraceItem[];
  code?: string;
  error?: string;
}

export interface SingleTraceResponse {
  success: boolean;
  trace?: DistributedTraceItem;
  timestamp?: string;
  provider: 'mock' | 'http';
  data_source: 'SIMULATED' | 'LIVE';
  simulated: boolean;
  code?: string;
  error?: string;
}

export type EvidenceType = 'METRIC' | 'LOG' | 'TRACE';
export type TimelineDataSource = 'SIMULATED' | 'LIVE' | 'UNAVAILABLE';

export interface CorrelatedTimelineEvent {
  id: string;
  timestamp: string;
  service: string;
  evidence_type: EvidenceType;
  observation: string;
  data_source: TimelineDataSource;
  signal_category: 'error' | 'latency' | 'resource' | 'info' | 'unavailable';
  trace_id?: string;
  request_id?: string;
  span_id?: string;
  correlation_group_id?: string;
}

export interface CorrelatedSignalGroup {
  group_id: string;
  correlation_key: string;
  service: string;
  trace_id?: string;
  request_id?: string;
  data_sources: TimelineDataSource[];
  evidence_types: EvidenceType[];
  event_count: number;
  has_errors: boolean;
  has_latency_spike: boolean;
  summary: string;
}

export interface CorrelationHypothesis {
  title: string;
  explanation: string;
  confidence: number;
  confidence_explanation: string;
  causation_disclaimer: string;
}

export interface EvidenceCorrelationResult {
  service: string;
  since: string;
  generated_at: string;
  source_provenance: {
    metrics: TimelineDataSource;
    logs: TimelineDataSource;
    traces: TimelineDataSource;
    mixed_sources: boolean;
  };
  timeline: CorrelatedTimelineEvent[];
  groups: CorrelatedSignalGroup[];
  detected_anomalies: {
    errors: string[];
    latency_spikes: string[];
    failed_spans: string[];
  };
  key_observations: string[];
  supporting_evidence_refs: string[];
  hypothesis: CorrelationHypothesis;
  missing_and_limitations: string[];
}

export interface CorrelationQueryResponse {
  success: boolean;
  correlation?: EvidenceCorrelationResult;
  code?: string;
  error?: string;
}

