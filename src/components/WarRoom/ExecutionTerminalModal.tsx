import React, { useEffect, useState } from 'react';
import { Incident, AiHypothesis, N8nWorkflowResponse } from '../../types/incident';
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
  ExternalLink,
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
}

type ExecutionPhase = 'authorizing' | 'dispatching' | 'success' | 'rejected' | 'timeout' | 'error' | 'not_configured';

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
}) => {
  const [phase, setPhase] = useState<ExecutionPhase>('authorizing');
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [n8nResult, setN8nResult] = useState<N8nWorkflowResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentApprovalId, setCurrentApprovalId] = useState<string>('');

  const addLine = (text: string, type: TerminalLine['type'] = 'info') => {
    const time = new Date().toTimeString().split(' ')[0] + '.' + String(new Date().getMilliseconds()).padStart(3, '0');
    setLines((prev) => [...prev, { timestamp: time, type, text }]);
  };

  const dispatchApproval = async (forceSimulationFalse = false) => {
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

  useEffect(() => {
    if (isOpen) {
      dispatchApproval(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#070e19]/85 backdrop-blur-xs p-4">
      <div className="bg-[#111827] border border-[#374151] rounded-xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col">
        {/* Terminal Header */}
        <div className="bg-[#151C27] border-b border-[#374151] px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-[#3B82F6]" />
            <span className="text-xs font-mono font-semibold text-[#DCE2F3]">
              N8N SECURE WEBHOOK DISPATCH • INCIDENT REMEDIATION
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono">
            {phase === 'dispatching' && (
              <span className="flex items-center gap-1.5 text-[#60A5FA]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                DISPATCHING WEBHOOK...
              </span>
            )}
            {phase === 'success' && (
              <span className="flex items-center gap-1.5 text-[#34D399]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                WORKFLOW VERIFIED (HTTP 200)
              </span>
            )}
            {phase === 'rejected' && (
              <span className="flex items-center gap-1.5 text-[#F87171]">
                <ShieldAlert className="w-3.5 h-3.5" />
                ACTION REJECTED
              </span>
            )}
            {phase === 'not_configured' && (
              <span className="flex items-center gap-1.5 text-[#FBBF24]">
                <AlertTriangle className="w-3.5 h-3.5" />
                SECRET MISSING
              </span>
            )}
            {phase === 'timeout' && (
              <span className="flex items-center gap-1.5 text-[#F87171]">
                <Clock className="w-3.5 h-3.5" />
                TIMED OUT (10s)
              </span>
            )}
            {phase === 'error' && (
              <span className="flex items-center gap-1.5 text-[#F87171]">
                <ShieldAlert className="w-3.5 h-3.5" />
                DISPATCH FAILED
              </span>
            )}
          </div>
        </div>

        {/* Security & Context Sub-bar */}
        <div className="bg-[#0B0F17] border-b border-[#1F2937] px-4 py-2 flex flex-wrap items-center justify-between text-[11px] font-mono text-[#9CA3AF] gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-[#34D399]" />
            <span>Human Authorized by: <strong className="text-[#DCE2F3]">{incident.commander.name}</strong></span>
          </div>
          <div className="flex items-center gap-3">
            <span>Approval ID: <strong className="text-[#60A5FA]">{currentApprovalId || '—'}</strong></span>
            <span>•</span>
            <span className="text-[#34D399]">simulation_mode=true</span>
          </div>
        </div>

        {/* Terminal Output Body */}
        <div className="p-4 bg-[#080C13] font-mono text-xs space-y-2 max-h-[340px] min-h-[220px] overflow-y-auto">
          {lines.map((l, idx) => {
            const colorClass =
              l.type === 'success'
                ? 'text-[#34D399]'
                : l.type === 'error'
                ? 'text-[#F87171]'
                : l.type === 'warn'
                ? 'text-[#FBBF24]'
                : l.type === 'dim'
                ? 'text-[#6B7280]'
                : 'text-[#DCE2F3]';

            return (
              <div key={idx} className="flex items-start gap-2.5 leading-relaxed">
                <span className="text-[#4B5563] text-[10px] tabular-nums shrink-0 pt-0.5">
                  {l.timestamp}
                </span>
                <span className={`${colorClass} break-all`}>{l.text}</span>
              </div>
            );
          })}

          {phase === 'dispatching' && (
            <div className="flex items-center gap-2 text-[#60A5FA] pt-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Waiting for n8n production workflow HTTP response...</span>
            </div>
          )}
        </div>

        {/* Result & Guidance Callouts */}
        {phase === 'not_configured' && (
          <div className="bg-[#1C1814] border-t border-[#F59E0B]/40 p-4 font-mono text-xs text-[#FBBF24] flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[#F59E0B] shrink-0 mt-0.5" />
            <div className="space-y-1 flex-1">
              <div className="font-semibold text-[#FDE68A]">
                N8N_WEBHOOK_URL Not Configured in Server Environment
              </div>
              <p className="text-[11px] text-[#FBBF24]/90 font-sans leading-relaxed">
                The backend safely prevented execution because the server-side environment variable <code className="bg-[#080C13] px-1.5 py-0.5 rounded text-[#DCE2F3]">N8N_WEBHOOK_URL</code> is not set. Add it in AI Studio Secrets or your deployment configuration.
              </p>
              {onOpenSetupGuide && (
                <div className="pt-2">
                  <button
                    onClick={onOpenSetupGuide}
                    className="text-xs text-[#60A5FA] underline hover:text-white flex items-center gap-1 cursor-pointer"
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
          <div className="bg-[#181214] border-t border-[#EF4444]/40 p-4 font-mono text-xs text-[#F87171] flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-[#EF4444] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold text-[#FCA5A5]">Action Rejection Enforced</div>
              <p className="text-[11px] text-[#F87171]/90 font-sans leading-relaxed">
                {errorMessage || 'The request was rejected according to the workflow validation rules.'}
              </p>
            </div>
          </div>
        )}

        {phase === 'timeout' && (
          <div className="bg-[#181214] border-t border-[#EF4444]/40 p-4 font-mono text-xs text-[#F87171] flex items-start gap-3">
            <Clock className="w-5 h-5 text-[#EF4444] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold text-[#FCA5A5]">Webhook Timed Out (10s)</div>
              <p className="text-[11px] text-[#F87171]/90 font-sans leading-relaxed">
                The n8n webhook did not respond within the 10-second timeout window. Verify that your n8n server is online and reachable from the server.
              </p>
            </div>
          </div>
        )}

        {/* Footer with Controls */}
        <div className="bg-[#151C27] border-t border-[#374151] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {/* Test Rejection button to verify requirement: simulation_mode=false is rejected with 400 */}
            <button
              onClick={() => dispatchApproval(true)}
              disabled={phase === 'dispatching'}
              className="text-[11px] font-mono text-[#9CA3AF] hover:text-[#F87171] transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
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
