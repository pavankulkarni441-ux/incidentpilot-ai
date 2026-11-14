import React, { useEffect, useMemo, useState } from 'react';
import {
  AuditEvent,
  CorrelatedTimelineEvent,
  CorrelationQueryResponse,
  EvidenceType,
  Incident,
  IncidentWorkflowState,
  LogsQueryResponse,
  ServiceMetricsResponse,
  TimelineDataSource,
  TracesQueryResponse,
} from '../../types/incident';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { MetricCard } from '../ui/MetricCard';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock,
  ExternalLink,
  GitBranch,
  Layers,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
  User,
  Workflow,
  XCircle,
} from 'lucide-react';

interface IncidentDashboardViewProps {
  incident: Incident;
  auditEvents: AuditEvent[];
  onBackToAudit: () => void;
  onOpenWarRoom: () => void;
}

type TimeWindow = '15m' | '30m' | '1h' | '24h';
type DashboardTab = 'overview' | 'signals' | 'audit';

function ProvenancePill({ source }: { source: TimelineDataSource | 'MIXED' }) {
  const styles =
    source === 'LIVE'
      ? 'bg-[#10B981]/10 text-[#047857] dark:text-[#6EE7B7] border-[#10B981]/30'
      : source === 'UNAVAILABLE'
      ? 'bg-[#EF4444]/10 text-[#DC2626] dark:text-[#FCA5A5] border-[#EF4444]/30'
      : source === 'MIXED'
      ? 'bg-[#3B82F6]/10 text-[#2563EB] dark:text-[#93C5FD] border-[#3B82F6]/30'
      : 'bg-[#F59E0B]/10 text-[#B45309] dark:text-[#FCD34D] border-[#F59E0B]/30';

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-mono uppercase tracking-wide ${styles}`}
    >
      {source}
    </span>
  );
}

export const IncidentDashboardView: React.FC<IncidentDashboardViewProps> = ({
  incident,
  auditEvents,
  onBackToAudit,
  onOpenWarRoom,
}) => {
  const incidentKey = incident.code || incident.id;
  const [since, setSince] = useState<TimeWindow>('30m');
  const [activeSection, setActiveSection] = useState<DashboardTab>('overview');
  const [signalFilter, setSignalFilter] = useState<'ALL' | EvidenceType>('ALL');
  const [signalQuery, setSignalQuery] = useState('');
  const [auditScope, setAuditScope] = useState<'incident' | 'all'>('incident');
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [loading, setLoading] = useState(true);

  const [workflow, setWorkflow] = useState<IncidentWorkflowState | null>(null);
  const [metricsRes, setMetricsRes] = useState<ServiceMetricsResponse | null>(null);
  const [logsRes, setLogsRes] = useState<LogsQueryResponse | null>(null);
  const [tracesRes, setTracesRes] = useState<TracesQueryResponse | null>(null);
  const [correlationRes, setCorrelationRes] = useState<CorrelationQueryResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelectedTraceId(null);

    const encodedIncident = encodeURIComponent(incidentKey);
    const encodedService = encodeURIComponent(incident.service);

    Promise.allSettled([
      fetch(`/api/workflows/incidents/${encodedIncident}`).then(async (r) =>
        r.ok ? ((await r.json()) as { workflow?: IncidentWorkflowState }) : null
      ),
      fetch(`/api/metrics?service=${encodedService}`).then(
        async (r) => (await r.json()) as ServiceMetricsResponse
      ),
      fetch(`/api/logs?service=${encodedService}&since=${since}&limit=30`).then(
        async (r) => (await r.json()) as LogsQueryResponse
      ),
      fetch(`/api/traces?service=${encodedService}&since=${since}`).then(
        async (r) => (await r.json()) as TracesQueryResponse
      ),
      fetch(`/api/correlation?service=${encodedService}&since=${since}`).then(
        async (r) => (await r.json()) as CorrelationQueryResponse
      ),
    ])
      .then(([wfOut, metOut, logOut, trOut, corrOut]) => {
        if (cancelled) return;

        setWorkflow(wfOut.status === 'fulfilled' && wfOut.value?.workflow ? wfOut.value.workflow : null);
        setMetricsRes(
          metOut.status === 'fulfilled'
            ? metOut.value
            : {
                success: false,
                service: incident.service,
                provider: 'mock',
                data_source: 'SIMULATED',
                simulated: true,
                error: 'Metrics request failed',
              }
        );
        setLogsRes(
          logOut.status === 'fulfilled'
            ? logOut.value
            : {
                success: false,
                service: incident.service,
                provider: 'mock',
                data_source: 'SIMULATED',
                simulated: true,
                error: 'Logs request failed',
              }
        );
        setTracesRes(
          trOut.status === 'fulfilled'
            ? trOut.value
            : {
                success: false,
                service: incident.service,
                provider: 'mock',
                data_source: 'SIMULATED',
                simulated: true,
                error: 'Traces request failed',
              }
        );
        setCorrelationRes(
          corrOut.status === 'fulfilled'
            ? corrOut.value
            : {
                success: false,
                error: 'Correlation request failed',
              }
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [incidentKey, incident.service, since, refreshTick]);

  const correlation = workflow?.diagnosis?.correlation || correlationRes?.correlation;
  const timeline: CorrelatedTimelineEvent[] = correlation?.timeline || [];

  const filteredTimeline = useMemo(() => {
    return timeline.filter((item) => {
      const typeMatch = signalFilter === 'ALL' || item.evidence_type === signalFilter;
      const q = signalQuery.trim().toLowerCase();
      const queryMatch =
        !q ||
        item.observation.toLowerCase().includes(q) ||
        item.service.toLowerCase().includes(q) ||
        (item.trace_id && item.trace_id.toLowerCase().includes(q)) ||
        (item.request_id && item.request_id.toLowerCase().includes(q));
      return typeMatch && queryMatch;
    });
  }, [timeline, signalFilter, signalQuery]);

  const incidentScopedAudit = useMemo(() => {
    const codeLower = incident.code.toLowerCase();
    const idLower = incident.id.toLowerCase();
    const svcLower = incident.service.toLowerCase();
    const matched = auditEvents.filter((ev) => {
      const hay = `${ev.action} ${ev.details} ${ev.actorName}`.toLowerCase();
      return hay.includes(codeLower) || hay.includes(idLower) || hay.includes(svcLower);
    });
    return auditScope === 'incident' && matched.length > 0 ? matched : auditEvents;
  }, [auditEvents, auditScope, incident.code, incident.id, incident.service]);

  const overallProvenance: TimelineDataSource | 'MIXED' = useMemo(() => {
    if (correlation?.source_provenance) {
      const { metrics, logs, traces, mixed_sources } = correlation.source_provenance;
      if (mixed_sources) return 'MIXED';
      if (metrics === 'LIVE' && logs === 'LIVE' && traces === 'LIVE') return 'LIVE';
      if (metrics === 'UNAVAILABLE' && logs === 'UNAVAILABLE' && traces === 'UNAVAILABLE') {
        return 'UNAVAILABLE';
      }
      return metrics;
    }
    if (metricsRes?.success === false && logsRes?.success === false && tracesRes?.success === false) {
      return 'UNAVAILABLE';
    }
    return metricsRes?.data_source || 'SIMULATED';
  }, [correlation, metricsRes, logsRes, tracesRes]);

  const traces = tracesRes?.traces || [];
  const activeTrace =
    traces.find((t) => t.trace_id === selectedTraceId) || (traces.length > 0 ? traces[0] : null);

  const liveP95 = metricsRes?.success ? metricsRes.metrics?.api_latency_p95_ms : null;
  const liveErr = metricsRes?.success ? metricsRes.metrics?.http_error_rate_percent : null;
  const displayLatency = liveP95 !== null && liveP95 !== undefined ? liveP95 : incident.p99LatencyMs;
  const displayErrorRate = liveErr !== null && liveErr !== undefined ? liveErr : incident.errorRatePercent;
  const confidenceValue =
    workflow?.diagnosis?.confidence ?? correlation?.hypothesis.confidence ?? null;

  const isCritical = incident.severity === 'SEV-0' || incident.severity === 'SEV-1';
  const isResolved =
    incident.status === 'resolved' || workflow?.phase === 'approved_simulated_remediated';
  const isRejected =
    incident.workflowStatus === 'rejected' || workflow?.phase === 'rejected';

  const diagnosisTitle =
    workflow?.diagnosis?.ai_hypothesis.title ||
    correlation?.hypothesis.title ||
    'No active AI hypothesis generated for this incident yet';
  const diagnosisExplanation =
    workflow?.diagnosis?.ai_hypothesis.explanation ||
    correlation?.hypothesis.explanation ||
    'Dispatch an investigation workflow from the War Room to generate an AI hypothesis grounded in live telemetry.';
  const causationDisclaimer =
    workflow?.diagnosis?.ai_hypothesis.causation_disclaimer ||
    correlation?.hypothesis.causation_disclaimer ||
    'Correlation between telemetry signals indicates temporal association, not definitive causation.';

  const approvalRecord = incident.lastApprovalResult;
  const effectiveWorkflowStatus =
    workflow?.phase ||
    approvalRecord?.workflow_status ||
    incident.workflowStatus ||
    incident.status;

  return (
    <div className="space-y-6" data-testid="incident-dashboard-view">
      {/* Top Back & Action Strip */}
      <div className="neu-surface rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={onBackToAudit}
            icon={<ArrowLeft className="w-3.5 h-3.5" />}
          >
            Back to Audit Trail
          </Button>

          <div className="h-5 w-px bg-[var(--ip-border-strong)] hidden sm:block" />

          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="font-mono text-xs font-semibold px-2.5 py-1 rounded-lg neu-inset text-[#2563EB] dark:text-[#93C5FD]">
              {incident.code}
            </span>
            <Badge
              variant={isResolved ? 'healthy' : isCritical ? 'critical' : 'warning'}
              showSquare={!isResolved}
            >
              {incident.severity}
            </Badge>
            <Badge variant={isResolved ? 'healthy' : isRejected ? 'critical' : 'neutral'}>
              {isResolved ? 'MITIGATED' : isRejected ? 'REJECTED' : incident.status.toUpperCase()}
            </Badge>
            <ProvenancePill source={overallProvenance} />
            <span className="text-[11px] font-mono text-[#047857] dark:text-[#6EE7B7] bg-[#10B981]/10 border border-[#10B981]/25 px-2 py-0.5 rounded-md">
              simulation_mode=true
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div
            className="flex items-center neu-inset rounded-xl p-1 text-xs font-mono"
            role="group"
            aria-label="Telemetry time window"
          >
            {(['15m', '30m', '1h', '24h'] as TimeWindow[]).map((win) => (
              <button
                key={win}
                type="button"
                onClick={() => setSince(win)}
                className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer text-[11px] ${
                  since === win
                    ? 'neu-pill text-[var(--ip-text)] font-semibold'
                    : 'text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)]'
                }`}
              >
                {win}
              </button>
            ))}
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRefreshTick((t) => t + 1)}
            disabled={loading}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenWarRoom}
            icon={<ExternalLink className="w-3.5 h-3.5" />}
          >
            War Room
          </Button>
        </div>
      </div>

      {/* Incident Hero Summary Card */}
      <section className="neu-surface rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="space-y-2 min-w-0">
            <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--ip-text-muted)]">
              Interactive Incident Retrospective Dashboard · {incident.id}
            </div>
            <h1 className="text-xl sm:text-2xl font-semibold text-[var(--ip-text)] tracking-tight">
              {incident.title}
            </h1>
            <p className="text-sm text-[var(--ip-text-secondary)] leading-relaxed max-w-3xl">
              {incident.impactSummary}
            </p>
          </div>

          <div className="neu-inset rounded-xl p-3.5 flex items-center gap-3 shrink-0">
            <img
              src={incident.commander.avatar}
              alt={incident.commander.name}
              className="w-9 h-9 rounded-lg object-cover border border-[var(--ip-border-strong)]"
              referrerPolicy="no-referrer"
            />
            <div className="text-xs font-mono">
              <div className="text-[var(--ip-text)] font-semibold">{incident.commander.name}</div>
              <div className="text-[11px] text-[var(--ip-text-secondary)]">{incident.commander.role}</div>
              <div className="text-[10px] text-[var(--ip-text-muted)] mt-0.5">
                Started {incident.startedAt} · {incident.durationMinutes}m elapsed
              </div>
            </div>
          </div>
        </div>

        {/* Metadata Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          <div className="neu-inset rounded-xl px-3.5 py-2.5 flex items-center justify-between text-xs font-mono">
            <span className="text-[var(--ip-text-muted)]">Target Service</span>
            <span className="text-[#2563EB] dark:text-[#93C5FD] font-semibold">{incident.service}</span>
          </div>
          <div className="neu-inset rounded-xl px-3.5 py-2.5 flex items-center justify-between text-xs font-mono">
            <span className="text-[var(--ip-text-muted)]">Blast Radius</span>
            <span className="text-[var(--ip-text)] truncate max-w-[200px]">{incident.blastRadius}</span>
          </div>
          <div className="neu-inset rounded-xl px-3.5 py-2.5 flex items-center justify-between text-xs font-mono">
            <span className="text-[var(--ip-text-muted)]">Workflow State</span>
            <span className="text-[#047857] dark:text-[#6EE7B7] font-semibold uppercase">{effectiveWorkflowStatus}</span>
          </div>
        </div>

        {/* Top Incident KPI Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label={liveP95 !== null && liveP95 !== undefined ? 'Service p95 Latency' : 'Incident p99 Latency'}
            value={displayLatency}
            unit="ms"
            change={metricsRes?.data_source || 'INCIDENT'}
            changeType={displayLatency > 500 ? 'negative' : 'positive'}
            statusColor={displayLatency > 500 ? 'red' : 'emerald'}
            annotation={`Service: ${incident.service}`}
            sparklineData={[42, 48, 85, 290, 740, 1280, Math.max(40, displayLatency)]}
          />
          <MetricCard
            label="HTTP Error Rate"
            value={displayErrorRate.toFixed(1)}
            unit="%"
            change={metricsRes?.data_source || 'INCIDENT'}
            changeType={displayErrorRate > 5 ? 'negative' : 'positive'}
            statusColor={displayErrorRate > 5 ? 'red' : 'emerald'}
            annotation="Observed window error ratio"
            sparklineData={[0.1, 0.2, 0.8, 4.1, 9.6, 13.5, displayErrorRate]}
          />
          <MetricCard
            label="Estimated Affected Users"
            value={incident.affectedUsersCount.toLocaleString()}
            unit="sessions"
            change={incident.severity}
            changeType={isResolved ? 'positive' : 'negative'}
            statusColor={isResolved ? 'emerald' : 'amber'}
            annotation={incident.blastRadius}
            sparklineData={[120, 480, 1900, 6200, 11400, incident.affectedUsersCount]}
          />
          <MetricCard
            label="Correlation Confidence"
            value={confidenceValue !== null ? confidenceValue : 'N/A'}
            unit={confidenceValue !== null ? '%' : ''}
            change={overallProvenance}
            changeType={confidenceValue !== null && confidenceValue >= 70 ? 'positive' : 'neutral'}
            statusColor="blue"
            annotation={
              correlation
                ? `${correlation.timeline.length} correlated signals (${since})`
                : 'Awaiting telemetry correlation'
            }
            sparklineData={[45, 58, 68, 76, 84, confidenceValue ?? 60]}
          />
        </div>
      </section>

      {/* Interactive Section Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center neu-inset rounded-xl p-1 text-xs font-mono overflow-x-auto max-w-full">
          {(
            [
              { id: 'overview', label: 'Diagnosis & Metrics' },
              { id: 'signals', label: `Cross-Signal Timeline (${timeline.length})` },
              { id: 'audit', label: `Audit & Safety (${incidentScopedAudit.length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSection(tab.id)}
              className={`px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeSection === tab.id
                  ? 'neu-pill text-[var(--ip-text)] font-semibold'
                  : 'text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <span className="text-[11px] font-mono text-[var(--ip-text-muted)]">
          Window: last {since} · Data provenance explicitly labeled
        </span>
      </div>

      {/* SECTION 1: OVERVIEW */}
      {activeSection === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 min-w-0 space-y-6">
            <div className="neu-surface rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--ip-border)]">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-[#3B82F6] dark:text-[#60A5FA]" />
                  <h2 className="text-sm font-semibold text-[var(--ip-text)]">
                    Observed Evidence vs AI Hypothesis
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  {workflow?.diagnosis_source && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-md neu-inset text-[var(--ip-text-secondary)]">
                      {workflow.diagnosis_source === 'claude_live' ? 'CLAUDE LIVE' : 'FALLBACK ENGINE'}
                    </span>
                  )}
                  <ProvenancePill source={overallProvenance} />
                </div>
              </div>

              <div className="neu-inset rounded-xl p-4 space-y-2.5">
                <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-[#047857] dark:text-[#6EE7B7]">
                  <span>Observed Telemetry & Correlation Evidence</span>
                  <span>{correlation?.groups.length ?? 0} correlation groups</span>
                </div>

                {correlation && correlation.key_observations.length > 0 ? (
                  <ul className="space-y-1.5 text-xs text-[var(--ip-text)]">
                    {correlation.key_observations.map((obs, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6] mt-1.5 shrink-0" />
                        <span>{obs}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-[var(--ip-text-secondary)]">
                    No correlated anomaly observations were returned for {incident.service} in the last {since}. Missing telemetry is not invented.
                  </p>
                )}

                {correlation && correlation.missing_and_limitations.length > 0 && (
                  <div className="pt-2 border-t border-[var(--ip-border)] space-y-1">
                    {correlation.missing_and_limitations.map((lim, i) => (
                      <div key={i} className="text-[11px] font-mono text-[#B45309] dark:text-[#FCD34D] flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{lim}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="neu-inset rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-[#2563EB] dark:text-[#93C5FD]">
                  <span>AI Probable Root-Cause Hypothesis</span>
                  {confidenceValue !== null && <span>Confidence: {confidenceValue}%</span>}
                </div>
                <div className="text-sm font-semibold text-[var(--ip-text)]">{diagnosisTitle}</div>
                <p className="text-xs text-[var(--ip-text-secondary)] leading-relaxed">{diagnosisExplanation}</p>
                <p className="text-[11px] font-mono text-[var(--ip-text-muted)] pt-1 border-t border-[var(--ip-border)]">
                  Disclaimer: {causationDisclaimer}
                </p>
              </div>
            </div>

            {/* Distributed Traces Summary */}
            <div className="neu-surface rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--ip-border)]">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-[#3B82F6] dark:text-[#60A5FA]" />
                  <h2 className="text-sm font-semibold text-[var(--ip-text)]">
                    Distributed Trace Retrospective ({traces.length})
                  </h2>
                </div>
                <ProvenancePill
                  source={tracesRes?.success === false ? 'UNAVAILABLE' : tracesRes?.data_source || 'SIMULATED'}
                />
              </div>

              {tracesRes?.success === false ? (
                <div className="neu-inset rounded-xl p-3.5 text-xs font-mono text-[#DC2626] dark:text-[#FCA5A5]">
                  Trace provider unavailable: {tracesRes.error || 'upstream error'}. Missing spans were not invented.
                </div>
              ) : traces.length === 0 ? (
                <div className="neu-inset rounded-xl p-3.5 text-xs font-mono text-[var(--ip-text-secondary)]">
                  No distributed traces found for {incident.service} in the last {since}.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {traces.map((tr) => {
                      const isSel = activeTrace?.trace_id === tr.trace_id;
                      return (
                        <button
                          key={tr.trace_id}
                          type="button"
                          onClick={() => setSelectedTraceId(tr.trace_id)}
                          className={`px-3 py-1.5 rounded-xl font-mono text-[11px] border cursor-pointer transition-colors ${
                            isSel
                              ? 'neu-pill border-[#3B82F6]/45 text-[var(--ip-text)]'
                              : 'neu-inset text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)]'
                          }`}
                        >
                          {tr.trace_id} · {tr.total_duration_ms}ms ·{' '}
                          <span className={tr.has_error ? 'text-[#DC2626] dark:text-[#FCA5A5]' : 'text-[#047857] dark:text-[#6EE7B7]'}>
                            {tr.status}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {activeTrace && (
                    <div className="neu-inset rounded-xl divide-y divide-[var(--ip-border)] max-h-60 overflow-y-auto">
                      {activeTrace.spans.map((sp) => (
                        <div
                          key={sp.span_id}
                          className="p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-mono"
                        >
                          <div className="min-w-0 flex items-center gap-2">
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                sp.status === 'ERROR'
                                  ? 'bg-[#EF4444]'
                                  : sp.duration_ms >= activeTrace.slow_threshold_ms
                                  ? 'bg-[#F59E0B]'
                                  : 'bg-[#10B981]'
                              }`}
                            />
                            <span className="text-[var(--ip-text)] font-semibold">{sp.service_name}</span>
                            <span className="text-[var(--ip-text-secondary)] truncate">{sp.operation_name}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[#2563EB] dark:text-[#93C5FD] tabular-nums">{sp.duration_ms}ms</span>
                            <ProvenancePill source={sp.data_source} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right 5 cols */}
          <div className="lg:col-span-5 min-w-0 space-y-6">
            <div className="neu-surface rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--ip-border)]">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#3B82F6] dark:text-[#60A5FA]" />
                  <h2 className="text-sm font-semibold text-[var(--ip-text)]">Service Telemetry Snapshot</h2>
                </div>
                <ProvenancePill
                  source={
                    metricsRes?.success === false ? 'UNAVAILABLE' : metricsRes?.data_source || 'SIMULATED'
                  }
                />
              </div>

              {metricsRes?.success && metricsRes.metrics ? (
                <div className="space-y-2.5 font-mono text-xs">
                  {[
                    { label: 'CPU Usage', val: metricsRes.metrics.cpu_usage_percent, unit: '%' },
                    { label: 'Memory Usage', val: metricsRes.metrics.memory_usage_percent, unit: '%' },
                    { label: 'HTTP Request Rate', val: metricsRes.metrics.http_request_rate_rps, unit: 'req/s' },
                    { label: 'HTTP Error Rate', val: metricsRes.metrics.http_error_rate_percent, unit: '%' },
                    { label: 'API Latency (p95)', val: metricsRes.metrics.api_latency_p95_ms, unit: 'ms' },
                  ].map((m) => (
                    <div
                      key={m.label}
                      className="neu-inset rounded-xl px-3.5 py-2.5 flex items-center justify-between"
                    >
                      <span className="text-[var(--ip-text-secondary)]">{m.label}</span>
                      <span className="text-[var(--ip-text)] font-semibold tabular-nums">
                        {m.val !== null && m.val !== undefined ? `${m.val} ${m.unit}` : 'MISSING'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="neu-inset rounded-xl p-3.5 text-xs font-mono text-[#DC2626] dark:text-[#FCA5A5]">
                  Metrics unavailable ({metricsRes?.error || 'provider unavailable'}). Missing values are not fabricated.
                </div>
              )}
            </div>

            <div className="neu-surface rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--ip-border)]">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#10B981]" />
                  <h2 className="text-sm font-semibold text-[var(--ip-text)]">
                    Remediation & Safety Safeguards
                  </h2>
                </div>
                <span className="text-[10px] font-mono text-[#047857] dark:text-[#6EE7B7]">SIMULATION ONLY</span>
              </div>

              <div className="neu-inset rounded-xl p-3.5 space-y-2 text-xs font-mono">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--ip-text-muted)]">Proposed Action</span>
                  <span className="text-[var(--ip-text)]">
                    {workflow?.proposed_action ||
                      workflow?.diagnosis?.proposed_remediation.action ||
                      'scale_connection_pool_canary'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--ip-text-muted)]">Approval ID</span>
                  <span className="text-[#2563EB] dark:text-[#93C5FD] truncate max-w-[180px]">
                    {approvalRecord?.approval_id || workflow?.approval_id || 'Pending authorization'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--ip-text-muted)]">Slack Notification</span>
                  <span className="text-[var(--ip-text)]">
                    {workflow?.slack_status || (workflow?.slack_notified ? 'sent' : 'not_dispatched')}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--ip-text-muted)]">Execution Mode</span>
                  <span className="text-[#047857] dark:text-[#6EE7B7]">simulation_mode=true (No real infra calls)</span>
                </div>
              </div>

              {approvalRecord?.result_message && (
                <div className="bg-[#10B981]/10 border border-[#10B981]/25 rounded-xl p-3 text-xs text-[#047857] dark:text-[#6EE7B7] font-mono">
                  {approvalRecord.result_message}
                </div>
              )}

              {isRejected && !approvalRecord && (
                <div className="bg-[#EF4444]/10 border border-[#EF4444]/25 rounded-xl p-3 text-xs text-[#DC2626] dark:text-[#FCA5A5] font-mono">
                  Human commander rejected remediation proposal. Execution remained blocked.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: CROSS-SIGNAL TIMELINE & LOGS */}
      {activeSection === 'signals' && (
        <div className="space-y-6">
          <div className="neu-surface rounded-2xl p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[var(--ip-border)]">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#3B82F6] dark:text-[#60A5FA]" />
                <h2 className="text-sm font-semibold text-[var(--ip-text)]">
                  Unified Cross-Signal Timeline ({filteredTimeline.length})
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative flex items-center w-full sm:w-auto">
                  <Search className="w-3.5 h-3.5 text-[var(--ip-text-muted)] absolute left-3 pointer-events-none" />
                  <input
                    type="text"
                    value={signalQuery}
                    onChange={(e) => setSignalQuery(e.target.value)}
                    placeholder="Filter observation or trace_id..."
                    className="neu-inset focus:border-[#3B82F6]/50 text-[var(--ip-text)] text-xs font-mono pl-8 pr-3 py-1.5 rounded-xl outline-none placeholder-[var(--ip-text-muted)] w-full sm:w-64"
                  />
                </div>

                <div className="flex items-center neu-inset rounded-xl p-0.5 text-xs font-mono">
                  {(['ALL', 'METRIC', 'LOG', 'TRACE'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setSignalFilter(t)}
                      className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer text-[11px] ${
                        signalFilter === t
                          ? 'neu-pill text-[var(--ip-text)] font-semibold'
                          : 'text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)]'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {filteredTimeline.length === 0 ? (
              <div className="neu-inset rounded-xl p-6 text-center text-xs font-mono text-[var(--ip-text-muted)]">
                No correlated signals match the active filter for {incident.service}.
              </div>
            ) : (
              <div className="neu-inset rounded-xl divide-y divide-[var(--ip-border)] max-h-[420px] overflow-y-auto">
                {filteredTimeline.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2 text-xs hover:bg-[var(--ip-pill)]/40 transition-colors"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                        <span className="text-[var(--ip-text-muted)] tabular-nums">{ev.timestamp}</span>
                        <span className="px-1.5 py-0.5 rounded bg-[var(--ip-pill)] text-[#2563EB] dark:text-[#93C5FD] border border-[var(--ip-border)]">
                          {ev.evidence_type}
                        </span>
                        <ProvenancePill source={ev.data_source} />
                        {ev.trace_id && (
                          <span className="text-[var(--ip-text-secondary)]">trace={ev.trace_id}</span>
                        )}
                      </div>
                      <p className="text-[var(--ip-text)] leading-relaxed">{ev.observation}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="neu-surface rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--ip-border)]">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-[#3B82F6] dark:text-[#60A5FA]" />
                <h2 className="text-sm font-semibold text-[var(--ip-text)]">
                  Structured Log Events ({logsRes?.logs?.length ?? 0})
                </h2>
              </div>
              <ProvenancePill
                source={logsRes?.success === false ? 'UNAVAILABLE' : logsRes?.data_source || 'SIMULATED'}
              />
            </div>

            {logsRes?.success === false ? (
              <div className="neu-inset rounded-xl p-4 text-xs font-mono text-[#DC2626] dark:text-[#FCA5A5]">
                Log source unavailable ({logsRes.error || 'provider error'}). Missing logs were not invented.
              </div>
            ) : !logsRes?.logs || logsRes.logs.length === 0 ? (
              <div className="neu-inset rounded-xl p-4 text-xs font-mono text-[var(--ip-text-secondary)]">
                No structured logs returned for {incident.service} in the last {since}.
              </div>
            ) : (
              <div className="neu-inset rounded-xl divide-y divide-[var(--ip-border)] max-h-72 overflow-y-auto font-mono text-xs">
                {logsRes.logs.map((lg) => (
                  <div key={lg.id} className="p-3 flex flex-wrap sm:flex-nowrap items-start gap-2.5">
                    <span className="text-[var(--ip-text-muted)] text-[11px] shrink-0 tabular-nums">
                      {lg.timestamp}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${
                        lg.severity === 'FATAL' || lg.severity === 'ERROR'
                          ? 'bg-[#EF4444]/10 text-[#DC2626] dark:text-[#FCA5A5] border-[#EF4444]/25'
                          : lg.severity === 'WARN'
                          ? 'bg-[#F59E0B]/10 text-[#B45309] dark:text-[#FCD34D] border-[#F59E0B]/25'
                          : 'bg-[var(--ip-pill)] text-[var(--ip-text-secondary)] border-[var(--ip-border)]'
                      }`}
                    >
                      {lg.severity}
                    </span>
                    <span className="text-[var(--ip-text)] flex-1 min-w-0 break-words">{lg.message}</span>
                    <ProvenancePill source={lg.data_source} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION 3: AUDIT CHRONOLOGY */}
      {activeSection === 'audit' && (
        <div className="neu-surface rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--ip-border)]">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#3B82F6] dark:text-[#60A5FA]" />
              <h2 className="text-sm font-semibold text-[var(--ip-text)]">
                Recorded Audit Chronology ({incidentScopedAudit.length})
              </h2>
            </div>

            <div className="flex items-center neu-inset rounded-xl p-0.5 text-xs font-mono">
              <button
                type="button"
                onClick={() => setAuditScope('incident')}
                className={`px-2.5 py-1 rounded-lg cursor-pointer text-[11px] ${
                  auditScope === 'incident'
                    ? 'neu-pill text-[var(--ip-text)] font-semibold'
                    : 'text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)]'
                }`}
              >
                {incident.code} Matching
              </button>
              <button
                type="button"
                onClick={() => setAuditScope('all')}
                className={`px-2.5 py-1 rounded-lg cursor-pointer text-[11px] ${
                  auditScope === 'all'
                    ? 'neu-pill text-[var(--ip-text)] font-semibold'
                    : 'text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)]'
                }`}
              >
                All Audit Events ({auditEvents.length})
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {incidentScopedAudit.map((ev) => {
              const isAi = ev.actorType === 'AI_AGENT' || ev.actorType === 'CLAUDE_AGENT';
              const isHuman = ev.actorType === 'HUMAN_COMMANDER';
              const isOrch =
                ev.actorType === 'N8N_WORKFLOW' || ev.actorType === 'NODEJS_ORCHESTRATOR';
              const isSlack =
                ev.actorType === 'SLACK_NOTIFICATION' || ev.actorType === 'SLACK_INTERACTION';

              return (
                <div key={ev.id} className="neu-inset rounded-xl p-4 space-y-1.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono">
                    <div className="flex items-center gap-2 min-w-0">
                      {isSlack ? (
                        <MessageSquare className="w-3.5 h-3.5 text-[#7C3AED] dark:text-[#A78BFA] shrink-0" />
                      ) : isOrch ? (
                        <Workflow className="w-3.5 h-3.5 text-[#047857] dark:text-[#6EE7B7] shrink-0" />
                      ) : isAi ? (
                        <Bot className="w-3.5 h-3.5 text-[#2563EB] dark:text-[#93C5FD] shrink-0" />
                      ) : isHuman ? (
                        <User className="w-3.5 h-3.5 text-[#047857] dark:text-[#6EE7B7] shrink-0" />
                      ) : (
                        <Activity className="w-3.5 h-3.5 text-[#B45309] dark:text-[#FCD34D] shrink-0" />
                      )}
                      <span className="font-semibold text-[var(--ip-text)] truncate">{ev.action}</span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-[var(--ip-text-secondary)]">{ev.actorName}</span>
                      <span className="text-[var(--ip-text-muted)] tabular-nums">{ev.timestamp}</span>
                      {ev.verificationStatus === 'verified' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" />
                      ) : ev.verificationStatus === 'failed' ? (
                        <XCircle className="w-3.5 h-3.5 text-[#EF4444]" />
                      ) : null}
                    </div>
                  </div>
                  <p className="text-[var(--ip-text-secondary)] leading-relaxed">{ev.details}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
