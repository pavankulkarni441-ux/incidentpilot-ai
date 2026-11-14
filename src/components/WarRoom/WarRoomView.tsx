import React, { useState, useEffect } from 'react';
import {
  Incident,
  AiHypothesis,
  PodMetric,
  TraceSpan,
  TelemetryLog,
  ServiceNode,
  N8nWorkflowResponse,
  WebhookConfigStatus,
  ClaudeConfigStatus,
  SlackConfigStatus,
  WorkflowConfigStatus,
  AuditEvent,
  MetricsStatusResponse,
  ServiceMetricsResponse,
  LogStatusResponse,
  TraceStatusResponse,
} from '../../types/incident';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { MetricCard } from '../ui/MetricCard';
import { AiApprovalCard } from './AiApprovalCard';
import { LatencyTrendChart } from './LatencyTrendChart';
import { ServiceHealthPanel } from './ServiceHealthPanel';
import { ExecutionTerminalModal } from './ExecutionTerminalModal';
import { TraceWaterfall } from './TraceWaterfall';
import { PodHealthMatrix } from './PodHealthMatrix';
import { TelemetryLogFeed } from './TelemetryLogFeed';
import {
  Clock,
  RotateCcw,
  Key,
  MessageSquare,
  Sun,
  Moon,
  Activity,
} from 'lucide-react';

interface WarRoomViewProps {
  incident: Incident;
  hypothesis: AiHypothesis;
  pods: PodMetric[];
  spans: TraceSpan[];
  logs: TelemetryLog[];
  services: ServiceNode[];
  isDarkMode?: boolean;
  onToggleDarkMode?: () => void;
  onNavigateToAudit?: () => void;
  onExecutionCompleteWithResult?: (result: N8nWorkflowResponse) => void;
  onRejectionComplete?: () => void;
  onAuditEventRecorded?: (event: AuditEvent) => void;
  onOpenSetupGuide?: () => void;
}

