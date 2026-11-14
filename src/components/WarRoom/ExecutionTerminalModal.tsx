import React, { useEffect, useState } from 'react';
import { Incident, AiHypothesis, N8nWorkflowResponse, AuditEvent } from '../../types/incident';
import { Button } from '../ui/Button';
import {
  Terminal,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowRight,
  ShieldCheck,
  ShieldAlert,
  Clock,
  RotateCcw,
  BookOpen,
} from 'lucide-react';

interface ExecutionTerminalModalProps {
  isOpen: boolean;
  onComplete: (result: N8nWorkflowResponse) => void;
  onClose: () => void;
  flags: { [key: string]: boolean };
  incident: Incident;
  hypothesis: AiHypothesis;
  onOpenSetupGuide?: () => void;
  onAuditEventRecorded?: (event: AuditEvent) => void;
}

type ExecutionPhase = 'authorizing' | 'dispatching' | 'success' | 'rejected' | 'timeout' | 'error' | 'not_configured';
type WorkflowEngine = 'nodejs' | 'n8n';

interface TerminalLine {
  timestamp: string;
  type: 'info' | 'success' | 'error' | 'warn' | 'dim';
  text: string;
}

export const ExecutionTerminalModal: React.FC<ExecutionTerminalModalProps> = ({
  isOpen,
  onComplete,
  onClose,
  flags,
  incident,
  hypothesis,
  onOpenSetupGuide,
  onAuditEventRecorded,
}) => {
  const [engine, setEngine] = useState<WorkflowEngine>('nodejs');
  const [phase, setPhase] = useState<ExecutionPhase>('authorizing');
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [n8nResult, setN8nResult] = useState<N8nWorkflowResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentApprovalId, setCurrentApprovalId] = useState<string>('');

  const addLine = (text: string, type: TerminalLine['type'] = 'info') => {
    const time = new Date().toTimeString().split(' ')[0] + '.' + String(new Date().getMilliseconds()).padStart(3, '0');
    setLines((prev) => [...prev, { timestamp: time, type, text }]);
  };

  const dispatchNodejsWorkflow = async (forceSimulationFalse = false) => {
    const incidentId = incident.code || incident.id;
    setCurrentApprovalId('');
    setPhase('dispatching');
    setErrorMessage(null);
    setN8nResult(null);

    const tsNow = new Date().toTimeString().split(' ')[0];
    setLines([
      {
        timestamp: tsNow,
        type: 'info',
        text: `[AUTH] Incident Commander authorization signed: ${incident.commander.name} (${incident.commander.role})`,
      },
      {
        timestamp: tsNow,
        type: forceSimulationFalse ? 'warn' : 'info',
        text: `[POLICY] Checking safety mode: simulation_mode=${forceSimulationFalse ? 'false (Testing Rejection)' : 'true (Simulated Remediation)'}`,
      },
      {
        timestamp: tsNow,
        type: 'dim',
        text: `[ORCHESTRATOR] POST /api/workflows/incidents/start -> incident: ${incidentId}, service: ${incident.service}`,
      },
    ]);

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
            p99LatencyMs: incident.p99LatencyMs,
            errorRatePercent: incident.errorRatePercent,
          },
          simulation_mode: !forceSimulationFalse,
          notify_slack: true,
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
          addLine(
            `[ORCHESTRATOR] Active workflow ${existing.workflow_id} awaiting approval (${approvalId}). Proceeding with bound decision...`,
            'info'
          );
        } else {
          setPhase('rejected');
          setErrorMessage(startData.error);
          addLine(`[HTTP 409 DUPLICATE_INCIDENT_WORKFLOW] ${startData.error}`, 'error');
          return;
        }
      } else if (!startRes.ok) {
        if (startRes.status === 400 || startRes.status === 403) {
          setPhase('rejected');
          setErrorMessage(startData.error || 'Workflow rejected by orchestrator safety policy.');
          addLine(`[HTTP ${startRes.status}] ${startData.error || 'Validation error'}`, 'error');
        } else {
          setPhase('error');
          setErrorMessage(startData.error || `Workflow start failed (HTTP ${startRes.status})`);
          addLine(`[HTTP ${startRes.status}] ${startData.error || 'Workflow error'}`, 'error');
        }
        return;
      } else {
        addLine(
          `[CLAUDE] Diagnosis completed (source=${startData.workflow?.diagnosis_source}, confidence=${startData.workflow?.diagnosis?.confidence ?? 'N/A'}%)`,
          'info'
        );
        addLine(
          `[SLACK] Notification status: ${startData.workflow?.slack_status || 'unknown'}`,
          startData.workflow?.slack_notified ? 'success' : 'dim'
        );
        addLine(
          `[APPROVAL] Issued bound single-use approval ${approvalId} for action="${proposedAction}"`,
          'info'
        );
      }

      setCurrentApprovalId(approvalId);
      addLine(
        `[DECISION] POST /api/workflows/incidents/${incidentId}/decision -> action: ${proposedAction}`,
        'dim'
      );

      const decisionRes = await fetch(`/api/workflows/incidents/${encodeURIComponent(incidentId)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_id: approvalId,
          action: proposedAction,
          decision: 'approve',
          simulation_mode: !forceSimulationFalse,
          human_approval: {
            approved: true,
            commander_name: incident.commander.name,
            commander_id: 's-chen-882',
            commander_role: incident.commander.role,
            timestamp: new Date().toISOString(),
          },
        }),
      });

      const decisionData = await decisionRes.json();

      if (decisionRes.status === 200 && decisionData.success) {
        const resultPayload: N8nWorkflowResponse = {
          success: true,
          incident_id: incidentId,
          approval_id: decisionData.approval_id,
          workflow_status: decisionData.workflow_status,
          result_message: decisionData.result_message,
          execution_timestamp: decisionData.execution_timestamp,
          raw: {
            engine: 'nodejs_express_native',
            workflow: decisionData.workflow,
          },
        };
        setPhase('success');
        setN8nResult(resultPayload);
        if (decisionData.audit_event && onAuditEventRecorded) {
          onAuditEventRecorded(decisionData.audit_event);
        }
        addLine(`[HTTP 200] Node.js workflow execution verified (simulation_mode=true).`, 'success');
        addLine(`[ORCHESTRATOR] workflow_status: "${decisionData.workflow_status}"`, 'success');
        addLine(`[ORCHESTRATOR] result_message: "${decisionData.result_message}"`, 'success');
        addLine(`[ORCHESTRATOR] execution_timestamp: ${decisionData.execution_timestamp}`, 'info');
      } else if (
        decisionRes.status === 400 ||
        decisionRes.status === 403 ||
        decisionRes.status === 409 ||
        decisionRes.status === 410
      ) {
        setPhase('rejected');
        setErrorMessage(decisionData.error || 'Decision rejected by Node.js orchestrator.');
        addLine(`[HTTP ${decisionRes.status}] Decision rejected: ${decisionData.error || 'Policy violation'}`, 'error');
      } else {
        setPhase('error');
        setErrorMessage(decisionData.error || `Server returned HTTP ${decisionRes.status}`);
        addLine(`[HTTP ${decisionRes.status}] ${decisionData.error || 'Unexpected error'}`, 'error');
      }
    } catch (err: any) {
      setPhase('error');
      const msg = err.message || 'Failed to reach Node.js orchestrator';
      setErrorMessage(msg);
      addLine(`[NETWORK ERROR] ${msg}`, 'error');
    }
  };

  const dispatchLegacyN8n = async (forceSimulationFalse = false) => {
    const approvalId = `appr-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    setCurrentApprovalId(approvalId);
    setPhase('dispatching');
    setErrorMessage(null);
    setN8nResult(null);

    setLines([
      {
        timestamp: new Date().toTimeString().split(' ')[0],
        type: 'info',
        text: `[AUTH] Incident Commander authorization signed: ${incident.commander.name} (${incident.commander.role})`,
      },
      {
        timestamp: new Date().toTimeString().split(' ')[0],
        type: forceSimulationFalse ? 'warn' : 'info',
        text: `[POLICY] Checking safety mode: simulation_mode=${forceSimulationFalse ? 'false (Testing Rejection)' : 'true (Simulated Remediation)'}`,
      },
      {
        timestamp: new Date().toTimeString().split(' ')[0],
        type: 'dim',
        text: `[DISPATCH] POST /api/approvals/dispatch -> target: ${incident.service}, action: scale_connection_pool_canary`,
      },
    ]);

    try {
      const response = await fetch('/api/approvals/dispatch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          incident_id: incident.code || incident.id,
          approval_id: approvalId,
          action: 'scale_connection_pool_canary',
          approved_action: 'scale_connection_pool_canary',
          simulation_mode: !forceSimulationFalse,
          human_approval: {
            approved: true,
            commander_name: incident.commander.name,
            commander_id: 's-chen-882',
            commander_role: incident.commander.role,
            timestamp: new Date().toISOString(),
          },
          parameters: {
            flags,
            target_service: incident.service,
            command: hypothesis.dryRunDiff.command,
            estimated_duration_sec: hypothesis.estimatedMitigationSeconds,
          },
        }),
      });

      const data = await response.json();

      if (response.status === 200 && data.success) {
        setPhase('success');
        setN8nResult(data);
        addLine(`[HTTP 200] n8n production webhook execution completed successfully.`, 'success');
        addLine(`[N8N PAYLOAD] workflow_status: "${data.workflow_status}"`, 'success');
        addLine(`[N8N PAYLOAD] result_message: "${data.result_message}"`, 'success');
        addLine(`[N8N PAYLOAD] execution_timestamp: ${data.execution_timestamp}`, 'info');
        addLine(`[N8N PAYLOAD] approval_id: ${data.approval_id}`, 'info');
      } else if (response.status === 503 && data.code === 'N8N_WEBHOOK_NOT_CONFIGURED') {
        setPhase('not_configured');
        setErrorMessage(data.error);
        addLine(`[HTTP 503] N8N_WEBHOOK_URL is not configured in server environment.`, 'error');
        addLine(`[ACTION REQUIRED] Configure N8N_WEBHOOK_URL in AI Studio Secrets or server environment.`, 'warn');
      } else if (response.status === 400 || response.status === 403) {
        setPhase('rejected');
        setErrorMessage(data.error || 'Action rejected by server validation or n8n workflow.');
        addLine(`[HTTP ${response.status}] Request rejected: ${data.error || 'Validation error'}`, 'error');
        if (data.details) {
          addLine(`[N8N REJECT DETAILS] ${JSON.stringify(data.details)}`, 'error');
        }
      } else if (response.status === 504) {
        setPhase('timeout');
        setErrorMessage('n8n webhook dispatch timed out after 10 seconds.');
        addLine(`[HTTP 504] Webhook timed out after 10,000ms. Check n8n service connectivity.`, 'error');
      } else {
        setPhase('error');
        setErrorMessage(data.error || `Server returned HTTP ${response.status}`);
        addLine(`[HTTP ${response.status}] ${data.error || 'Unexpected error'}`, 'error');
      }
    } catch (err: any) {
      setPhase('error');
      const msg = err.message || 'Failed to reach backend proxy';
      setErrorMessage(msg);
      addLine(`[NETWORK ERROR] ${msg}`, 'error');
    }
  };

  const dispatchApproval = (forceSimulationFalse = false, targetEngine: WorkflowEngine = engine) => {
    if (targetEngine === 'nodejs') {
      return dispatchNodejsWorkflow(forceSimulationFalse);
    }
    return dispatchLegacyN8n(forceSimulationFalse);
  };

  useEffect(() => {
    if (isOpen) {
      dispatchApproval(false, engine);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="neu-surface rounded-2xl w-full max-w-3xl overflow-hidden flex flex-col">
        {/* Terminal Header */}
        <div className="border-b border-[var(--ip-border)] px-5 py-3.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <Terminal className="w-4 h-4 text-[#3B82F6] dark:text-[#60A5FA] shrink-0" />
            <span className="text-xs font-mono font-semibold text-[var(--ip-text)] truncate">
              {engine === 'nodejs'
                ? 'NODE.JS WORKFLOW ORCHESTRATOR · INCIDENT REMEDIATION'
                : 'N8N LEGACY WEBHOOK DISPATCH · INCIDENT REMEDIATION'}
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono shrink-0">
            {phase === 'dispatching' && (
              <span className="flex items-center gap-1.5 text-[#2563EB] dark:text-[#93C5FD]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {engine === 'nodejs' ? 'EXECUTING WORKFLOW...' : 'DISPATCHING WEBHOOK...'}
              </span>
            )}
            {phase === 'success' && (
              <span className="flex items-center gap-1.5 text-[#047857] dark:text-[#6EE7B7]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                WORKFLOW VERIFIED (HTTP 200)
              </span>
            )}
            {phase === 'rejected' && (
              <span className="flex items-center gap-1.5 text-[#DC2626] dark:text-[#FCA5A5]">
                <ShieldAlert className="w-3.5 h-3.5" />
                ACTION REJECTED
              </span>
            )}
            {phase === 'not_configured' && (
              <span className="flex items-center gap-1.5 text-[#B45309] dark:text-[#FCD34D]">
                <AlertTriangle className="w-3.5 h-3.5" />
                SECRET MISSING
              </span>
            )}
            {phase === 'timeout' && (
              <span className="flex items-center gap-1.5 text-[#DC2626] dark:text-[#FCA5A5]">
                <Clock className="w-3.5 h-3.5" />
                TIMED OUT (10s)
              </span>
            )}
            {phase === 'error' && (
              <span className="flex items-center gap-1.5 text-[#DC2626] dark:text-[#FCA5A5]">
                <ShieldAlert className="w-3.5 h-3.5" />
                DISPATCH FAILED
              </span>
            )}
          </div>
        </div>

        {/* Security & Context Sub-bar */}
        <div className="bg-[var(--ip-surface-alt)] border-b border-[var(--ip-border)] px-5 py-2.5 flex flex-wrap items-center justify-between text-[11px] font-mono text-[var(--ip-text-secondary)] gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-[#047857] dark:text-[#6EE7B7]" />
            <span>
              Human Authorized by: <strong className="text-[var(--ip-text)]">{incident.commander.name}</strong>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 neu-inset rounded-lg p-0.5">
              <button
                type="button"
                disabled={phase === 'dispatching'}
                onClick={() => {
                  setEngine('nodejs');
                  dispatchApproval(false, 'nodejs');
                }}
                className={`px-2 py-0.5 rounded-md text-[10px] cursor-pointer transition-colors ${
                  engine === 'nodejs' ? 'neu-pill text-[var(--ip-text)] font-medium' : 'text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)]'
                }`}
              >
                Node.js Orchestrator
              </button>
              <button
                type="button"
                disabled={phase === 'dispatching'}
                onClick={() => {
                  setEngine('n8n');
                  dispatchApproval(false, 'n8n');
                }}
                className={`px-2 py-0.5 rounded-md text-[10px] cursor-pointer transition-colors ${
                  engine === 'n8n' ? 'neu-pill text-[var(--ip-text)] font-medium' : 'text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)]'
                }`}
              >
                n8n (Legacy)
              </button>
            </div>
            <span>
              Approval ID: <strong className="text-[#2563EB] dark:text-[#93C5FD]">{currentApprovalId || '—'}</strong>
            </span>
            <span className="text-[var(--ip-text-muted)]">·</span>
            <span className="text-[#047857] dark:text-[#6EE7B7]">simulation_mode=true</span>
          </div>
        </div>

        {/* Terminal Output Body */}
        <div className="p-5 bg-[var(--ip-inset)] font-mono text-xs space-y-2 max-h-[340px] min-h-[220px] overflow-y-auto">
          {lines.map((l, idx) => {
            const colorClass =
              l.type === 'success'
                ? 'text-[#047857] dark:text-[#6EE7B7]'
                : l.type === 'error'
                ? 'text-[#DC2626] dark:text-[#FCA5A5]'
                : l.type === 'warn'
                ? 'text-[#B45309] dark:text-[#FCD34D]'
                : l.type === 'dim'
                ? 'text-[var(--ip-text-muted)]'
                : 'text-[var(--ip-text)]';

            return (
              <div key={idx} className="flex items-start gap-2.5 leading-relaxed">
                <span className="text-[var(--ip-text-muted)] text-[10px] tabular-nums shrink-0 pt-0.5">
                  {l.timestamp}
                </span>
                <span className={`${colorClass} break-words`}>{l.text}</span>
              </div>
            );
          })}

          {phase === 'dispatching' && (
            <div className="flex items-center gap-2 text-[#2563EB] dark:text-[#93C5FD] pt-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>
                {engine === 'nodejs'
                  ? 'Executing Node.js incident workflow & safety checks...'
                  : 'Waiting for n8n production workflow HTTP response...'}
              </span>
            </div>
          )}
        </div>

        {/* Result & Guidance Callouts */}
        {phase === 'not_configured' && (
          <div className="bg-[#F59E0B]/10 border-t border-[#F59E0B]/25 p-4 font-mono text-xs text-[#B45309] dark:text-[#FCD34D] flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[#F59E0B] shrink-0 mt-0.5" />
            <div className="space-y-1 flex-1">
              <div className="font-semibold">
                N8N_WEBHOOK_URL Not Configured in Server Environment
              </div>
              <p className="text-[11px] font-sans leading-relaxed">
                The backend safely prevented execution because the server-side environment variable{' '}
                <code className="neu-inset px-1.5 py-0.5 rounded text-[var(--ip-text)]">N8N_WEBHOOK_URL</code> is not set.
                Add it in AI Studio Secrets or switch to the native Node.js Orchestrator above.
              </p>
              {onOpenSetupGuide && (
                <div className="pt-2">
                  <button
                    onClick={onOpenSetupGuide}
                    className="text-xs text-[#2563EB] dark:text-[#93C5FD] underline hover:opacity-80 flex items-center gap-1 cursor-pointer"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    Open N8N Configuration Setup Guide
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {phase === 'rejected' && (
          <div className="bg-[#EF4444]/10 border-t border-[#EF4444]/25 p-4 font-mono text-xs text-[#DC2626] dark:text-[#FCA5A5] flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-[#EF4444] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold">Action Rejection Enforced</div>
              <p className="text-[11px] font-sans leading-relaxed">
                {errorMessage || 'The request was rejected according to the workflow validation rules.'}
              </p>
            </div>
          </div>
        )}

        {phase === 'timeout' && (
          <div className="bg-[#EF4444]/10 border-t border-[#EF4444]/25 p-4 font-mono text-xs text-[#DC2626] dark:text-[#FCA5A5] flex items-start gap-3">
            <Clock className="w-5 h-5 text-[#EF4444] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold">Webhook Timed Out (10s)</div>
              <p className="text-[11px] font-sans leading-relaxed">
                The n8n webhook did not respond within the 10-second timeout window. Verify that your n8n server is online and reachable from the server.
              </p>
            </div>
          </div>
        )}

        {/* Footer with Controls */}
        <div className="border-t border-[var(--ip-border)] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => dispatchApproval(true)}
              disabled={phase === 'dispatching'}
              className="text-[11px] font-mono text-[var(--ip-text-secondary)] hover:text-[#DC2626] dark:hover:text-[#FCA5A5] transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
              title="Test rejection policy: sends simulation_mode=false to verify HTTP 400 rejection"
            >
              <span>Test Rejection (simulation_mode=false)</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {phase !== 'success' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => dispatchApproval(false)}
                disabled={phase === 'dispatching'}
                icon={<RotateCcw className="w-3.5 h-3.5" />}
              >
                Retry Dispatch
              </Button>
            )}

            {phase === 'success' && n8nResult ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => {
                  onComplete(n8nResult);
                  onClose();
                }}
                icon={<ArrowRight className="w-3.5 h-3.5" />}
              >
                Apply Verified Result to Incident
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

