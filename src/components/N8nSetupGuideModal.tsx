import React, { useEffect, useState } from 'react';
import { WebhookConfigStatus } from '../types/incident';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import {
  X,
  ShieldCheck,
  Key,
  RefreshCw,
  Copy,
  Check,
} from 'lucide-react';

interface N8nSetupGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const N8nSetupGuideModal: React.FC<N8nSetupGuideModalProps> = ({ isOpen, onClose }) => {
  const [status, setStatus] = useState<WebhookConfigStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);

  const checkStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/webhook/status');
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({
        configured: false,
        simulation_enforced: true,
        env_variable: 'N8N_WEBHOOK_URL',
        message: 'Could not connect to backend status endpoint.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      checkStatus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const samplePayload = `{
  "incident_id": "INC-4892",
  "approval_id": "appr-...",
  "action": "scale_connection_pool_canary",
  "approved_action": "scale_connection_pool_canary",
  "simulation_mode": true,
  "commander": {
    "name": "Sarah Chen",
    "id": "s-chen-882",
    "role": "Staff SRE / Incident Commander"
  },
  "parameters": {
    "flags": { "DRAIN_STALE_CONNECTIONS": true },
    "target_service": "auth-gateway-prod"
  },
  "timestamp": "2026-10-24T21:18:45.000Z"
}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="neu-surface rounded-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="border-b border-[var(--ip-border)] px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Key className="w-4 h-4 text-[#3B82F6] dark:text-[#60A5FA] shrink-0" />
            <span className="text-xs font-mono font-semibold text-[var(--ip-text)] truncate">
              N8N PRODUCTION WEBHOOK CONFIGURATION & SECRETS SETUP
            </span>
          </div>
          <button onClick={onClose} className="text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)] cursor-pointer shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:px-5 bg-[var(--ip-surface-alt)] border-b border-[var(--ip-border)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                status?.configured ? 'bg-[#10B981]' : 'bg-[#F59E0B]'
              }`}
            />
            <div className="text-xs font-mono min-w-0">
              <div className="text-[var(--ip-text)] font-medium flex flex-wrap items-center gap-2">
                Server Environment Variable: <code>N8N_WEBHOOK_URL</code>
                {status?.configured ? (
                  <Badge variant="healthy" showSquare>CONFIGURED & READY</Badge>
                ) : (
                  <Badge variant="warning" showSquare>NOT DETECTED</Badge>
                )}
              </div>
              <div className="text-[11px] text-[var(--ip-text-secondary)] mt-0.5">
                {status?.message || 'Checking status...'}
              </div>
            </div>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={checkStatus}
            disabled={loading}
            icon={<RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 font-mono text-xs">
          <div className="neu-inset rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#2563EB] dark:text-[#93C5FD] font-semibold">1. Configure Server Secret in AI Studio</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText('N8N_WEBHOOK_URL');
                  setCopiedKey(true);
                  setTimeout(() => setCopiedKey(false), 2000);
                }}
                className="text-[11px] text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)] flex items-center gap-1 cursor-pointer shrink-0"
              >
                {copiedKey ? <Check className="w-3 h-3 text-[#10B981]" /> : <Copy className="w-3 h-3" />}
                <span>{copiedKey ? 'Copied' : 'Copy Key Name'}</span>
              </button>
            </div>
            <p className="text-[var(--ip-text-secondary)] font-sans text-xs leading-relaxed">
              Open the <strong>Secrets panel</strong> in the AI Studio interface (or your Cloud Run environment secrets), and add a new secret:
            </p>
            <div className="neu-surface p-3 rounded-lg space-y-1 overflow-x-auto">
              <div><strong className="text-[var(--ip-text-secondary)]">Key:</strong> <code className="text-[#047857] dark:text-[#6EE7B7]">N8N_WEBHOOK_URL</code></div>
              <div><strong className="text-[var(--ip-text-secondary)]">Value:</strong> <code className="text-[#2563EB] dark:text-[#93C5FD]">https://your-n8n-instance.app.n8n.cloud/webhook/incident-approval</code></div>
            </div>
            <p className="text-[11px] text-[var(--ip-text-muted)] font-sans">
              * Note: The URL is never sent or exposed to client browser code. All requests flow through the backend server proxy <code className="text-[var(--ip-text)]">/api/approvals/dispatch</code>.
            </p>
          </div>

          <div className="neu-inset rounded-xl p-4 space-y-2">
            <span className="text-[#2563EB] dark:text-[#93C5FD] font-semibold">2. n8n Production Webhook Node Configuration</span>
            <ul className="text-xs text-[var(--ip-text-secondary)] font-sans space-y-1.5 list-disc list-inside">
              <li><strong>HTTP Method:</strong> <code className="font-mono text-[var(--ip-text)]">POST</code></li>
              <li><strong>Authentication:</strong> Header Auth / None (secure internal backend-to-backend network call).</li>
              <li><strong>Safety Enforcement:</strong> The request must have <code className="font-mono text-[#047857] dark:text-[#6EE7B7]">simulation_mode: true</code>. Any request with <code className="font-mono text-[#DC2626] dark:text-[#FCA5A5]">simulation_mode: false</code> will be rejected with HTTP 400.</li>
              <li>
                <strong>Expected n8n Response:</strong> Use the <em>&quot;Respond to Webhook&quot;</em> node to return HTTP 200 with JSON:
                <div className="neu-surface p-3 rounded-lg font-mono text-[11px] text-[#047857] dark:text-[#6EE7B7] mt-1.5 overflow-x-auto">
                  {`{ "incident_id": "...", "approval_id": "...", "workflow_status": "completed", "result_message": "...", "execution_timestamp": "..." }`}
                </div>
              </li>
            </ul>
          </div>

          <div className="neu-inset rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[#2563EB] dark:text-[#93C5FD] font-semibold">3. Payload Format Dispatched to n8n</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(samplePayload);
                  setCopiedPayload(true);
                  setTimeout(() => setCopiedPayload(false), 2000);
                }}
                className="text-[11px] text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)] flex items-center gap-1 cursor-pointer"
              >
                {copiedPayload ? <Check className="w-3 h-3 text-[#10B981]" /> : <Copy className="w-3 h-3" />}
                <span>{copiedPayload ? 'Copied' : 'Copy Sample'}</span>
              </button>
            </div>
            <pre className="neu-surface rounded-lg p-3 text-[11px] text-[var(--ip-text)] overflow-x-auto">
              {samplePayload}
            </pre>
          </div>
        </div>

        <div className="border-t border-[var(--ip-border)] px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--ip-text-secondary)]">
            <ShieldCheck className="w-3.5 h-3.5 text-[#047857] dark:text-[#6EE7B7]" />
            <span>Server Proxy Pattern Active</span>
          </div>
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
};
