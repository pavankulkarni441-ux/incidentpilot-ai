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
  actorType: 'AI_AGENT' | 'HUMAN_COMMANDER' | 'SYSTEM_PROBE' | 'N8N_WORKFLOW';
  actorName: string;
  action: string;
  details: string;
  verificationStatus: 'verified' | 'failed' | 'in_progress';
}
