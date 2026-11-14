import React from 'react';
import { AuditEvent, Incident } from '../../types/incident';
import {
  FileText,
  ShieldCheck,
  Bot,
  User,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Workflow,
  MessageSquare,
} from 'lucide-react';

interface AuditViewProps {
  events: AuditEvent[];
  activeIncident: Incident;
  onOpenIncidentDashboard: () => void;
}

export const AuditView: React.FC<AuditViewProps> = ({
  events,
  activeIncident,
  onOpenIncidentDashboard,
}) => {
  return (
    <div className="space-y-6">
      {/* Header — keeps ONLY the vertically centered Open Incident Dashboard button */}
      <div className="neu-surface rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <FileText className="w-5 h-5 text-[#3B82F6] dark:text-[#60A5FA] shrink-0" />
            <h2 className="text-base font-semibold text-[var(--ip-text)] tracking-tight">
              Post-Mortem & Autonomous Remediation Audit Trail
            </h2>
          </div>
          <p className="text-xs text-[var(--ip-text-secondary)] mt-1.5 leading-relaxed">
            Cryptographically timestamped record of autonomous AI diagnostic hypotheses, human checkpoints, and execution artifacts for {activeIncident.code}.
          </p>
        </div>

        <div className="flex items-center shrink-0 sm:self-center">
          <button
            type="button"
            onClick={onOpenIncidentDashboard}
            data-testid="open-incident-dashboard-btn"
            className="neu-pill inline-flex items-center justify-center gap-2.5 px-5 py-2.5 text-xs font-semibold rounded-xl text-[var(--ip-text)] border border-[#3B82F6]/45 hover:border-[#3B82F6]/80 transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B82F6]/60"
          >
            <span aria-hidden="true">🚀</span>
            <span>Open Incident Dashboard</span>
          </button>
        </div>
      </div>

      {/* Audit Event Timeline */}
      <div className="neu-surface rounded-2xl overflow-hidden">
        <div className="border-b border-[var(--ip-border)] px-5 py-3.5 flex items-center justify-between">
          <span className="text-xs font-mono font-semibold text-[var(--ip-text)] tracking-wide">
            IMMUTABLE EVENT CHRONOLOGY
          </span>
          <span className="text-[11px] font-mono text-[var(--ip-text-muted)]">
            {events.length} verifiable audit records
          </span>
        </div>

        <div className="p-4 sm:p-5 space-y-3.5 bg-[var(--ip-inset)]/60">
          {events.map((ev) => {
            const isAi = ev.actorType === 'AI_AGENT' || ev.actorType === 'CLAUDE_AGENT';
            const isHuman = ev.actorType === 'HUMAN_COMMANDER';
            const isN8n = ev.actorType === 'N8N_WORKFLOW' || ev.actorType === 'NODEJS_ORCHESTRATOR';
            const isSlack = ev.actorType === 'SLACK_NOTIFICATION' || ev.actorType === 'SLACK_INTERACTION';

            return (
              <div
                key={ev.id}
                className="neu-surface rounded-xl p-4 transition-colors font-mono text-xs space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {isSlack ? (
                      <span className="w-7 h-7 rounded-lg bg-[#8B5CF6]/12 border border-[#8B5CF6]/30 flex items-center justify-center text-[#7C3AED] dark:text-[#A78BFA] shrink-0">
                        <MessageSquare className="w-3.5 h-3.5" />
                      </span>
                    ) : isN8n ? (
                      <span className="w-7 h-7 rounded-lg bg-[#10B981]/12 border border-[#10B981]/30 flex items-center justify-center text-[#047857] dark:text-[#6EE7B7] shrink-0">
                        <Workflow className="w-3.5 h-3.5" />
                      </span>
                    ) : isAi ? (
                      <span className="w-7 h-7 rounded-lg bg-[#3B82F6]/12 border border-[#3B82F6]/30 flex items-center justify-center text-[#2563EB] dark:text-[#93C5FD] shrink-0">
                        <Bot className="w-3.5 h-3.5" />
                      </span>
                    ) : isHuman ? (
                      <span className="w-7 h-7 rounded-lg bg-[#10B981]/12 border border-[#10B981]/30 flex items-center justify-center text-[#047857] dark:text-[#6EE7B7] shrink-0">
                        <User className="w-3.5 h-3.5" />
                      </span>
                    ) : (
                      <span className="w-7 h-7 rounded-lg bg-[#F59E0B]/12 border border-[#F59E0B]/30 flex items-center justify-center text-[#B45309] dark:text-[#FCD34D] shrink-0">
                        <AlertCircle className="w-3.5 h-3.5" />
                      </span>
                    )}

                    <span className="font-semibold text-[var(--ip-text)] truncate">{ev.action}</span>
                  </div>

                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-[var(--ip-text-secondary)] neu-inset px-2.5 py-0.5 rounded-md">
                      {ev.actorName}
                    </span>
                    <span className="text-[var(--ip-text-muted)] tabular-nums">{ev.timestamp}</span>
                  </div>
                </div>

                <p className="text-[var(--ip-text-secondary)] font-sans text-xs sm:pl-9 leading-relaxed">
                  {ev.details}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* 5 Whys & Action Items */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 min-w-0 neu-surface rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2.5 pb-2.5 border-b border-[var(--ip-border)]">
            <HelpCircle className="w-4 h-4 text-[#F59E0B] shrink-0" />
            <h3 className="text-sm font-semibold text-[var(--ip-text)]">
              Automated 5-Whys Diagnostic Chain
            </h3>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div className="p-3.5 neu-inset rounded-xl space-y-1">
              <span className="text-[#2563EB] dark:text-[#93C5FD] font-semibold text-[11px]">1. Immediate Symptom</span>
              <p className="font-sans text-xs text-[var(--ip-text-secondary)]">
                Auth token validation queue reached 1,800ms timeouts causing 14.8% checkout errors.
              </p>
            </div>

            <div className="p-3.5 neu-inset rounded-xl space-y-1">
              <span className="text-[#2563EB] dark:text-[#93C5FD] font-semibold text-[11px]">2. Direct Cause</span>
              <p className="font-sans text-xs text-[var(--ip-text-secondary)]">
                All HikariCP PostgreSQL connection pool slots (20/20) saturated across replica pods.
              </p>
            </div>

            <div className="p-3.5 neu-inset rounded-xl space-y-1">
              <span className="text-[#2563EB] dark:text-[#93C5FD] font-semibold text-[11px]">3. Mechanism</span>
              <p className="font-sans text-xs text-[var(--ip-text-secondary)]">
                Synchronous token revocation check added in v2.14.8 executed on every bearer refresh.
              </p>
            </div>

            <div className="p-3.5 neu-inset rounded-xl space-y-1">
              <span className="text-[#2563EB] dark:text-[#93C5FD] font-semibold text-[11px]">4. Architecture Flaw</span>
              <p className="font-sans text-xs text-[var(--ip-text-secondary)]">
                Missing index on (client_id, revoked_at) forced full table sequential scans in Postgres.
              </p>
            </div>

            <div className="p-3.5 neu-inset rounded-xl space-y-1">
              <span className="text-[#047857] dark:text-[#6EE7B7] font-semibold text-[11px]">5. Systemic Gap</span>
              <p className="font-sans text-xs text-[var(--ip-text-secondary)]">
                Synthetic pre-deploy load testing suite lacked realistic 400k+ token table volume.
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-6 min-w-0 neu-surface rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2.5 pb-2.5 border-b border-[var(--ip-border)]">
            <ShieldCheck className="w-4 h-4 text-[#10B981] shrink-0" />
            <h3 className="text-sm font-semibold text-[var(--ip-text)]">
              Remediation Action Items & Runbooks
            </h3>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div className="p-3.5 neu-inset border-[#10B981]/30 rounded-xl flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#047857] dark:text-[#6EE7B7] shrink-0 mt-0.5" />
              <div>
                <span className="text-[#047857] dark:text-[#6EE7B7] font-semibold">ACT-101 [COMPLETED]</span>
                <p className="font-sans text-xs text-[var(--ip-text-secondary)] mt-1">
                  Applied kubectl patch expanding pool ceiling to 60 with 15s idle harvesting.
                </p>
              </div>
            </div>

            <div className="p-3.5 neu-inset rounded-xl flex items-start gap-2.5">
              <span className="w-4 h-4 rounded-md border border-[var(--ip-border-strong)] inline-block shrink-0 mt-0.5" />
              <div>
                <span className="text-[var(--ip-text)] font-semibold">ACT-102 [QUEUED]</span>
                <p className="font-sans text-xs text-[var(--ip-text-secondary)] mt-1">
                  Deploy migration: CREATE INDEX CONCURRENTLY idx_oauth_tokens_revoked.
                </p>
              </div>
            </div>

            <div className="p-3.5 neu-inset rounded-xl flex items-start gap-2.5">
              <span className="w-4 h-4 rounded-md border border-[var(--ip-border-strong)] inline-block shrink-0 mt-0.5" />
              <div>
                <span className="text-[var(--ip-text)] font-semibold">ACT-103 [QUEUED]</span>
                <p className="font-sans text-xs text-[var(--ip-text-secondary)] mt-1">
                  Seed staging environment with 500k tokens in performance test matrix.
                </p>
              </div>
            </div>

            <div className="p-3.5 neu-inset rounded-xl flex items-start gap-2.5">
              <span className="w-4 h-4 rounded-md border border-[var(--ip-border-strong)] inline-block shrink-0 mt-0.5" />
              <div>
                <span className="text-[var(--ip-text)] font-semibold">ACT-104 [QUEUED]</span>
                <p className="font-sans text-xs text-[var(--ip-text-secondary)] mt-1">
                  Add Datadog threshold alert when HikariCP active/max ratio &gt; 75% for 60s.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
