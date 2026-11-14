import React, { useState } from 'react';
import { Incident, SeverityLevel } from '../types/incident';
import { Button } from './ui/Button';
import { X, ShieldAlert } from 'lucide-react';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="neu-surface rounded-2xl w-full max-w-lg overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
        <div className="border-b border-[var(--ip-border)] px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-[#EF4444]" />
            <span className="text-xs font-mono font-semibold text-[var(--ip-text)]">
              DECLARE NEW PRODUCTION INCIDENT
            </span>
          </div>
          <button onClick={onClose} className="text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 font-mono text-xs">
          <div>
            <label className="text-[11px] text-[var(--ip-text-secondary)] block mb-1.5">
              Incident Severity Level
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['SEV-0', 'SEV-1', 'SEV-2'] as SeverityLevel[]).map((sev) => (
                <button
                  type="button"
                  key={sev}
                  onClick={() => setSeverity(sev)}
                  className={`py-2 px-3 rounded-xl border text-center font-bold cursor-pointer transition-all ${
                    severity === sev
                      ? sev === 'SEV-0' || sev === 'SEV-1'
                        ? 'bg-[#EF4444]/15 border-[#EF4444]/40 text-[#DC2626] dark:text-[#FCA5A5]'
                        : 'bg-[#F59E0B]/15 border-[#F59E0B]/40 text-[#B45309] dark:text-[#FCD34D]'
                      : 'neu-inset text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)]'
                  }`}
                >
                  {sev}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] text-[var(--ip-text-secondary)] block mb-1.5">
              Incident Title / Headline Summary
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Memory leak causing crash back-off in checkout-api"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full neu-inset focus:border-[#3B82F6]/50 text-[var(--ip-text)] p-2.5 rounded-xl outline-none placeholder-[var(--ip-text-muted)]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-[var(--ip-text-secondary)] block mb-1.5">
                Affected Target Service
              </label>
              <select
                value={service}
                onChange={(e) => setService(e.target.value)}
                className="w-full neu-inset focus:border-[#3B82F6]/50 text-[var(--ip-text)] p-2.5 rounded-xl outline-none"
              >
                <option value="auth-gateway-prod">auth-gateway-prod</option>
                <option value="checkout-api">checkout-api</option>
                <option value="payment-ledger">payment-ledger</option>
                <option value="orders-worker">orders-worker</option>
                <option value="aurora-pg-cluster">aurora-pg-cluster</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] text-[var(--ip-text-secondary)] block mb-1.5">
                Blast Radius Scope
              </label>
              <input
                type="text"
                value={blastRadius}
                onChange={(e) => setBlastRadius(e.target.value)}
                className="w-full neu-inset focus:border-[#3B82F6]/50 text-[var(--ip-text)] p-2.5 rounded-xl outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] text-[var(--ip-text-secondary)] block mb-1.5">
              Initial Impact Observation
            </label>
            <textarea
              rows={3}
              placeholder="Describe symptoms, customer impact, or anomalous alert monitors..."
              value={impactSummary}
              onChange={(e) => setImpactSummary(e.target.value)}
              className="w-full neu-inset focus:border-[#3B82F6]/50 text-[var(--ip-text)] p-2.5 rounded-xl outline-none resize-none font-sans placeholder-[var(--ip-text-muted)]"
            />
          </div>

          <div className="pt-3 border-t border-[var(--ip-border)] flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] text-[var(--ip-text-muted)]">
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
