import React, { useState } from 'react';
import { AiHypothesis, N8nWorkflowResponse } from '../../types/incident';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import {
  buildWhyThisRemediation,
  extractConfigurationChanges,
  inspectProposedCommand,
} from '../../utils/remediationDisplay';
import {
  Check,
  Copy,
  ShieldCheck,
  Terminal,
  X,
  RefreshCw,
  Bot,
  CheckCircle2,
  FileText,
  RotateCcw,
  ShieldAlert,
  Clock,
  Info,
  AlertTriangle,
} from 'lucide-react';

interface AiApprovalCardProps {
  hypothesis: AiHypothesis;
  onApprove: (flags: { [key: string]: boolean }) => void;
  onReject: (reason: string) => void;
  isExecuting?: boolean;
  onReanalyze?: () => void;
  isAnalyzing?: boolean;
  diagnosisSource?: 'claude_live' | 'demo_fallback';
  isRejectingServer?: boolean;
  rejectionFeedback?: { ok: boolean; text: string } | null;
  isMitigated?: boolean;
  lastN8nResult?: N8nWorkflowResponse | null;
  onNavigateToAudit?: () => void;
  onReset?: () => void;
}

export const AiApprovalCard: React.FC<AiApprovalCardProps> = ({
  hypothesis,
  onApprove,
  onReject,
  isExecuting = false,
  onReanalyze,
  isAnalyzing = false,
  diagnosisSource = 'demo_fallback',
  isRejectingServer = false,
  rejectionFeedback = null,
  isMitigated = false,
  lastN8nResult = null,
  onNavigateToAudit,
  onReset,
}) => {
  const [flags, setFlags] = useState<{ [key: string]: boolean }>({
    DRAIN_STALE_CONNECTIONS: true,
    ROLLING_CANARY_FIRST: true,
    AUTO_REVERT_ON_ERROR_SPIKE: true,
  });

  const [copied, setCopied] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const toggleFlag = (flagName: string) => {
    setFlags((prev) => ({
      ...prev,
      [flagName]: !prev[flagName],
    }));
  };

  const commandAssessment = inspectProposedCommand(hypothesis.dryRunDiff.command);
  const proposedCommand = commandAssessment.command;
  const whyRemediation = buildWhyThisRemediation(hypothesis);
  const configChanges = extractConfigurationChanges(hypothesis);

  const copyCommand = () => {
    if (commandAssessment.copyDisabled || !proposedCommand) return;
    navigator.clipboard.writeText(proposedCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApprove = () => {
    onApprove(flags);
  };

  const handleRejectSubmit = () => {
    onReject(rejectReason || 'Commander requested alternate remediation path.');
    setRejecting(false);
  };

  const isRejected = hypothesis.status === 'rejected';
  const confidencePct = Math.max(0, Math.min(100, hypothesis.confidence));

  const runbookActionStatus = isMitigated
    ? { label: 'Approved · Simulated', variant: 'healthy' as const }
    : isRejected
    ? { label: 'Rejected · Blocked', variant: 'critical' as const }
    : isExecuting
    ? { label: 'Simulating...', variant: 'ai-hypothesis' as const }
    : { label: 'Pending Approval', variant: 'warning' as const };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 min-w-0">
      {/* BOTTOM LEFT: AI Hypotheses & Observed Evidence */}
      <section className="xl:col-span-6 neu-surface rounded-2xl p-5 sm:p-6 flex flex-col justify-between space-y-5 min-w-0">
        <div className="space-y-5 min-w-0">
          {/* Card Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3.5 border-b border-[var(--ip-border)]">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <Bot className="w-4 h-4 text-[#3B82F6] dark:text-[#60A5FA] shrink-0" />
              <h2 className="text-sm font-semibold text-[var(--ip-text)] tracking-tight">
                AI Hypotheses
              </h2>
              <Badge variant="ai-hypothesis" confidence={hypothesis.confidence} />
              {diagnosisSource === 'claude_live' ? (
                <Badge variant="healthy" showSquare>
                  Claude Live
                </Badge>
              ) : (
                <Badge variant="warning" showSquare>
                  Demo / Fallback Diagnosis
                </Badge>
              )}
              {isRejected && (
                <Badge variant="critical" showSquare>
                  Rejected · No Execution
                </Badge>
              )}
            </div>

            {onReanalyze && !isMitigated && (
              <button
                type="button"
                onClick={onReanalyze}
                disabled={isAnalyzing || isExecuting}
                className="neu-pill flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium text-[#2563EB] dark:text-[#60A5FA] transition-colors cursor-pointer disabled:opacity-50"
                title="Re-run Claude AI structured incident analysis"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                <span>{isAnalyzing ? 'Analyzing...' : 'Re-analyze'}</span>
              </button>
            )}
          </div>

          {/* Primary Hypothesis + Confidence Meter */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
              <span className="text-[var(--ip-text-secondary)] uppercase tracking-wider font-medium">
                Probable Root Cause · {hypothesis.telemetrySpanEvidence.culpritResource}
              </span>
              <span className="text-[#B45309] dark:text-[#FBBF24] font-semibold">[AI HYPOTHESIS]</span>
            </div>

            <h3 className="text-base font-semibold text-[var(--ip-text)] leading-snug">
              {hypothesis.title}
            </h3>

            {/* Visual Confidence Indicator Bar */}
            <div className="neu-inset rounded-xl p-3 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-[var(--ip-text-muted)]">Hypothesis Confidence Score</span>
                <span className="text-[#2563EB] dark:text-[#93C5FD] font-semibold tabular-nums">
                  {confidencePct.toFixed(1)}%
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-black/15 dark:bg-black/35 overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#3B82F6] transition-all duration-300"
                  style={{ width: `${confidencePct}%` }}
                />
              </div>
            </div>

            <p className="text-xs sm:text-[13px] text-[var(--ip-text-secondary)] leading-relaxed">
              {hypothesis.rootCause}
            </p>

            {hypothesis.correlation?.hypothesis && (
              <div className="neu-inset rounded-xl p-3 text-[11px] font-mono space-y-1.5">
                <div className="text-[#2563EB] dark:text-[#93C5FD] leading-relaxed">
                  {hypothesis.correlation.hypothesis.confidence_explanation}
                </div>
                <div className="text-[#B45309] dark:text-[#FBBF24] leading-relaxed">
                  {hypothesis.correlation.hypothesis.causation_disclaimer}
                </div>
              </div>
            )}
          </div>

          {/* Observed Evidence & Cross-Signal Correlation */}
          <div className="neu-inset rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
              <span className="text-[#047857] dark:text-[#34D399] font-semibold">[OBSERVED EVIDENCE]</span>
              <span className="text-[var(--ip-text-muted)] truncate">
                Trace: {hypothesis.telemetrySpanEvidence.traceId}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs font-mono pt-2 border-t border-[var(--ip-border)]">
              <div className="min-w-0">
                <div className="text-[10px] text-[var(--ip-text-muted)] uppercase">Culprit Span</div>
                <div className="text-[#DC2626] dark:text-[#F87171] font-medium truncate mt-0.5">
                  {hypothesis.telemetrySpanEvidence.spanName}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] text-[var(--ip-text-muted)] uppercase">Observed / Baseline</div>
                <div className="text-[#DC2626] dark:text-[#F87171] font-medium tabular-nums mt-0.5">
                  {hypothesis.telemetrySpanEvidence.durationMs}ms{' '}
                  <span className="text-[var(--ip-text-muted)] font-normal">
                    (norm {hypothesis.telemetrySpanEvidence.normalBaselineMs}ms)
                  </span>
                </div>
              </div>
            </div>

            {/* Metrics Snapshot */}
            {hypothesis.metricsEvidence && (
              <div className="pt-3 border-t border-[var(--ip-border)] space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="text-[var(--ip-text-secondary)] uppercase">
                    Metrics ({hypothesis.metricsEvidence.service})
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-md border text-[10px] ${
                      !hypothesis.metricsEvidence.available
                        ? 'text-[#DC2626] dark:text-[#F87171] bg-[#EF4444]/10 border-[#EF4444]/35'
                        : hypothesis.metricsEvidence.data_source === 'LIVE'
                        ? 'text-[#047857] dark:text-[#34D399] bg-[#10B981]/10 border-[#10B981]/35'
                        : 'text-[#B45309] dark:text-[#FBBF24] bg-[#F59E0B]/10 border-[#F59E0B]/35'
                    }`}
                  >
                    {!hypothesis.metricsEvidence.available
                      ? `${hypothesis.metricsEvidence.data_source} UNAVAILABLE`
                      : `${hypothesis.metricsEvidence.data_source} · ${hypothesis.metricsEvidence.provider.toUpperCase()}`}
                  </span>
                </div>

                {!hypothesis.metricsEvidence.available ? (
                  <div className="text-[11px] font-mono text-[#DC2626] dark:text-[#F87171]">
                    Telemetry unavailable ({hypothesis.metricsEvidence.unavailable_reason || 'provider error'}). Missing metrics were not invented.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] font-mono">
                    {hypothesis.metricsEvidence.observations.map((obs) => (
                      <div key={obs.name} className="neu-surface rounded-lg px-2.5 py-1.5 min-w-0">
                        <span className="text-[10px] text-[var(--ip-text-muted)] block truncate">{obs.label}</span>
                        <span className={obs.status === 'observed' ? 'text-[var(--ip-text)] font-semibold' : 'text-[#B45309] dark:text-[#FBBF24]'}>
                          {obs.status === 'observed' && obs.value !== null ? `${obs.value}${obs.unit}` : 'Missing'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Structured Logs Snapshot */}
            {hypothesis.logsEvidence && (
              <div className="pt-3 border-t border-[var(--ip-border)] space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="text-[var(--ip-text-secondary)] uppercase">
                    Structured Logs ({hypothesis.logsEvidence.service})
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-md border text-[10px] ${
                      !hypothesis.logsEvidence.available
                        ? 'text-[#DC2626] dark:text-[#F87171] bg-[#EF4444]/10 border-[#EF4444]/35'
                        : hypothesis.logsEvidence.data_source === 'LIVE'
                        ? 'text-[#047857] dark:text-[#34D399] bg-[#10B981]/10 border-[#10B981]/35'
                        : 'text-[#B45309] dark:text-[#FBBF24] bg-[#F59E0B]/10 border-[#F59E0B]/35'
                    }`}
                  >
                    {!hypothesis.logsEvidence.available
                      ? `${hypothesis.logsEvidence.data_source} UNAVAILABLE`
                      : `${hypothesis.logsEvidence.data_source} · ${hypothesis.logsEvidence.provider.toUpperCase()}`}
                  </span>
                </div>

                {!hypothesis.logsEvidence.available ? (
                  <div className="text-[11px] font-mono text-[#DC2626] dark:text-[#F87171]">
                    Log source unavailable ({hypothesis.logsEvidence.unavailable_reason || 'provider error'}). Missing log events were not invented.
                  </div>
                ) : hypothesis.logsEvidence.logs.length === 0 ? (
                  <div className="text-[11px] font-mono text-[var(--ip-text-secondary)]">
                    No structured log events observed in window ({hypothesis.logsEvidence.since || '30m'}).
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {hypothesis.logsEvidence.logs.slice(0, 4).map((entry) => {
                      const sevStyle =
                        entry.severity === 'FATAL' || entry.severity === 'ERROR'
                          ? 'text-[#DC2626] dark:text-[#F87171] bg-[#EF4444]/10 border-[#EF4444]/30'
                          : entry.severity === 'WARN'
                          ? 'text-[#B45309] dark:text-[#FBBF24] bg-[#F59E0B]/10 border-[#F59E0B]/30'
                          : 'text-[var(--ip-text-secondary)] bg-[var(--ip-pill)] border-[var(--ip-border)]';
                      return (
                        <div
                          key={entry.id}
                          className="neu-surface rounded-lg px-2.5 py-2 text-[11px] font-mono space-y-1"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className={`px-1.5 py-0.2 rounded border text-[9px] font-semibold ${sevStyle}`}>
                                {entry.severity}
                              </span>
                              <span className="text-[#2563EB] dark:text-[#60A5FA] truncate">{entry.service}</span>
                            </div>
                            <span className="text-[var(--ip-text-muted)] text-[10px] tabular-nums">{entry.timestamp}</span>
                          </div>
                          <div className="text-[var(--ip-text)] break-words leading-relaxed">{entry.message}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Distributed Traces Snapshot */}
            {hypothesis.tracesEvidence && (
              <div className="pt-3 border-t border-[var(--ip-border)] space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="text-[var(--ip-text-secondary)] uppercase">
                    Distributed Traces ({hypothesis.tracesEvidence.service})
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-md border text-[10px] ${
                      !hypothesis.tracesEvidence.available
                        ? 'text-[#DC2626] dark:text-[#F87171] bg-[#EF4444]/10 border-[#EF4444]/35'
                        : hypothesis.tracesEvidence.data_source === 'LIVE'
                        ? 'text-[#047857] dark:text-[#34D399] bg-[#10B981]/10 border-[#10B981]/35'
                        : 'text-[#B45309] dark:text-[#FBBF24] bg-[#F59E0B]/10 border-[#F59E0B]/35'
                    }`}
                  >
                    {!hypothesis.tracesEvidence.available
                      ? `${hypothesis.tracesEvidence.data_source} UNAVAILABLE`
                      : `${hypothesis.tracesEvidence.data_source} · ${hypothesis.tracesEvidence.provider.toUpperCase()}`}
                  </span>
                </div>

                {!hypothesis.tracesEvidence.available ? (
                  <div className="text-[11px] font-mono text-[#DC2626] dark:text-[#F87171]">
                    Trace source unavailable ({hypothesis.tracesEvidence.unavailable_reason || 'provider error'}). Missing spans were not invented.
                  </div>
                ) : hypothesis.tracesEvidence.traces.length === 0 ? (
                  <div className="text-[11px] font-mono text-[var(--ip-text-secondary)]">
                    No distributed traces observed in window ({hypothesis.tracesEvidence.since || '30m'}).
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {hypothesis.tracesEvidence.traces.slice(0, 2).map((tr) => (
                      <div
                        key={tr.trace_id}
                        className="neu-surface rounded-lg px-2.5 py-2 text-[11px] font-mono space-y-1"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <span className="text-[#2563EB] dark:text-[#60A5FA] font-semibold truncate">{tr.trace_id}</span>
                          <span className={tr.has_error ? 'text-[#DC2626] dark:text-[#F87171]' : 'text-[#047857] dark:text-[#34D399]'}>
                            {tr.status} · {tr.total_duration_ms}ms · {tr.spans.length} spans
                          </span>
                        </div>
                        <div className="text-[var(--ip-text-secondary)] text-[10px] break-words leading-relaxed">
                          {tr.spans.map((s) => `${s.service_name} (${s.duration_ms}ms)`).join(' → ')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Unified Cross-Signal Evidence Timeline */}
            {hypothesis.correlation && (
              <div className="pt-3 border-t border-[var(--ip-border)] space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="text-[var(--ip-text-secondary)] uppercase font-medium">
                    Cross-Signal Timeline ({hypothesis.correlation.timeline.length})
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {hypothesis.correlation.source_provenance.mixed_sources && (
                      <span className="px-2 py-0.5 rounded-md border text-[10px] text-[#B45309] dark:text-[#FBBF24] bg-[#F59E0B]/10 border-[#F59E0B]/35">
                        MIXED SOURCES
                      </span>
                    )}
                    <span className="text-[10px] text-[var(--ip-text-muted)]">
                      {hypothesis.correlation.groups.length} group(s) · {hypothesis.correlation.since}
                    </span>
                  </div>
                </div>

                {hypothesis.correlation.timeline.length === 0 ? (
                  <div className="text-[11px] font-mono text-[var(--ip-text-secondary)]">
                    No correlated timeline events available.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                    {hypothesis.correlation.timeline.slice(0, 10).map((ev) => {
                      const sourceStyle =
                        ev.data_source === 'UNAVAILABLE'
                          ? 'text-[#DC2626] dark:text-[#F87171] bg-[#EF4444]/10 border-[#EF4444]/30'
                          : ev.data_source === 'LIVE'
                          ? 'text-[#047857] dark:text-[#34D399] bg-[#10B981]/10 border-[#10B981]/30'
                          : 'text-[#B45309] dark:text-[#FBBF24] bg-[#F59E0B]/10 border-[#F59E0B]/30';
                      const typeStyle =
                        ev.evidence_type === 'TRACE'
                          ? 'text-[#7C3AED] dark:text-[#C4B5FD] bg-[#8B5CF6]/10 border-[#8B5CF6]/30'
                          : ev.evidence_type === 'LOG'
                          ? 'text-[#2563EB] dark:text-[#93C5FD] bg-[#3B82F6]/10 border-[#3B82F6]/30'
                          : 'text-[#047857] dark:text-[#6EE7B7] bg-[#10B981]/10 border-[#10B981]/30';
                      return (
                        <div
                          key={ev.id}
                          className="neu-surface rounded-lg px-2.5 py-2 text-[11px] font-mono space-y-1"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1.5">
                            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                              <span className={`px-1.5 py-0.2 rounded border text-[9px] font-semibold ${typeStyle}`}>
                                {ev.evidence_type}
                              </span>
                              <span className={`px-1.5 py-0.2 rounded border text-[9px] font-semibold ${sourceStyle}`}>
                                {ev.data_source}
                              </span>
                              <span className="text-[var(--ip-text)] truncate">{ev.service}</span>
                            </div>
                            <span className="text-[var(--ip-text-muted)] text-[10px] tabular-nums">{ev.timestamp}</span>
                          </div>
                          <div className="text-[var(--ip-text-secondary)] break-words leading-relaxed">{ev.observation}</div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {hypothesis.correlation.missing_and_limitations.length > 0 && (
                  <div className="text-[11px] font-mono text-[var(--ip-text-secondary)] space-y-1 pt-1">
                    {hypothesis.correlation.missing_and_limitations.slice(0, 2).map((lim, i) => (
                      <div key={i} className="leading-relaxed">
                        · {lim}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Affected Pods & Operational Trade-offs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="text-[11px] font-mono text-[var(--ip-text-secondary)] uppercase mb-2">
                Affected Pods ({hypothesis.affectedPods.length})
              </div>
              <div className="space-y-1.5 font-mono text-[11px]">
                {hypothesis.affectedPods.slice(0, 4).map((pod) => (
                  <div
                    key={pod}
                    className="neu-inset px-2.5 py-1.5 text-[var(--ip-text)] rounded-lg flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{pod}</span>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isMitigated ? 'bg-[#10B981]' : 'bg-[#EF4444]'}`} />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-mono text-[var(--ip-text-secondary)] uppercase mb-2">
                Operational Trade-offs
              </div>
              <ul className="space-y-1.5 text-xs text-[var(--ip-text-secondary)]">
                {hypothesis.risks.map((risk, idx) => (
                  <li key={idx} className="flex items-start gap-2 leading-relaxed">
                    <span className="text-[#F59E0B] shrink-0">·</span>
                    <span>{risk}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Confirm / Reject Actions Footer */}
        <div className="pt-4 border-t border-[var(--ip-border)]">
          {isMitigated ? (
            <div className="neu-inset rounded-xl p-4 space-y-3 border border-[#10B981]/30">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#10B981] shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-[var(--ip-text)]">
                    {lastN8nResult?.raw?.engine === 'nodejs_express_native'
                      ? 'Hypothesis Confirmed · Simulated Remediation Verified'
                      : 'Hypothesis Confirmed · Workflow Executed (Simulated)'}
                  </div>
                  <p className="text-[11px] text-[var(--ip-text-secondary)] mt-1 leading-relaxed">
                    {lastN8nResult?.result_message || 'Simulated remediation verified with simulation_mode=true.'}
                  </p>
                  {lastN8nResult && (
                    <div className="text-[10px] font-mono text-[var(--ip-text-muted)] mt-1.5">
                      Approval ID: <strong className="text-[var(--ip-text)]">{lastN8nResult.approval_id}</strong>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {onNavigateToAudit && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={onNavigateToAudit}
                    icon={<FileText className="w-3.5 h-3.5" />}
                  >
                    View Audit Trail
                  </Button>
                )}
                {onReset && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onReset}
                    icon={<RotateCcw className="w-3.5 h-3.5" />}
                  >
                    Reset State
                  </Button>
                )}
              </div>
            </div>
          ) : rejecting ? (
            <div className="neu-inset rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between text-xs font-mono text-[#DC2626] dark:text-[#F87171]">
                <span className="font-semibold">Confirm Hypothesis Rejection (Zero Execution)</span>
                <button
                  type="button"
                  onClick={() => setRejecting(false)}
                  className="text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <input
                type="text"
                placeholder="Enter rejection rationale for immutable audit log..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full neu-surface focus:border-[#3B82F6] text-[var(--ip-text)] text-xs font-mono p-2.5 rounded-lg outline-none"
              />
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setRejecting(false)} disabled={isRejectingServer}>
                  Cancel
                </Button>
                <Button variant="destructive" size="sm" onClick={handleRejectSubmit} disabled={isRejectingServer}>
                  {isRejectingServer ? 'Recording Rejection...' : 'Confirm Rejection'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="neu-inset rounded-xl p-4 space-y-3">
              {rejectionFeedback && (
                <div
                  className={`text-xs font-mono px-3 py-2 rounded-lg border ${
                    rejectionFeedback.ok
                      ? 'text-[#047857] dark:text-[#34D399] bg-[#10B981]/10 border-[#10B981]/30'
                      : 'text-[#DC2626] dark:text-[#F87171] bg-[#EF4444]/10 border-[#EF4444]/30'
                  }`}
                >
                  {rejectionFeedback.text}
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--ip-text)]">
                    <ShieldCheck className="w-4 h-4 text-[#10B981] shrink-0" />
                    <span>
                      {isRejected
                        ? 'Decision Recorded: Rejected (No Execution)'
                        : 'Human Verification Required'}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-[var(--ip-text-muted)]">
                    Confirm or reject hypothesis · simulation_mode=true
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => setRejecting(true)}
                    disabled={isExecuting || isRejectingServer || isRejected}
                  >
                    {isRejected ? 'Hypothesis Rejected' : 'Reject'}
                  </Button>

                  <Button
                    variant="primary"
                    size="md"
                    onClick={handleApprove}
                    disabled={isExecuting || isRejectingServer || isRejected}
                    icon={isExecuting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : undefined}
                  >
                    {isExecuting ? 'Simulating...' : 'Confirm & Remediate'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* BOTTOM RIGHT: Runbook Remediation Cards */}
      <section className="xl:col-span-6 neu-surface rounded-2xl p-5 sm:p-6 flex flex-col justify-between space-y-5 min-w-0">
        <div className="space-y-4 min-w-0">
          {/* Card Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3.5 border-b border-[var(--ip-border)]">
            <div className="flex items-center gap-2 min-w-0">
              <Terminal className="w-4 h-4 text-[#3B82F6] dark:text-[#60A5FA] shrink-0" />
              <h2 className="text-sm font-semibold text-[var(--ip-text)] tracking-tight">
                Runbook Remediation
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant={runbookActionStatus.variant} showSquare>
                {runbookActionStatus.label}
              </Badge>
              <span className="text-[11px] font-mono text-[var(--ip-text-muted)]">
                Est. {hypothesis.estimatedMitigationSeconds}s
              </span>
            </div>
          </div>

          {/* Primary Runbook Card */}
          <div className="neu-inset rounded-2xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5 min-w-0">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--ip-text-muted)]">
                  RB-01 · Primary Mitigation Proposal
                </div>
                <div className="text-xs font-semibold text-[var(--ip-text)] truncate">
                  {hypothesis.recommendedAction}
                </div>
              </div>
            </div>

            {/* Why this remediation? — Strictly derived from available incident evidence */}
            <div className="neu-surface rounded-xl p-3.5 space-y-2.5 border border-[var(--ip-border)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ip-text)]">
                  <Info className="w-3.5 h-3.5 text-[#3B82F6] dark:text-[#60A5FA] shrink-0" />
                  <span>Why this remediation?</span>
                </div>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                    whyRemediation.evidenceStatusLabel.includes('UNAVAILABLE')
                      ? 'text-[#DC2626] dark:text-[#F87171] bg-[#EF4444]/10 border-[#EF4444]/30'
                      : whyRemediation.evidenceStatusLabel.startsWith('LIVE')
                      ? 'text-[#047857] dark:text-[#34D399] bg-[#10B981]/10 border-[#10B981]/30'
                      : 'text-[#B45309] dark:text-[#FBBF24] bg-[#F59E0B]/10 border-[#F59E0B]/30'
                  }`}
                >
                  {whyRemediation.evidenceStatusLabel}
                </span>
              </div>

              {whyRemediation.reasons.length === 0 ? (
                <div className="text-[11px] font-mono text-[#DC2626] dark:text-[#F87171]">
                  No verified telemetry evidence is attached to this incident yet. Do not treat this proposal as validated.
                </div>
              ) : (
                <ul className="space-y-1.5 text-[11px] leading-relaxed">
                  {whyRemediation.reasons.map((item, idx) => {
                    const provTone =
                      item.provenance === 'UNAVAILABLE'
                        ? 'text-[#DC2626] dark:text-[#F87171]'
                        : item.provenance === 'LIVE'
                        ? 'text-[#047857] dark:text-[#34D399]'
                        : 'text-[#B45309] dark:text-[#FBBF24]';
                    return (
                      <li key={`${item.signal}-${idx}`} className="text-[var(--ip-text-secondary)]">
                        <span className="font-mono font-semibold text-[var(--ip-text)]">{item.signal}</span>{' '}
                        <span className={`font-mono text-[10px] ${provTone}`}>[{item.provenance}]</span>
                        <span className="text-[var(--ip-text-muted)]"> · </span>
                        <span>{item.detail}</span>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="pt-2 border-t border-[var(--ip-border)] text-[11px] text-[var(--ip-text-secondary)] leading-relaxed flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-[#F59E0B] shrink-0 mt-0.5" />
                <span>{whyRemediation.safetyCaveat}</span>
              </div>
            </div>

            {/* Required Header & Copy Button */}
            <div className="space-y-2 pt-2 border-t border-[var(--ip-border)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-mono font-semibold text-[var(--ip-text)] uppercase tracking-wider">
                  PROPOSED REMEDIATION
                </span>
                <button
                  type="button"
                  onClick={copyCommand}
                  disabled={commandAssessment.copyDisabled}
                  className="neu-pill flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)] transition-colors cursor-pointer shrink-0 disabled:opacity-45 disabled:cursor-not-allowed"
                  title={commandAssessment.copyDisabledReason || 'Copy proposed command'}
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-[#10B981]" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy Proposed Command'}</span>
                </button>
              </div>

              {commandAssessment.copyDisabled && commandAssessment.copyDisabledReason && (
                <div className="text-[11px] font-mono text-[#B45309] dark:text-[#FCD34D] leading-relaxed">
                  {commandAssessment.copyDisabledReason}
                </div>
              )}
            </div>

            {/* Proposed Command Display (never presented as executable dry-run when incomplete) */}
            <div className="neu-surface rounded-xl p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono">
                <span className="text-[var(--ip-text-muted)] uppercase tracking-wider">
                  {commandAssessment.isExecutableDryRun
                    ? 'Proposed Command (Dry-Run Flag Present)'
                    : 'Incomplete Proposed Command · Not an Executable Dry-Run'}
                </span>
                <span
                  className={`px-2 py-0.5 rounded border ${
                    commandAssessment.isExecutableDryRun
                      ? 'text-[var(--ip-text-secondary)] bg-[var(--ip-pill)] border-[var(--ip-border-strong)]'
                      : 'text-[#B45309] dark:text-[#FCD34D] bg-[#F59E0B]/10 border-[#F59E0B]/30'
                  }`}
                >
                  {commandAssessment.isExecutableDryRun ? 'SIMULATION-ONLY' : 'INCOMPLETE PROPOSAL'}
                </span>
              </div>

              <div className="overflow-x-auto text-xs font-mono text-[#2563EB] dark:text-[#93C5FD]">
                <code className="whitespace-nowrap">
                  {proposedCommand || 'No proposed command provided.'}
                </code>
              </div>

              {!commandAssessment.isExecutableDryRun && (
                <div className="pt-2 border-t border-[var(--ip-border)] text-[11px] font-mono text-[#B45309] dark:text-[#FCD34D] space-y-1">
                  {commandAssessment.missingRequirements.map((req, idx) => (
                    <div key={idx} className="flex items-start gap-1.5">
                      <span aria-hidden="true">·</span>
                      <span>{req}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Required Visible Warning Below Command */}
            <div
              role="note"
              className="rounded-xl px-3.5 py-2.5 bg-[#F59E0B]/12 border border-[#F59E0B]/35 text-xs text-[#92400E] dark:text-[#FCD34D] leading-relaxed"
            >
              ⚠️ Proposed command only. Review and complete the command before execution. IncidentPilot is currently in simulation-only mode. No infrastructure changes will be made.
            </div>

            {/* Current Configuration vs Proposed Target Diff */}
            <div className="neu-surface rounded-xl overflow-hidden">
              <div className="px-3.5 py-2 border-b border-[var(--ip-border)] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                <span className="font-semibold text-[var(--ip-text)]">
                  Current Configuration vs Proposed Target
                </span>
                <span className="text-[var(--ip-text-muted)]">
                  Snapshot values only · Mandatory human approval required
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--ip-border)] text-[11px] font-mono leading-relaxed">
                <div className="p-3 min-w-0 overflow-x-auto">
                  <div className="text-[#DC2626] dark:text-[#F87171] font-semibold mb-1.5">
                    - Current Configuration
                  </div>
                  <pre className="text-[#B91C1C] dark:text-[#FCA5A5] whitespace-pre-wrap break-words">
                    {hypothesis.dryRunDiff.oldConfig || 'No current configuration snapshot provided.'}
                  </pre>
                </div>
                <div className="p-3 min-w-0 overflow-x-auto">
                  <div className="text-[#047857] dark:text-[#34D399] font-semibold mb-1.5">
                    + Proposed Target
                  </div>
                  <pre className="text-[#065F46] dark:text-[#6EE7B7] whitespace-pre-wrap break-words">
                    {hypothesis.dryRunDiff.newConfig || 'No proposed target configuration provided.'}
                  </pre>
                </div>
              </div>
            </div>

            {/* Per-Change Expected Impact & Potential Risks */}
            <div className="neu-surface rounded-xl p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-mono font-semibold text-[var(--ip-text)] uppercase tracking-wider">
                  Configuration Change Impact &amp; Risks ({configChanges.length})
                </span>
                <span className="text-[10px] font-mono text-[var(--ip-text-muted)]">
                  simulation_mode=true
                </span>
              </div>

              {configChanges.length === 0 ? (
                <div className="text-[11px] font-mono text-[var(--ip-text-secondary)]">
                  No configuration parameter deltas detected in snapshot.
                </div>
              ) : (
                <div className="divide-y divide-[var(--ip-border)]">
                  {configChanges.map((change) => (
                    <div key={change.parameter} className="py-2.5 first:pt-1 last:pb-0 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                        <span className="font-semibold text-[var(--ip-text)]">{change.parameter}</span>
                        <div className="flex items-center gap-1.5 tabular-nums">
                          <span className="text-[#B91C1C] dark:text-[#FCA5A5]">
                            Current: {change.currentValue}
                          </span>
                          <span className="text-[var(--ip-text-muted)]" aria-hidden="true">→</span>
                          <span className="text-[#047857] dark:text-[#6EE7B7] font-semibold">
                            Target: {change.proposedValue}
                          </span>
                        </div>
                      </div>
                      <div className="text-[11px] leading-relaxed text-[var(--ip-text-secondary)]">
                        <span className="font-semibold text-[#047857] dark:text-[#34D399]">Expected impact:</span>{' '}
                        {change.expectedImpact}
                      </div>
                      <div className="text-[11px] leading-relaxed text-[var(--ip-text-secondary)]">
                        <span className="font-semibold text-[#B45309] dark:text-[#FBBF24]">Potential risks:</span>{' '}
                        {change.potentialRisks}
                      </div>
                      <div className="text-[10px] font-mono text-[var(--ip-text-muted)]">
                        {change.evidenceGrounding}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Safeguard Parameter Toggles */}
            <div>
              <div className="text-[11px] font-mono text-[var(--ip-text-secondary)] uppercase tracking-wider mb-2">
                Execution Safeguard Flags
              </div>
              <div className="space-y-2">
                {hypothesis.dryRunDiff.flags.map((flag) => {
                  const isChecked = flags[flag.name] ?? false;
                  return (
                    <label
                      key={flag.name}
                      className="flex items-start gap-3 p-2.5 neu-surface rounded-xl cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={isMitigated || isRejected}
                        onChange={() => toggleFlag(flag.name)}
                        className="mt-0.5 rounded border-[var(--ip-border-strong)] bg-[var(--ip-inset)] text-[#3B82F6] focus:ring-[#3B82F6] cursor-pointer"
                      />
                      <div className="text-xs min-w-0">
                        <div className="flex flex-wrap items-center gap-2 font-mono">
                          <span className="font-semibold text-[var(--ip-text)]">{flag.name}</span>
                          <span className="text-[10px] text-[#2563EB] dark:text-[#60A5FA] bg-[#3B82F6]/12 px-1.5 py-0.5 rounded">
                            {flag.value}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--ip-text-secondary)] mt-1 leading-relaxed">
                          {flag.description}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Secondary Runbook Status Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="neu-inset rounded-xl p-3.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-[var(--ip-text-muted)]">RB-02 · Follow-Up</span>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#B45309] dark:text-[#FBBF24]">
                  <Clock className="w-3 h-3" />
                  Queued
                </span>
              </div>
              <div className="text-xs font-medium text-[var(--ip-text)]">
                Index oauth_tokens (revoked_at, client_id)
              </div>
              <div className="text-[11px] text-[var(--ip-text-secondary)]">
                Requires manual DB migration ticket · Non-executing
              </div>
            </div>

            <div className="neu-inset rounded-xl p-3.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-[var(--ip-text-muted)]">RB-03 · Guardrail</span>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#047857] dark:text-[#34D399]">
                  <ShieldAlert className="w-3 h-3" />
                  Policy Active
                </span>
              </div>
              <div className="text-xs font-medium text-[var(--ip-text)]">
                simulation_mode=true Enforced
              </div>
              <div className="text-[11px] text-[var(--ip-text-secondary)]">
                No shell access or live cluster mutation permitted
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
