import React, { useEffect, useState } from 'react';
import { WebhookConfigStatus } from '../types/incident';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import {
  X,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Key,
  Terminal,
  RefreshCw,
  ExternalLink,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#070e19]/80 backdrop-blur-xs p-4">
      <div className="bg-[#111827] border border-[#374151] rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-[#151C27] border-b border-[#374151] px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-[#3B82F6]" />
            <span className="text-xs font-mono font-semibold text-[#DCE2F3]">
              N8N PRODUCTION WEBHOOK CONFIGURATION & SECRETS SETUP
            </span>
          </div>
          <button onClick={onClose} className="text-[#9CA3AF] hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Live Server Check Status Card */}
        <div className="p-4 bg-[#0B0F17] border-b border-[#1F2937] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-3 h-3 rounded-none shrink-0 ${
                status?.configured ? 'bg-[#10B981]' : 'bg-[#F59E0B]'
              }`}
            />
            <div className="text-xs font-mono">
              <div className="text-[#DCE2F3] font-medium flex items-center gap-2">
                Server Environment Variable: <code>N8N_WEBHOOK_URL</code>
                {status?.configured ? (
                  <Badge variant="healthy" showSquare>CONFIGURED & READY</Badge>
                ) : (
                  <Badge variant="warning" showSquare>NOT DETECTED</Badge>
                )}
              </div>
              <div className="text-[11px] text-[#9CA3AF] mt-0.5">
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

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 font-mono text-xs">
          {/* Step 1: Platform Secret Configuration */}
          <div className="bg-[#080C13] border border-[#1F2937] rounded p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[#60A5FA] font-semibold">1. Configure Server Secret in AI Studio</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText('N8N_WEBHOOK_URL');
                  setCopiedKey(true);
                  setTimeout(() => setCopiedKey(false), 2000);
                }}
                className="text-[11px] text-[#9CA3AF] hover:text-white flex items-center gap-1 cursor-pointer"
              >
                {copiedKey ? <Check className="w-3 h-3 text-[#10B981]" /> : <Copy className="w-3 h-3" />}
                <span>{copiedKey ? 'Copied' : 'Copy Key Name'}</span>
              </button>
            </div>
            <p className="text-[#C2C6D6] font-sans text-xs leading-relaxed">
              Open the <strong>Secrets panel</strong> in the AI Studio interface (or your Cloud Run environment secrets), and add a new secret:
            </p>
            <div className="bg-[#111827] p-2 rounded border border-[#374151] space-y-1">
              <div><strong className="text-[#9CA3AF]">Key:</strong> <code className="text-[#34D399]">N8N_WEBHOOK_URL</code></div>
              <div><strong className="text-[#9CA3AF]">Value:</strong> <code className="text-[#60A5FA]">https://your-n8n-instance.app.n8n.cloud/webhook/incident-approval</code></div>
            </div>
            <p className="text-[11px] text-[#6B7280] font-sans">
              * Note: The URL is never sent or exposed to client browser code. All requests flow through the backend server proxy <code className="text-[#DCE2F3]">/api/approvals/dispatch</code>.
            </p>
          </div>

          {/* Step 2: Webhook Node Requirements */}
          <div className="bg-[#080C13] border border-[#1F2937] rounded p-4 space-y-2">
            <span className="text-[#60A5FA] font-semibold">2. n8n Production Webhook Node Configuration</span>
            <ul className="text-xs text-[#C2C6D6] font-sans space-y-1.5 list-disc list-inside">
              <li><strong>HTTP Method:</strong> <code className="font-mono text-[#DCE2F3]">POST</code></li>
              <li><strong>Authentication:</strong> Header Auth / None (secure internal backend-to-backend network call).</li>
              <li><strong>Safety Enforcement:</strong> The request must have <code className="font-mono text-[#34D399]">simulation_mode: true</code>. Any request with <code className="font-mono text-[#EF4444]">simulation_mode: false</code> will be rejected with HTTP 400.</li>
              <li>
                <strong>Expected n8n Response:</strong> Use the <em>"Respond to Webhook"</em> node to return HTTP 200 with JSON:
                <div className="bg-[#111827] p-2 rounded border border-[#374151] font-mono text-[11px] text-[#34D399] mt-1.5">
                  {`{ "incident_id": "...", "approval_id": "...", "workflow_status": "completed", "result_message": "...", "execution_timestamp": "..." }`}
                </div>
              </li>
            </ul>
          </div>

          {/* Step 3: Payload Reference */}
          <div className="bg-[#080C13] border border-[#1F2937] rounded p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[#60A5FA] font-semibold">3. Payload Format Dispatched to n8n</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(samplePayload);
                  setCopiedPayload(true);
                  setTimeout(() => setCopiedPayload(false), 2000);
                }}
                className="text-[11px] text-[#9CA3AF] hover:text-white flex items-center gap-1 cursor-pointer"
              >
                {copiedPayload ? <Check className="w-3 h-3 text-[#10B981]" /> : <Copy className="w-3 h-3" />}
                <span>{copiedPayload ? 'Copied' : 'Copy Sample'}</span>
              </button>
            </div>
            <pre className="bg-[#111827] border border-[#374151] rounded p-2.5 text-[11px] text-[#F9FAFB] overflow-x-auto">
              {samplePayload}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-[#151C27] border-t border-[#374151] px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] text-[#9CA3AF]">
            <ShieldCheck className="w-3.5 h-3.5 text-[#34D399]" />
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
