import React, { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Terminal, CheckCircle2, ShieldAlert, Loader2, ArrowRight } from 'lucide-react';

interface ExecutionTerminalModalProps {
  isOpen: boolean;
  onComplete: () => void;
  onClose: () => void;
  flags: { [key: string]: boolean };
}

interface StepLog {
  timestamp: string;
  step: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  detail: string;
}

export const ExecutionTerminalModal: React.FC<ExecutionTerminalModalProps> = ({
  isOpen,
  onComplete,
  onClose,
  flags,
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [logs, setLogs] = useState<StepLog[]>([
    {
      timestamp: '10:41:02.100',
      step: '01. Cluster Invariant & Lease Check',
      status: 'pending',
      detail: 'Acquiring lease on etcd namespace /core-infra/leases/auth-gateway-prod. Lock granted to Sarah Chen (Staff SRE).',
    },
    {
      timestamp: '10:41:04.220',
      step: '02. Strategic Merge Patch Application',
      status: 'pending',
      detail: `Patching Deployment: DB_POOL_MAX_SIZE=60, DB_CONNECTION_TIMEOUT_MS=15000, flags: ${Object.entries(flags)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ')}.`,
    },
    {
      timestamp: '10:41:07.410',
      step: '03. Progressive Rolling Canary Restart',
      status: 'pending',
      detail: 'Rolling 2 canary pods: auth-gw-78b9c-x71q & auth-gw-78b9c-99da. Draining idle connections with 15s grace.',
    },
    {
      timestamp: '10:41:10.980',
      step: '04. Telemetry Latency Verification Probe',
      status: 'pending',
      detail: 'Probing synthetic /v1/oauth2/token/verify endpoints. HTTP 200 observed across 500 samples. p99 latency dropped from 1,840ms to 42ms.',
    },
    {
      timestamp: '10:41:13.150',
      step: '05. Autonomous Incident Status Transition',
      status: 'pending',
      detail: 'Rollout verified safe. Status transitioned to MITIGATED. PagerDuty auto-resolved. War room marked nominal.',
    },
  ]);

  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setCurrentStepIndex(0);
      setFinished(false);
      return;
    }

    const interval = setInterval(() => {
      setCurrentStepIndex((prev) => {
        if (prev < logs.length - 1) {
          return prev + 1;
        } else {
          clearInterval(interval);
          setFinished(true);
          return prev;
        }
      });
    }, 1200);

    return () => clearInterval(interval);
  }, [isOpen, logs.length]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#070e19]/80 backdrop-blur-xs p-4">
      <div className="bg-[#111827] border border-[#374151] rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col">
        {/* Terminal Header */}
        <div className="bg-[#151C27] border-b border-[#374151] px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-[#3B82F6]" />
            <span className="text-xs font-mono font-semibold text-[#DCE2F3]">
              LIVE EXECUTION RUNNER • kubectl strategic patch
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono">
            {finished ? (
              <span className="flex items-center gap-1.5 text-[#34D399]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                EXECUTION COMPLETE
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-[#60A5FA]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                EXECUTING STEP {currentStepIndex + 1}/{logs.length}
              </span>
            )}
          </div>
        </div>

        {/* Terminal Output Body */}
        <div className="p-4 bg-[#080C13] font-mono text-xs space-y-3 max-h-[380px] overflow-y-auto">
          {logs.map((log, idx) => {
            const isDone = idx < currentStepIndex || finished;
            const isCurrent = idx === currentStepIndex && !finished;
            const isPending = idx > currentStepIndex && !finished;

            return (
              <div
                key={log.step}
                className={`p-2.5 rounded border transition-colors ${
                  isCurrent
                    ? 'border-[#3B82F6] bg-[#111827]/70 text-[#F9FAFB]'
                    : isDone
                    ? 'border-[#1F2937] bg-[#111827]/40 text-[#C2C6D6]'
                    : 'border-transparent text-[#6B7280]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-medium">
                    {isDone && <CheckCircle2 className="w-4 h-4 text-[#34D399]" />}
                    {isCurrent && <Loader2 className="w-4 h-4 text-[#3B82F6] animate-spin" />}
                    {isPending && <span className="w-4 h-4 rounded-none border border-[#424754] inline-block" />}
                    <span className={isCurrent ? 'text-[#93C5FD]' : isDone ? 'text-[#DCE2F3]' : ''}>
                      {log.step}
                    </span>
                  </div>
                  <span className="text-[10px] text-[#6B7280] tabular-nums">{log.timestamp}</span>
                </div>
                {(isDone || isCurrent) && (
                  <p className="mt-1.5 text-[11px] text-[#9CA3AF] pl-6 leading-relaxed">
                    {log.detail}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="bg-[#151C27] border-t border-[#374151] px-4 py-3 flex items-center justify-between">
          <div className="text-[11px] font-mono text-[#6B7280]">
            Audit Trail Signed: Commander ID #s-chen-882
          </div>

          <div className="flex items-center gap-2">
            {finished ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => {
                  onComplete();
                  onClose();
                }}
                icon={<ArrowRight className="w-3.5 h-3.5" />}
              >
                Return to Mitigated War Room
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={onClose}>
                Background Runner
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
