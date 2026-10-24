import React, { useState } from 'react';
import { AiHypothesis } from '../../types/incident';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Check, Copy, AlertTriangle, ShieldCheck, Terminal, X, RefreshCw } from 'lucide-react';

interface AiApprovalCardProps {
  hypothesis: AiHypothesis;
  onApprove: (flags: { [key: string]: boolean }) => void;
  onReject: (reason: string) => void;
  isExecuting?: boolean;
}

export const AiApprovalCard: React.FC<AiApprovalCardProps> = ({
  hypothesis,
  onApprove,
  onReject,
  isExecuting = false,
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

  const copyCommand = () => {
    navigator.clipboard.writeText(hypothesis.dryRunDiff.command);
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

  return (
    <div className="bg-[#111827] border border-[#374151] rounded-lg overflow-hidden shadow-2xl">
      {/* Header bar of approval card */}
      <div className="bg-[#151C27] border-b border-[#374151] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Badge variant="ai-hypothesis" confidence={hypothesis.confidence} />
          <span className="text-xs font-mono text-[#9CA3AF]">
            Target: <strong className="text-[#DCE2F3]">{hypothesis.telemetrySpanEvidence.culpritResource}</strong>
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono text-[#9CA3AF]">
          <span>Est. Mitigation: <strong className="text-[#34D399] font-medium">{hypothesis.estimatedMitigationSeconds}s</strong></span>
          <span className="text-[#424754]">|</span>
          <span className="flex items-center gap-1 text-[#FBBF24]">
            <AlertTriangle className="w-3.5 h-3.5" />
            Human-in-the-Loop Checkpoint
          </span>
        </div>
      </div>

      {/* Two-Column Diagnostic Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#374151]">
        {/* Left Panel: Hypothesis & Evidence (Col 1-5) */}
        <div className="lg:col-span-5 p-4 bg-[#111827] flex flex-col justify-between space-y-4">
          <div className="space-y-3.5">
            <div>
              <div className="text-[11px] font-mono text-[#9CA3AF] uppercase tracking-wider mb-1">
                Root Cause Synthesis
              </div>
              <h3 className="text-sm font-semibold text-[#F9FAFB] leading-snug">
                {hypothesis.title}
              </h3>
              <p className="mt-1.5 text-xs text-[#C2C6D6] leading-relaxed">
                {hypothesis.rootCause}
              </p>
            </div>

            {/* Parsed Telemetry Span Evidence */}
            <div className="bg-[#080C13] border border-[#1F2937] rounded p-3 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-[#9CA3AF]">Telemetry Evidence</span>
                <span className="text-[#6B7280]">Trace: {hypothesis.telemetrySpanEvidence.traceId}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-1 border-t border-[#1F2937]">
                <div>
                  <div className="text-[10px] text-[#6B7280] uppercase">Culprit Span</div>
                  <div className="text-[#F87171] font-medium truncate">
                    {hypothesis.telemetrySpanEvidence.spanName}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#6B7280] uppercase">Observed / Normal</div>
                  <div className="text-[#EF4444] font-medium tabular-nums">
                    {hypothesis.telemetrySpanEvidence.durationMs}ms{' '}
                    <span className="text-[#6B7280] font-normal">
                      (norm: {hypothesis.telemetrySpanEvidence.normalBaselineMs}ms)
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Affected Kubernetes Pods */}
            <div>
              <div className="flex items-center justify-between text-[11px] font-mono text-[#9CA3AF] mb-1.5">
                <span>Affected Kubernetes Pods ({hypothesis.affectedPods.length})</span>
                <span className="text-[#EF4444]">100% Saturated</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
                {hypothesis.affectedPods.slice(0, 4).map((pod) => (
                  <div
                    key={pod}
                    className="bg-[#080C13] border border-[#1F2937] px-2 py-1 text-[#C2C6D6] rounded flex items-center justify-between"
                  >
                    <span className="truncate">{pod}</span>
                    <span className="w-1.5 h-1.5 bg-[#EF4444] rounded-none shrink-0 ml-1" />
                  </div>
                ))}
                {hypothesis.affectedPods.length > 4 && (
                  <div className="col-span-2 text-[10px] font-mono text-[#6B7280] text-center pt-0.5">
                    + {hypothesis.affectedPods.length - 4} additional worker pods queued
                  </div>
                )}
              </div>
            </div>

            {/* Operational Risks */}
            <div>
              <div className="text-[11px] font-mono text-[#9CA3AF] uppercase mb-1">
                Known Operational Trade-offs
              </div>
              <ul className="space-y-1 text-xs text-[#9CA3AF]">
                {hypothesis.risks.map((risk, idx) => (
                  <li key={idx} className="flex items-start gap-1.5 text-[11px]">
                    <span className="text-[#F59E0B] shrink-0">›</span>
                    <span>{risk}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="pt-2 text-[11px] font-mono text-[#6B7280]">
            Autonomous Hypothesis Engine • Grounded in live cluster telemetry
          </div>
        </div>

        {/* Right Panel: Action Plan & Dry-Run Diff (Col 6-12) */}
        <div className="lg:col-span-7 p-4 bg-[#0B0F17] flex flex-col justify-between space-y-4">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-[#3B82F6]" />
                <span className="text-xs font-mono font-medium text-[#DCE2F3]">
                  Proposed Dry-Run Remediation Diff
                </span>
              </div>
              <button
                onClick={copyCommand}
                className="flex items-center gap-1 text-[11px] font-mono text-[#9CA3AF] hover:text-[#FFFFFF] transition-colors cursor-pointer"
                title="Copy terminal command"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-[#10B981]" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy CLI'}</span>
              </button>
            </div>

            {/* Command bar */}
            <div className="bg-[#080C13] border border-[#374151] rounded p-2 text-xs font-mono text-[#60A5FA] overflow-x-auto flex items-center justify-between gap-2">
              <span className="truncate">$ {hypothesis.dryRunDiff.command}</span>
            </div>

            {/* Terminal Diff Viewer */}
            <div className="bg-[#080C13] border border-[#374151] rounded overflow-hidden">
              <div className="grid grid-cols-2 border-b border-[#1F2937] bg-[#111827] px-3 py-1 text-[11px] font-mono text-[#9CA3AF]">
                <div className="flex items-center gap-1.5 text-[#EF4444]">
                  <span>- Current Configuration (Crashing)</span>
                </div>
                <div className="flex items-center gap-1.5 text-[#10B981] border-l border-[#1F2937] pl-3">
                  <span>+ Proposed Patch (Target)</span>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#1F2937] p-2 text-[11px] font-mono leading-relaxed overflow-x-auto">
                <pre className="text-[#F87171] p-1.5 selection:bg-red-950">
                  {hypothesis.dryRunDiff.oldConfig}
                </pre>
                <pre className="text-[#34D399] p-1.5 selection:bg-emerald-950">
                  {hypothesis.dryRunDiff.newConfig}
                </pre>
              </div>
            </div>

            {/* Parameter Toggles */}
            <div>
              <div className="text-[11px] font-mono text-[#9CA3AF] uppercase mb-2">
                Execution Parameter Safeguards
              </div>
              <div className="space-y-2">
                {hypothesis.dryRunDiff.flags.map((flag) => {
                  const isChecked = flags[flag.name] ?? false;
                  return (
                    <label
                      key={flag.name}
                      className="flex items-start gap-2.5 p-2 bg-[#111827] border border-[#1F2937] rounded hover:border-[#374151] cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleFlag(flag.name)}
                        className="mt-0.5 rounded-[2px] border-[#4B5563] bg-[#080C13] text-[#3B82F6] focus:ring-[#3B82F6] focus:ring-offset-0 cursor-pointer"
                      />
                      <div className="text-xs">
                        <div className="flex items-center gap-2 font-mono">
                          <span className="font-semibold text-[#DCE2F3]">{flag.name}</span>
                          <span className="text-[10px] text-[#60A5FA] bg-[#19202B] px-1 py-0.2 rounded">
                            {flag.value}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#9CA3AF] mt-0.5 leading-snug">
                          {flag.description}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Action Footer */}
          <div className="pt-3 border-t border-[#1F2937]">
            {rejecting ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-mono text-[#EF4444]">
                  <span>Reject AI Hypothesis</span>
                  <button onClick={() => setRejecting(false)} className="text-[#9CA3AF] hover:text-white">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Enter rejection rationale for audit log..."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full bg-[#080C13] border border-[#374151] focus:border-[#3B82F6] text-[#F9FAFB] text-xs font-mono p-2 rounded outline-none"
                />
                <div className="flex items-center justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setRejecting(false)}>
                    Cancel
                  </Button>
                  <Button variant="destructive" size="sm" onClick={handleRejectSubmit}>
                    Confirm Rejection
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-xs text-[#9CA3AF]">
                  <ShieldCheck className="w-4 h-4 text-[#34D399]" />
                  <span>Requires SRE Commander Authorization</span>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => setRejecting(true)}
                    disabled={isExecuting}
                  >
                    Reject Hypothesis
                  </Button>

                  <Button
                    variant="primary"
                    size="md"
                    onClick={handleApprove}
                    disabled={isExecuting}
                    icon={isExecuting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : undefined}
                  >
                    {isExecuting ? 'Executing Live Patch...' : 'Approve & Execute Patch'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
