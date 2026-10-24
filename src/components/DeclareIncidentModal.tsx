import React, { useState } from 'react';
import { Incident, SeverityLevel } from '../types/incident';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { X, ShieldAlert, AlertTriangle } from 'lucide-react';

interface DeclareIncidentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeclare: (newIncident: Partial<Incident>) => void;
}

export const DeclareIncidentModal: React.FC<DeclareIncidentModalProps> = ({
  isOpen,
  onClose,
  onDeclare,
}) => {
  const [title, setTitle] = useState('');
  const [service, setService] = useState('checkout-api');
  const [severity, setSeverity] = useState<SeverityLevel>('SEV-1');
  const [impactSummary, setImpactSummary] = useState('');
  const [blastRadius, setBlastRadius] = useState('Global Checkout & Payments');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    onDeclare({
      code: `INC-${Math.floor(4900 + Math.random() * 100)}`,
      title,
      service,
      severity,
      impactSummary: impactSummary || 'Automated health probes detected elevated transaction abort rates.',
      blastRadius,
      status: 'investigating',
      startedAt: 'Just now',
      durationMinutes: 1,
      affectedUsersCount: severity === 'SEV-0' ? 45000 : 8500,
      p99LatencyMs: 950,
      errorRatePercent: severity === 'SEV-0' ? 24.5 : 8.2,
      commander: {
        name: 'Sarah Chen',
        role: 'Staff SRE / Incident Commander',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
      },
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#070e19]/80 backdrop-blur-xs p-4">
      <div className="bg-[#111827] border border-[#374151] rounded-xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-[#151C27] border-b border-[#374151] px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-[#EF4444]" />
            <span className="text-xs font-mono font-semibold text-[#DCE2F3]">
              DECLARE NEW PRODUCTION INCIDENT
            </span>
          </div>
          <button onClick={onClose} className="text-[#9CA3AF] hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 font-mono text-xs">
          <div>
            <label className="text-[11px] text-[#9CA3AF] block mb-1">
              Incident Severity Level
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['SEV-0', 'SEV-1', 'SEV-2'] as SeverityLevel[]).map((sev) => (
                <button
                  type="button"
                  key={sev}
                  onClick={() => setSeverity(sev)}
                  className={`py-2 px-3 rounded border text-center font-bold cursor-pointer transition-all ${
                    severity === sev
                      ? sev === 'SEV-0'
                        ? 'bg-red-950 border-[#EF4444] text-[#F87171]'
                        : sev === 'SEV-1'
                        ? 'bg-red-950/70 border-[#EF4444]/80 text-[#F87171]'
                        : 'bg-amber-950 border-[#F59E0B] text-[#FBBF24]'
                      : 'bg-[#080C13] border-[#1F2937] text-[#9CA3AF] hover:border-[#374151]'
                  }`}
                >
                  {sev}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] text-[#9CA3AF] block mb-1">
              Incident Title / Headline Summary
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Memory leak causing crash back-off in checkout-api"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-[#080C13] border border-[#374151] focus:border-[#3B82F6] text-[#F9FAFB] p-2.5 rounded outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-[#9CA3AF] block mb-1">
                Affected Target Service
              </label>
              <select
                value={service}
                onChange={(e) => setService(e.target.value)}
                className="w-full bg-[#080C13] border border-[#374151] focus:border-[#3B82F6] text-[#F9FAFB] p-2.5 rounded outline-none"
              >
                <option value="auth-gateway-prod">auth-gateway-prod</option>
                <option value="checkout-api">checkout-api</option>
                <option value="payment-ledger">payment-ledger</option>
                <option value="orders-worker">orders-worker</option>
                <option value="aurora-pg-cluster">aurora-pg-cluster</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] text-[#9CA3AF] block mb-1">
                Blast Radius Scope
              </label>
              <input
                type="text"
                value={blastRadius}
                onChange={(e) => setBlastRadius(e.target.value)}
                className="w-full bg-[#080C13] border border-[#374151] focus:border-[#3B82F6] text-[#F9FAFB] p-2.5 rounded outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] text-[#9CA3AF] block mb-1">
              Initial Impact Observation
            </label>
            <textarea
              rows={3}
              placeholder="Describe symptoms, customer impact, or anomalous alert monitors..."
              value={impactSummary}
              onChange={(e) => setImpactSummary(e.target.value)}
              className="w-full bg-[#080C13] border border-[#374151] focus:border-[#3B82F6] text-[#F9FAFB] p-2.5 rounded outline-none resize-none font-sans"
            />
          </div>

          {/* Footer actions */}
          <div className="pt-3 border-t border-[#1F2937] flex items-center justify-between">
            <span className="text-[10px] text-[#6B7280]">
              Dispatches automated PagerDuty alarm
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="destructive" size="md" type="submit">
                Escalate & Open War Room
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
