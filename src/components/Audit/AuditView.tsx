import React, { useState } from 'react';
import { AuditEvent, Incident } from '../../types/incident';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import {
  FileText,
  ShieldCheck,
  Bot,
  User,
  CheckCircle2,
  Copy,
  Check,
  Download,
  AlertCircle,
  HelpCircle,
  Workflow,
} from 'lucide-react';

interface AuditViewProps {
  events: AuditEvent[];
  activeIncident: Incident;
}

export const AuditView: React.FC<AuditViewProps> = ({ events, activeIncident }) => {
  const [copied, setCopied] = useState(false);

  const retrospectiveMarkdown = `# Incident Retrospective: ${activeIncident.code} — ${activeIncident.title}

**Severity**: ${activeIncident.severity}  
**Status**: Mitigated / Resolved  
**Incident Commander**: ${activeIncident.commander.name} (${activeIncident.commander.role})  
**Service Affected**: ${activeIncident.service}  
**Duration**: ${activeIncident.durationMinutes} minutes  
**Blast Radius**: ${activeIncident.blastRadius}  
${activeIncident.lastApprovalResult ? `**Automated Workflow Status**: ${activeIncident.lastApprovalResult.workflow_status}  
**Workflow Approval ID**: \`${activeIncident.lastApprovalResult.approval_id}\`  
**Execution Timestamp**: ${activeIncident.lastApprovalResult.execution_timestamp}  
**Workflow Result Message**: ${activeIncident.lastApprovalResult.result_message}  ` : ''}

---