export const WarRoomView: React.FC<WarRoomViewProps> = ({
  incident: propIncident,
  hypothesis: propHypothesis,
  pods: propPods,
  spans,
  logs: propLogs,
  services,
  isDarkMode = true,
  onToggleDarkMode,
  onNavigateToAudit,
  onExecutionCompleteWithResult,
  onRejectionComplete,
  onAuditEventRecorded,
  onOpenSetupGuide,
}) => {
  const [incident, setIncident] = useState<Incident>(propIncident);
  const [hypothesis, setHypothesis] = useState<AiHypothesis>(propHypothesis);
  const [pods, setPods] = useState<PodMetric[]>(propPods);
  const [isMitigated, setIsMitigated] = useState(propIncident.status === 'resolved');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [appliedFlags, setAppliedFlags] = useState<{ [key: string]: boolean }>({});
  const [activeSeconds, setActiveSeconds] = useState(18 * 60 + 42);
  const [lastN8nResult, setLastN8nResult] = useState<N8nWorkflowResponse | null>(
    propIncident.lastApprovalResult || null
  );
  const [, setWebhookStatus] = useState<WebhookConfigStatus | null>(null);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeConfigStatus | null>(null);
  const [slackStatus, setSlackStatus] = useState<SlackConfigStatus | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowConfigStatus | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [diagnosisSource, setDiagnosisSource] = useState<'claude_live' | 'demo_fallback'>(
    'demo_fallback'
  );
  const [isNotifyingSlack, setIsNotifyingSlack] = useState(false);
  const [slackFeedback, setSlackFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [isRejectingServer, setIsRejectingServer] = useState(false);
  const [rejectionFeedback, setRejectionFeedback] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [metricsStatus, setMetricsStatus] = useState<MetricsStatusResponse | null>(null);
  const [metricsData, setMetricsData] = useState<ServiceMetricsResponse | null>(null);
  const [logsStatus, setLogsStatus] = useState<LogStatusResponse | null>(null);
  const [tracesStatus, setTracesStatus] = useState<TraceStatusResponse | null>(null);
  const prevIncidentIdRef = React.useRef<string>(propIncident.id);

  // Sync prop changes and reset per-incident UI state when switching/declaring an incident
  useEffect(() => {
    setIncident(propIncident);
    if (prevIncidentIdRef.current !== propIncident.id) {
      prevIncidentIdRef.current = propIncident.id;
      const resolved = propIncident.status === 'resolved';
      setIsMitigated(resolved);
      setLastN8nResult(propIncident.lastApprovalResult || null);
      setHypothesis(
        resolved
          ? { ...propHypothesis, status: 'executed_verified' }
          : propIncident.workflowStatus === 'rejected'
          ? { ...propHypothesis, status: 'rejected' }
          : propHypothesis
      );
      setPods(propPods);
      setRejectionFeedback(null);
      setSlackFeedback(null);
    }
  }, [propIncident, propHypothesis, propPods]);

  // Live elapsed timer
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Check backend subsystem statuses on mount
  useEffect(() => {
    fetch('/api/webhook/status')
      .then((res) => res.json())
      .then((data) => setWebhookStatus(data))
      .catch(() => {
        setWebhookStatus({
          configured: false,
          simulation_enforced: true,
          env_variable: 'N8N_WEBHOOK_URL',
          message: 'Unable to query /api/webhook/status',
        });
      });

    fetch('/api/claude/status')
      .then((res) => res.json())
      .then((data) => {
        setClaudeStatus(data);
        if (data.live_inference_working) {
          setDiagnosisSource('claude_live');
        } else if (data.fallback_active) {
          setDiagnosisSource('demo_fallback');
        }
      })
      .catch(() => {
        setClaudeStatus({
          configured: false,
          inference_status: 'unconfigured',
          live_inference_working: false,
          fallback_active: true,
          model: 'claude-3-7-sonnet-20250219',
          provider: 'Anthropic Claude',
          simulation_enforced: true,
          message: 'Unable to query /api/claude/status',
        });
      });

    fetch('/api/slack/status')
      .then((res) => res.json())
      .then((data) => setSlackStatus(data))
      .catch(() => {
        setSlackStatus({
          configured: false,
          bot_token_configured: false,
          signing_secret_configured: false,
          channel_configured: false,
          authorized_commanders_configured: false,
          simulation_enforced: true,
          missing_variables: ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'SLACK_CHANNEL_ID'],
          message: 'Unable to query /api/slack/status',
        });
      });

    fetch('/api/workflows/status')
      .then((res) => res.json())
      .then((data) => setWorkflowStatus(data))
      .catch(() => {
        setWorkflowStatus({
          engine: 'nodejs_express_native',
          ready: true,
          simulation_enforced: true,
          claude_configured: false,
          slack_configured: false,
          n8n_legacy_configured: false,
          active_workflows_count: 0,
          message: 'Unable to query /api/workflows/status',
        });
      });

    fetch('/api/metrics/status')
      .then((res) => res.json())
      .then((data) => setMetricsStatus(data))
      .catch(() => {
        setMetricsStatus({
          provider: 'mock',
          configured: false,
          connected: false,
          data_source: 'SIMULATED',
          simulated: true,
          prometheus_url_configured: false,
          message: 'Unable to query /api/metrics/status',
        });
      });

    fetch('/api/logs/status')
      .then((res) => res.json())
      .then((data) => setLogsStatus(data))
      .catch(() => {
        setLogsStatus({
          provider: 'mock',
          configured: false,
          connected: false,
          data_source: 'SIMULATED',
          simulated: true,
          log_source_url_configured: false,
          message: 'Unable to query /api/logs/status',
        });
      });

    fetch('/api/traces/status')
      .then((res) => res.json())
      .then((data) => setTracesStatus(data))
      .catch(() => {
        setTracesStatus({
          provider: 'mock',
          configured: false,
          connected: false,
          data_source: 'SIMULATED',
          simulated: true,
          trace_source_url_configured: false,
          message: 'Unable to query /api/traces/status',
        });
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const svc = incident.service || 'auth-gateway-prod';
    fetch(`/api/metrics?service=${encodeURIComponent(svc)}&mitigated=${isMitigated}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setMetricsData(data);
        if (data && typeof data.service === 'string') {
          const specs = [
            { key: 'cpu_usage_percent', label: 'CPU Usage', unit: '%' },
            { key: 'memory_usage_percent', label: 'Memory Usage', unit: '%' },
            { key: 'http_request_rate_rps', label: 'HTTP Request Rate', unit: 'rps' },
            { key: 'http_error_rate_percent', label: 'HTTP Error Rate', unit: '%' },
            { key: 'api_latency_p95_ms', label: 'API Latency (p95)', unit: 'ms' },
          ] as const;
          const observations = specs.map((s) => {
            const val = data.success && data.metrics ? data.metrics[s.key] : null;
            return {
              name: s.key,
              label: s.label,
              value: val ?? null,
              unit: s.unit,
              status: !data.success
                ? ('unavailable' as const)
                : val === null || val === undefined
                ? ('missing' as const)
                : ('observed' as const),
            };
          });
          setHypothesis((prev) => ({
            ...prev,
            metricsEvidence: {
              available: Boolean(data.success),
              service: data.service,
              timestamp: data.timestamp || new Date().toISOString(),
              provider: data.provider || 'mock',
              data_source: data.data_source || 'SIMULATED',
              simulated: Boolean(data.simulated),
              observations,
              missing_metrics: Array.isArray(data.missing_metrics) ? data.missing_metrics : [],
              ...(data.error ? { unavailable_reason: data.error } : {}),
            },
          }));
        }
      })
      .catch(() => {
        setMetricsData({
          success: false,
          service: svc,
          provider: metricsStatus?.provider || 'mock',
          data_source: metricsStatus?.data_source || 'SIMULATED',
          simulated: metricsStatus?.simulated ?? true,
          error: 'Unable to reach /api/metrics endpoint.',
        });
      });

    fetch(`/api/logs?service=${encodeURIComponent(svc)}&since=30m&limit=6`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setHypothesis((prev) => ({
          ...prev,
          logsEvidence: {
            available: Boolean(data?.success),
            service: svc,
            since: data?.since || '30m',
            timestamp: data?.timestamp || new Date().toISOString(),
            provider: data?.provider || 'mock',
            data_source: data?.data_source || 'SIMULATED',
            simulated: Boolean(data?.simulated ?? true),
            total: typeof data?.total === 'number' ? data.total : Array.isArray(data?.logs) ? data.logs.length : 0,
            logs: Array.isArray(data?.logs) ? data.logs : [],
            ...(data?.error ? { unavailable_reason: data.error } : {}),
          },
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setHypothesis((prev) => ({
          ...prev,
          logsEvidence: {
            available: false,
            service: svc,
            since: '30m',
            timestamp: new Date().toISOString(),
            provider: logsStatus?.provider || 'mock',
            data_source: logsStatus?.data_source || 'SIMULATED',
            simulated: logsStatus?.simulated ?? true,
            total: 0,
            logs: [],
            unavailable_reason: 'Unable to reach /api/logs endpoint.',
          },
        }));
      });

    fetch(`/api/traces?service=${encodeURIComponent(svc)}&since=30m&limit=5`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const fetchedTraces = Array.isArray(data?.traces) ? data.traces : [];
        const slowCount = fetchedTraces.reduce(
          (acc: number, tr: any) => acc + (Array.isArray(tr?.slow_spans) ? tr.slow_spans.length : 0),
          0
        );
        const failedCount = fetchedTraces.reduce(
          (acc: number, tr: any) => acc + (Array.isArray(tr?.failed_spans) ? tr.failed_spans.length : 0),
          0
        );
        setHypothesis((prev) => ({
          ...prev,
          tracesEvidence: {
            available: Boolean(data?.success),
            service: svc,
            since: data?.since || '30m',
            timestamp: data?.timestamp || new Date().toISOString(),
            provider: data?.provider || 'mock',
            data_source: data?.data_source || 'SIMULATED',
            simulated: Boolean(data?.simulated ?? true),
            total: typeof data?.total === 'number' ? data.total : fetchedTraces.length,
            traces: fetchedTraces,
            slow_spans_count: slowCount,
            failed_spans_count: failedCount,
            ...(data?.error ? { unavailable_reason: data.error } : {}),
          },
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setHypothesis((prev) => ({
          ...prev,
          tracesEvidence: {
            available: false,
            service: svc,
            since: '30m',
            timestamp: new Date().toISOString(),
            provider: tracesStatus?.provider || 'mock',
            data_source: tracesStatus?.data_source || 'SIMULATED',
            simulated: tracesStatus?.simulated ?? true,
            total: 0,
            traces: [],
            slow_spans_count: 0,
            failed_spans_count: 0,
            unavailable_reason: 'Unable to reach /api/traces endpoint.',
          },
        }));
      });

    fetch(`/api/correlation?service=${encodeURIComponent(svc)}&since=30m`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.success && data?.correlation) {
          setHypothesis((prev) => ({
            ...prev,
            correlation: data.correlation,
          }));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [incident.id, incident.service, isMitigated]);

  const handleRunClaudeDiagnosis = async () => {
    setIsDiagnosing(true);
    try {
      const res = await fetch('/api/claude/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: incident.code || incident.id,
          alert: {
            title: incident.title,
            severity: incident.severity,
            service: incident.service,
            impactSummary: incident.impactSummary,
            p99LatencyMs: incident.p99LatencyMs,
            errorRatePercent: incident.errorRatePercent,
            blastRadius: incident.blastRadius,
          },
          logs: propLogs.slice(0, 10),
          traces: spans.slice(0, 5),
          deployments: [
            {
              commitSha: '3a8f9c1',
              version: 'v2.14.8',
              author: 'dev-team@infra',
              message: 'feat(auth): bump HikariCP driver to 4.2.1 and reduce default connection timeout',
              timestamp: '14 mins prior to incident alert',
            },
          ],
          historical_incidents: [
            {
              code: 'INC-4102',
              title: 'HikariCP connection leak under sudden token renewal surge',
              resolution: 'Enlarged maximumPoolSize to 60 and set leakDetectionThreshold to 2000ms',
            },
          ],
        }),
      });

      const data = await res.json();
      const diag = data.diagnosis || data.fallback_diagnosis;
      const isLive = Boolean(data.success && data.live);
      setDiagnosisSource(isLive ? 'claude_live' : 'demo_fallback');
      fetch('/api/claude/status')
        .then((r) => r.json())
        .then((statusData) => setClaudeStatus(statusData))
        .catch(() => {});
      if (diag) {
        setHypothesis((prev) => ({
          ...prev,
          title: diag.ai_hypothesis?.title || diag.summary || prev.title,
          rootCause: diag.probable_root_cause || prev.rootCause,
          confidence: diag.confidence || prev.confidence,
          telemetrySpanEvidence: {
            traceId: diag.observed_evidence?.trace_id || prev.telemetrySpanEvidence.traceId,
            spanName: diag.observed_evidence?.culprit_span || prev.telemetrySpanEvidence.spanName,
            durationMs: diag.observed_evidence?.duration_ms || prev.telemetrySpanEvidence.durationMs,
            normalBaselineMs: diag.observed_evidence?.baseline_ms || prev.telemetrySpanEvidence.normalBaselineMs,
            culpritResource: diag.observed_evidence?.culprit_resource || prev.telemetrySpanEvidence.culpritResource,
          },
          metricsEvidence: diag.observed_evidence?.metrics_evidence || prev.metricsEvidence,
          logsEvidence: diag.observed_evidence?.logs_evidence || prev.logsEvidence,
          tracesEvidence: diag.observed_evidence?.traces_evidence || prev.tracesEvidence,
          correlation: diag.correlation || prev.correlation,
          recommendedAction: diag.proposed_remediation?.action || prev.recommendedAction,
          dryRunDiff: {
            command: diag.proposed_remediation?.command || prev.dryRunDiff.command,
            oldConfig: diag.proposed_remediation?.old_config || prev.dryRunDiff.oldConfig,
            newConfig: diag.proposed_remediation?.new_config || prev.dryRunDiff.newConfig,
            flags: diag.proposed_remediation?.flags || prev.dryRunDiff.flags,
          },
          risks: diag.risks || prev.risks,
        }));
      }
    } catch {
      setDiagnosisSource('demo_fallback');
    } finally {
      setIsDiagnosing(false);
    }
  };

  const handleSendToSlack = async () => {
    setIsNotifyingSlack(true);
    setSlackFeedback(null);
    try {
      const res = await fetch('/api/slack/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: incident.code || incident.id,
          severity: incident.severity,
          service: incident.service,
          is_fallback: diagnosisSource === 'demo_fallback',
          diagnosis_source: diagnosisSource,
          simulation_mode: true,
          diagnosis: {
            summary: incident.impactSummary || hypothesis.title,
            probable_root_cause: hypothesis.rootCause,
            confidence: hypothesis.confidence,
            observed_evidence: {
              culprit_resource: hypothesis.telemetrySpanEvidence.culpritResource,
              trace_id: hypothesis.telemetrySpanEvidence.traceId,
              culprit_span: hypothesis.telemetrySpanEvidence.spanName,
              duration_ms: hypothesis.telemetrySpanEvidence.durationMs,
              baseline_ms: hypothesis.telemetrySpanEvidence.normalBaselineMs,
              deploy_commit: 'v2.14.8 (3a8f9c1)',
              key_log_lines: propLogs.slice(0, 3).map((l) => `[${l.severity}] ${l.payload}`),
            },
            ai_hypothesis: {
              title: hypothesis.title,
              explanation: hypothesis.rootCause,
              affected_components: hypothesis.affectedPods,
            },
            proposed_remediation: {
              action: hypothesis.recommendedAction,
              command: hypothesis.dryRunDiff.command,
              old_config: hypothesis.dryRunDiff.oldConfig,
              new_config: hypothesis.dryRunDiff.newConfig,
              estimated_mitigation_seconds: hypothesis.estimatedMitigationSeconds,
              flags: hypothesis.dryRunDiff.flags,
            },
            risks: hypothesis.risks,
          },
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSlackFeedback({
          ok: true,
          text: `Sent to Slack (${data.approval_id})`,
        });
        if (data.audit_event && onAuditEventRecorded) {
          onAuditEventRecorded(data.audit_event);
        }
      } else {
        setSlackFeedback({
          ok: false,
          text: data.error || `Slack notify failed (HTTP ${res.status})`,
        });
      }
    } catch (err: any) {
      setSlackFeedback({
        ok: false,
        text: err.message || 'Unable to reach /api/slack/notify',
      });
    } finally {
      setIsNotifyingSlack(false);
    }
  };

  const formatTimer = (totalSecs: number) => {
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const handleApprove = (flags: { [key: string]: boolean }) => {
    setAppliedFlags(flags);
    setIsModalOpen(true);
  };

  const handleExecutionComplete = (result: N8nWorkflowResponse) => {
    setIsMitigated(true);
    setLastN8nResult(result);

    const updatedInc: Incident = {
      ...incident,
      status: 'resolved',
      workflowStatus: result.workflow_status || 'completed',
      lastApprovalResult: result,
      p99LatencyMs: 42,
      errorRatePercent: 0.1,
    };

    setIncident(updatedInc);
    setHypothesis((prev) => ({
      ...prev,
      status: 'executed_verified',
    }));
    setPods((prev) =>
      prev.map((pod) => ({
        ...pod,
        status: 'Running',
        cpuUsage: 38.4,
        activeConnections: 12,
        maxConnections: 60,
      }))
    );

    if (onExecutionCompleteWithResult) {
      onExecutionCompleteWithResult(result);
    }
  };

  const handleReject = async (reason: string) => {
    const incidentId = incident.code || incident.id;
    setIsRejectingServer(true);
    setRejectionFeedback(null);
    try {
      const startRes = await fetch('/api/workflows/incidents/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: incidentId,
          severity: incident.severity,
          service: incident.service,
          alert: {
            title: incident.title,
            severity: incident.severity,
            service: incident.service,
            impactSummary: incident.impactSummary,
          },
          simulation_mode: true,
          notify_slack: false,
          skip_live_claude: true,
        }),
      });
      const startData = await startRes.json();
      let approvalId = startData.approval_id || '';
      let proposedAction = startData.workflow?.proposed_action || 'scale_connection_pool_canary';

      if (startRes.status === 409 && startData.code === 'DUPLICATE_INCIDENT_WORKFLOW') {
        const existing = startData.existing_workflow;
        if (existing?.phase === 'awaiting_human_approval' && existing.approval_id) {
          approvalId = existing.approval_id;
          proposedAction = existing.proposed_action || proposedAction;
        } else {
          setRejectionFeedback({
            ok: false,
            text: startData.error || `Workflow for ${incidentId} is already ${existing?.phase || 'closed'}.`,
          });
          return;
        }
      } else if (!startRes.ok) {
        setRejectionFeedback({
          ok: false,
          text: startData.error || `Unable to initiate rejection workflow (HTTP ${startRes.status}).`,
        });
        return;
      }

      const decisionRes = await fetch(`/api/workflows/incidents/${encodeURIComponent(incidentId)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_id: approvalId,
          action: proposedAction,
          decision: 'reject',
          simulation_mode: true,
          rejection_reason: reason,
          human_approval: {
            approved: false,
            commander_name: incident.commander.name,
            commander_id: 's-chen-882',
            commander_role: incident.commander.role,
            timestamp: new Date().toISOString(),
          },
        }),
      });
      const decisionData = await decisionRes.json();

      if (
        decisionRes.ok &&
        decisionData.success &&
        decisionData.decision === 'rejected' &&
        decisionData.remediation_executed === false
      ) {
        setHypothesis((prev) => ({
          ...prev,
          status: 'rejected',
        }));
        setIncident((prev) => ({
          ...prev,
          workflowStatus: 'rejected',
        }));
        if (decisionData.audit_event && onAuditEventRecorded) {
          onAuditEventRecorded(decisionData.audit_event);
        }
        if (onRejectionComplete) {
          onRejectionComplete();
        }
        setRejectionFeedback({
          ok: true,
          text: `Rejection audited (${decisionData.approval_id}) — zero remediation executed.`,
        });
      } else {
        setRejectionFeedback({
          ok: false,
          text: decisionData.error || `Server rejected decision (HTTP ${decisionRes.status}).`,
        });
      }
    } catch (err: any) {
      setRejectionFeedback({
        ok: false,
        text: err.message || 'Failed to record rejection in Node.js orchestrator.',
      });
    } finally {
      setIsRejectingServer(false);
    }
  };

  const handleReset = () => {
    setIsMitigated(false);
    setLastN8nResult(null);
    setRejectionFeedback(null);
    setIncident(propIncident);
    setHypothesis(propHypothesis);
    setPods(propPods);
  };

  const liveP95 = metricsData?.success ? metricsData.metrics?.api_latency_p95_ms : null;
  const liveErr = metricsData?.success ? metricsData.metrics?.http_error_rate_percent : null;
  const liveRps = metricsData?.success ? metricsData.metrics?.http_request_rate_rps : null;
  const liveCpu = metricsData?.success ? metricsData.metrics?.cpu_usage_percent : null;
  const liveMem = metricsData?.success ? metricsData.metrics?.memory_usage_percent : null;

  const displayLatency = liveP95 ?? incident.p99LatencyMs;
  const displayErrorRate = liveErr ?? incident.errorRatePercent;
  const metricsProvenance =
    metricsData?.success === false ? 'UNAVAILABLE' : metricsData?.data_source || 'SIMULATED';

  return (
    <div className="space-y-6 min-w-0">
      {/* TOP INCIDENT HEADER */}
      <section className="neu-surface rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          {/* Severity + Incident Title + Metadata */}
          <div className="space-y-2.5 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <Badge variant={isMitigated ? 'healthy' : 'critical'} showSquare={!isMitigated}>
                {isMitigated ? 'INCIDENT RESOLVED' : incident.severity}
              </Badge>
              <span className="font-mono text-xs font-semibold text-[#2563EB] dark:text-[#60A5FA]">
                {incident.code}
              </span>
              <span className="text-[var(--ip-text-muted)]" aria-hidden="true">·</span>
              <span className="text-xs font-mono text-[var(--ip-text-secondary)]">
                Service: <strong className="text-[var(--ip-text)]">{incident.service}</strong>
              </span>
              <span className="text-[var(--ip-text-muted)]" aria-hidden="true">·</span>
              <span className="text-xs font-mono text-[var(--ip-text-secondary)]">
                Commander: <strong className="text-[var(--ip-text)]">{incident.commander.name}</strong>
              </span>
              {incident.workflowStatus && (
                <>
                  <span className="text-[var(--ip-text-muted)]" aria-hidden="true">·</span>
                  <span className="text-xs font-mono text-[var(--ip-text-secondary)]">
                    Workflow: <strong className="text-[var(--ip-text)]">{incident.workflowStatus}</strong>
                  </span>
                </>
              )}
            </div>

            <h1 className="text-xl sm:text-2xl font-semibold text-[var(--ip-text)] tracking-tight leading-snug text-balance">
              {incident.title}
            </h1>

            <p className="text-xs sm:text-sm text-[var(--ip-text-secondary)] max-w-4xl leading-relaxed">
              {incident.impactSummary}
            </p>
          </div>

          {/* Elapsed Timer & Controls */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div className="neu-inset rounded-xl px-4 py-2.5 flex items-center gap-3">
              <Clock className="w-4 h-4 text-[#F59E0B] shrink-0" />
              <div className="font-mono">
                <span className="text-[10px] uppercase tracking-wider text-[var(--ip-text-muted)] block">
                  Elapsed
                </span>
                <span className="text-base font-semibold text-[var(--ip-text)] tabular-nums">
                  {formatTimer(activeSeconds)}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSendToSlack}
                disabled={isNotifyingSlack}
                icon={<MessageSquare className="w-3.5 h-3.5 text-[#3B82F6] dark:text-[#60A5FA]" />}
              >
                {isNotifyingSlack ? 'Posting...' : 'Notify Slack'}
              </Button>

              {onOpenSetupGuide && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onOpenSetupGuide}
                  icon={<Key className="w-3.5 h-3.5" />}
                >
                  Setup Guide
                </Button>
              )}

              {onToggleDarkMode && (
                <button
                  type="button"
                  onClick={onToggleDarkMode}
                  aria-label={isDarkMode ? 'Switch to light neumorphic mode' : 'Switch to dark charcoal mode'}
                  className="neu-pill inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)] cursor-pointer transition-colors whitespace-nowrap shrink-0"
                >
                  {isDarkMode ? (
                    <>
                      <Sun className="w-3.5 h-3.5 text-[#F59E0B]" />
                      <span>Light</span>
                    </>
                  ) : (
                    <>
                      <Moon className="w-3.5 h-3.5 text-[#3B82F6]" />
                      <span>Dark</span>
                    </>
                  )}
                </button>
              )}

              {isMitigated && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleReset}
                  icon={<RotateCcw className="w-3.5 h-3.5" />}
                >
                  Reset
                </Button>
              )}
            </div>
          </div>
        </div>

        {(slackFeedback || incident.blastRadius) && (
          <div className="mt-4 pt-3.5 border-t border-[var(--ip-border)] flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-[var(--ip-text-secondary)]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                Blast Radius: <strong className="text-[var(--ip-text)]">{incident.blastRadius}</strong>
              </span>
              <span>
                Impacted Traffic:{' '}
                <strong className={isMitigated ? 'text-[#047857] dark:text-[#34D399]' : 'text-[#DC2626] dark:text-[#F87171]'}>
                  {isMitigated ? '0 active errors' : `${incident.affectedUsersCount.toLocaleString()} sessions`}
                </strong>
              </span>
              <span className="text-[var(--ip-text-muted)]">Opened: {incident.startedAt}</span>
            </div>

            {slackFeedback && (
              <span className={slackFeedback.ok ? 'text-[#047857] dark:text-[#34D399]' : 'text-[#B45309] dark:text-[#FBBF24]'}>
                {slackFeedback.text}
              </span>
            )}
          </div>
        )}
      </section>

      {/* TOP DASHBOARD ROW: LEFT LIVE TELEMETRY + RIGHT SERVICE HEALTH */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch min-w-0">
        {/* TOP LEFT (7 cols): Live Telemetry with KPI Cards + Latency Trend Chart */}
        <section className="xl:col-span-7 neu-surface rounded-2xl p-5 flex flex-col justify-between gap-4 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--ip-border)]">
            <div className="flex items-center gap-2 min-w-0">
              <Activity className="w-4 h-4 text-[#3B82F6] dark:text-[#60A5FA] shrink-0" />
              <h2 className="text-sm font-semibold text-[var(--ip-text)] tracking-tight">
                Live Telemetry
              </h2>
              <Badge
                variant={
                  metricsProvenance === 'UNAVAILABLE'
                    ? 'warning'
                    : metricsProvenance === 'LIVE'
                    ? 'healthy'
                    : 'neutral'
                }
                showSquare
              >
                {metricsProvenance}
              </Badge>
            </div>
            <span className="text-[11px] font-mono text-[var(--ip-text-muted)]">
              {metricsData?.timestamp ? `Updated ${metricsData.timestamp}` : 'Polling /api/metrics...'}
            </span>
          </div>

          {/* 4 Telemetry KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <MetricCard
              label={liveP95 !== null && liveP95 !== undefined ? 'API Latency (p95)' : 'Gateway p99 Latency'}
              value={metricsData?.success === false ? 'N/A' : displayLatency}
              unit={metricsData?.success === false ? '' : 'ms'}
              change={metricsProvenance}
              changeType={displayLatency > 500 ? 'negative' : 'positive'}
              statusColor={metricsData?.success === false ? 'amber' : displayLatency > 500 ? 'red' : 'emerald'}
              annotation={isMitigated ? 'Nominal (<50ms)' : 'SLO threshold: 500ms'}
              sparklineData={
                isMitigated
                  ? [1840, 1100, 420, 120, 48, 42, displayLatency]
                  : [42, 68, 210, 580, 1120, 1590, displayLatency]
              }
            />

            <MetricCard
              label="HTTP Error Rate"
              value={metricsData?.success === false ? 'N/A' : displayErrorRate.toFixed(2)}
              unit={metricsData?.success === false ? '' : '%'}
              change={isMitigated ? 'Within Budget' : 'SLO Breached'}
              changeType={isMitigated ? 'positive' : 'negative'}
              statusColor={metricsData?.success === false ? 'amber' : isMitigated ? 'emerald' : 'red'}
              annotation="Target: < 0.10%"
              sparklineData={
                isMitigated
                  ? [14.8, 9.2, 3.4, 0.8, 0.2, displayErrorRate]
                  : [0.05, 0.2, 2.4, 6.8, 11.2, displayErrorRate]
              }
            />

            <MetricCard
              label="Throughput & Pool Load"
              value={liveRps !== null && liveRps !== undefined ? liveRps : isMitigated ? '3,240' : '1,180'}
              unit="req/s"
              change={isMitigated ? 'Pool 14/60' : 'Pool 20/20 Locked'}
              changeType={isMitigated ? 'positive' : 'negative'}
              statusColor={isMitigated ? 'emerald' : 'amber'}
              annotation={isMitigated ? '46 idle DB slots' : 'Queue wait: 1,814ms'}
              sparklineData={
                isMitigated
                  ? [1180, 1620, 2240, 2890, 3240]
                  : [3100, 2800, 2100, 1650, 1180]
              }
            />

            <MetricCard
              label="Compute Saturation (CPU / Mem)"
              value={
                liveCpu !== null && liveCpu !== undefined
                  ? `${liveCpu}`
                  : metricsData?.success === false
                  ? 'N/A'
                  : isMitigated
                  ? '38.4'
                  : '91.2'
              }
              unit={metricsData?.success === false ? '' : '% CPU'}
              change={
                liveMem !== null && liveMem !== undefined
                  ? `Mem ${liveMem}%`
                  : isMitigated
                  ? 'Nominal'
                  : 'Elevated'
              }
              changeType={isMitigated ? 'positive' : 'negative'}
              statusColor={metricsData?.success === false ? 'amber' : isMitigated ? 'emerald' : 'blue'}
              annotation={`Service: ${incident.service}`}
              sparklineData={
                isMitigated
                  ? [91, 78, 62, 48, 38.4]
                  : [44, 58, 72, 84, 91.2]
              }
            />
          </div>

          {/* Interactive Latency Trend Chart */}
          <LatencyTrendChart
            metricsData={metricsData}
            incidentLatencyMs={incident.p99LatencyMs}
            traceEvidence={hypothesis.tracesEvidence}
            isMitigated={isMitigated}
            serviceName={metricsData?.service || incident.service}
          />
        </section>

        {/* TOP RIGHT (5 cols): Service Health */}
        <div className="xl:col-span-5 min-w-0">
          <ServiceHealthPanel
            services={services}
            activeServiceName={incident.service}
            isMitigated={isMitigated}
            metricsStatus={metricsStatus}
            logsStatus={logsStatus}
            tracesStatus={tracesStatus}
            claudeStatus={claudeStatus}
            diagnosisSource={diagnosisSource}
            workflowStatus={workflowStatus}
            slackStatus={slackStatus}
          />
        </div>
      </div>

      {/* BOTTOM DASHBOARD ROW: LEFT AI HYPOTHESES + RIGHT RUNBOOK REMEDIATION CARDS */}
      <AiApprovalCard
        hypothesis={hypothesis}
        onApprove={handleApprove}
        onReject={handleReject}
        isExecuting={isModalOpen}
        onReanalyze={handleRunClaudeDiagnosis}
        isAnalyzing={isDiagnosing}
        diagnosisSource={diagnosisSource}
        isRejectingServer={isRejectingServer}
        rejectionFeedback={rejectionFeedback}
        isMitigated={isMitigated}
        lastN8nResult={lastN8nResult}
        onNavigateToAudit={onNavigateToAudit}
        onReset={handleReset}
      />

      {/* DEEP DIAGNOSTICS BELOW COMMAND GRID */}
      <TraceWaterfall spans={spans} traceEvidence={hypothesis.tracesEvidence} />
      <PodHealthMatrix pods={pods} />
      <TelemetryLogFeed initialLogs={propLogs} isMitigated={isMitigated} />

      {/* Execution Terminal Modal (simulation_mode=true enforced) */}
      <ExecutionTerminalModal
        isOpen={isModalOpen}
        flags={appliedFlags}
        incident={incident}
        hypothesis={hypothesis}
        onComplete={handleExecutionComplete}
        onClose={() => {
          setIsModalOpen(false);
          fetch('/api/claude/status')
            .then((r) => r.json())
            .then((statusData) => {
              setClaudeStatus(statusData);
              if (statusData.live_inference_working) {
                setDiagnosisSource('claude_live');
              } else if (statusData.fallback_active) {
                setDiagnosisSource('demo_fallback');
              }
            })
            .catch(() => {});
        }}
        onOpenSetupGuide={onOpenSetupGuide}
        onAuditEventRecorded={onAuditEventRecorded}
      />
    </div>
  );
};