## Executive Summary
At 10:19 UTC, monitoring detected that the \`auth-gateway-prod\` service p99 latency spiked from a normal baseline of 42ms to over 1,840ms, resulting in 14.8% of login checkouts returning HTTP 504 Gateway Timeout. The IncidentPilot autonomous copilot formulated an actionable hypothesis identifying PostgreSQL HikariCP connection pool starvation. Staff SRE commander authorized a dry-run kubectl patch to expand pool size to 60 with asynchronous revocation caching, restoring nominal SLOs within 45 seconds of canary rollout.

---

## Root Cause Analysis (5 Whys)
1. **Why did users experience 504 Gateway Timeouts?**  
   The \`auth-gateway-prod\` pods queued client requests for up to 1,800ms before returning upstream timeout errors.
2. **Why were requests queued?**  
   All HikariCP connection pool slots (20/20) were perpetually locked across all replica pods.
3. **Why were all connection slots exhausted?**  
   Every incoming bearer token refresh executed a synchronous database query to verify revocation status against \`oauth_tokens\`.
4. **Why did the revocation queries take so long to complete?**  
   Canary release v2.14.8 omitted a composite database index on \`(client_id, revoked_at)\`, causing PostgreSQL to execute full sequential table scans over 400k token records.
5. **Why was this missed before production?**  
   Staging database lacked sufficient token volume to expose sequential scan overhead during pre-merge synthetic load tests.

---

## Incident Remediation Timeline
${events
  .map(
    (ev) => `- **[${ev.timestamp}]** (${ev.actorType}): ${ev.action}\n  *${ev.details}*`
  )
  .join('\n')}

---

## Preventative Action Items
- [x] **ACT-101**: Expand HikariCP default ceiling to 60 with active connection harvesting (Mitigated).
- [ ] **ACT-102**: Deploy migration adding \`CREATE INDEX CONCURRENTLY idx_oauth_tokens_revoked\` to \`auth_tokens_db\`.
- [ ] **ACT-103**: Populate staging database with representative 500k synthetic active token records in CI/CD pipeline.
- [ ] **ACT-104**: Configure Prometheus alert on HikariCP pool saturation exceeding 75% for > 60 seconds.
`;

  const copyMarkdown = () => {
    navigator.clipboard.writeText(retrospectiveMarkdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadReport = () => {
    const blob = new Blob([retrospectiveMarkdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IncidentPilot-PostMortem-${activeIncident.code}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#111827] border border-[#374151] rounded-lg p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#3B82F6]" />
            <h2 className="text-base font-semibold text-[#F9FAFB] tracking-tight">
              Post-Mortem & Autonomous Remediation Audit Trail
            </h2>
          </div>
          <p className="text-xs text-[#9CA3AF] mt-1">
            Cryptographically timestamped record of autonomous AI diagnostic hypotheses, human checkpoints, and execution artifacts for {activeIncident.code}.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={copyMarkdown}
            icon={copied ? <Check className="w-3.5 h-3.5 text-[#10B981]" /> : <Copy className="w-3.5 h-3.5" />}
          >
            {copied ? 'Copied' : 'Copy Post-Mortem'}
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={downloadReport}
            icon={<Download className="w-3.5 h-3.5" />}
          >
            Export .MD Runbook
          </Button>
        </div>
      </div>

      {/* Audit Event Timeline */}
      <div className="bg-[#111827] border border-[#374151] rounded-lg overflow-hidden">
        <div className="bg-[#151C27] border-b border-[#374151] px-4 py-3 flex items-center justify-between">
          <span className="text-xs font-mono font-semibold text-[#DCE2F3]">
            IMMUTABLE EVENT CHRONOLOGY
          </span>
          <span className="text-[11px] font-mono text-[#6B7280]">
            {events.length} verifiable audit records
          </span>
        </div>

        <div className="p-4 sm:p-5 space-y-4 bg-[#0B0F17]">
          {events.map((ev, idx) => {
            const isAi = ev.actorType === 'AI_AGENT';
            const isHuman = ev.actorType === 'HUMAN_COMMANDER';
            const isN8n = ev.actorType === 'N8N_WORKFLOW';

            return (
              <div
                key={ev.id}
                className="bg-[#111827] border border-[#1F2937] hover:border-[#374151] rounded p-3.5 transition-colors font-mono text-xs space-y-1.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {isN8n ? (
                      <span className="w-6 h-6 rounded bg-[#4EDEA3]/10 border border-[#4EDEA3]/40 flex items-center justify-center text-[#4EDEA3]">
                        <Workflow className="w-3.5 h-3.5" />
                      </span>
                    ) : isAi ? (
                      <span className="w-6 h-6 rounded bg-[#3B82F6]/10 border border-[#3B82F6]/40 flex items-center justify-center text-[#60A5FA]">
                        <Bot className="w-3.5 h-3.5" />
                      </span>
                    ) : isHuman ? (
                      <span className="w-6 h-6 rounded bg-[#10B981]/10 border border-[#10B981]/40 flex items-center justify-center text-[#34D399]">
                        <User className="w-3.5 h-3.5" />
                      </span>
                    ) : (
                      <span className="w-6 h-6 rounded bg-[#F59E0B]/10 border border-[#F59E0B]/40 flex items-center justify-center text-[#FBBF24]">
                        <AlertCircle className="w-3.5 h-3.5" />
                      </span>
                    )}

                    <span className="font-semibold text-[#F9FAFB]">{ev.action}</span>
                  </div>

                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-[#9CA3AF] bg-[#080C13] border border-[#1F2937] px-2 py-0.5 rounded">
                      {ev.actorName}
                    </span>
                    <span className="text-[#6B7280] tabular-nums">{ev.timestamp}</span>
                  </div>
                </div>

                <p className="text-[#C2C6D6] font-sans text-xs pl-8 leading-relaxed">
                  {ev.details}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* 5 Whys & Retrospective Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 5 Whys */}
        <div className="lg:col-span-6 bg-[#111827] border border-[#374151] rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-[#1F2937]">
            <HelpCircle className="w-4 h-4 text-[#F59E0B]" />
            <h3 className="text-sm font-semibold text-[#F9FAFB]">
              Automated 5-Whys Diagnostic Chain
            </h3>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div className="p-3 bg-[#080C13] border border-[#1F2937] rounded space-y-1">
              <span className="text-[#60A5FA] font-semibold text-[11px]">1. Immediate Symptom</span>
              <p className="font-sans text-xs text-[#C2C6D6]">
                Auth token validation queue reached 1,800ms timeouts causing 14.8% checkout errors.
              </p>
            </div>

            <div className="p-3 bg-[#080C13] border border-[#1F2937] rounded space-y-1">
              <span className="text-[#60A5FA] font-semibold text-[11px]">2. Direct Cause</span>
              <p className="font-sans text-xs text-[#C2C6D6]">
                All HikariCP PostgreSQL connection pool slots (20/20) saturated across replica pods.
              </p>
            </div>

            <div className="p-3 bg-[#080C13] border border-[#1F2937] rounded space-y-1">
              <span className="text-[#60A5FA] font-semibold text-[11px]">3. Mechanism</span>
              <p className="font-sans text-xs text-[#C2C6D6]">
                Synchronous token revocation check added in v2.14.8 executed on every bearer refresh.
              </p>
            </div>

            <div className="p-3 bg-[#080C13] border border-[#1F2937] rounded space-y-1">
              <span className="text-[#60A5FA] font-semibold text-[11px]">4. Architecture Flaw</span>
              <p className="font-sans text-xs text-[#C2C6D6]">
                Missing index on (client_id, revoked_at) forced full table sequential scans in Postgres.
              </p>
            </div>

            <div className="p-3 bg-[#080C13] border border-[#1F2937] rounded space-y-1">
              <span className="text-[#34D399] font-semibold text-[11px]">5. Systemic Gap</span>
              <p className="font-sans text-xs text-[#C2C6D6]">
                Synthetic pre-deploy load testing suite lacked realistic 400k+ token table volume.
              </p>
            </div>
          </div>
        </div>

        {/* Preventative Action Items */}
        <div className="lg:col-span-6 bg-[#111827] border border-[#374151] rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-[#1F2937]">
            <ShieldCheck className="w-4 h-4 text-[#10B981]" />
            <h3 className="text-sm font-semibold text-[#F9FAFB]">
              Remediation Action Items & Runbooks
            </h3>
          </div>

          <div className="space-y-2.5 font-mono text-xs">
            <div className="p-3 bg-[#080C13] border border-[#10B981]/40 rounded flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#34D399] shrink-0 mt-0.5" />
              <div>
                <span className="text-[#34D399] font-semibold">ACT-101 [COMPLETED]</span>
                <p className="font-sans text-xs text-[#C2C6D6] mt-0.5">
                  Applied kubectl patch expanding pool ceiling to 60 with 15s idle harvesting.
                </p>
              </div>
            </div>

            <div className="p-3 bg-[#080C13] border border-[#1F2937] rounded flex items-start gap-2.5">
              <span className="w-4 h-4 rounded-none border border-[#424754] inline-block shrink-0 mt-0.5" />
              <div>
                <span className="text-[#DCE2F3] font-semibold">ACT-102 [QUEUED]</span>
                <p className="font-sans text-xs text-[#C2C6D6] mt-0.5">
                  Deploy migration: CREATE INDEX CONCURRENTLY idx_oauth_tokens_revoked.
                </p>
              </div>
            </div>

            <div className="p-3 bg-[#080C13] border border-[#1F2937] rounded flex items-start gap-2.5">
              <span className="w-4 h-4 rounded-none border border-[#424754] inline-block shrink-0 mt-0.5" />
              <div>
                <span className="text-[#DCE2F3] font-semibold">ACT-103 [QUEUED]</span>
                <p className="font-sans text-xs text-[#C2C6D6] mt-0.5">
                  Seed staging environment with 500k tokens in performance test matrix.
                </p>
              </div>
            </div>

            <div className="p-3 bg-[#080C13] border border-[#1F2937] rounded flex items-start gap-2.5">
              <span className="w-4 h-4 rounded-none border border-[#424754] inline-block shrink-0 mt-0.5" />
              <div>
                <span className="text-[#DCE2F3] font-semibold">ACT-104 [QUEUED]</span>
                <p className="font-sans text-xs text-[#C2C6D6] mt-0.5">
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
