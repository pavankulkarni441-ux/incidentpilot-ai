import React, { useState } from 'react';
import { Incident } from '../../types/incident';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { MetricCard } from '../ui/MetricCard';
import { Search, Plus, ExternalLink } from 'lucide-react';

interface TriageViewProps {
  incidents: Incident[];
  onSelectIncident: (incident: Incident) => void;
  onOpenDeclareModal: () => void;
}

export const TriageView: React.FC<TriageViewProps> = ({
  incidents,
  onSelectIncident,
  onOpenDeclareModal,
}) => {
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredIncidents = incidents.filter((inc) => {
    const matchesSev = severityFilter === 'ALL' || inc.severity === severityFilter;
    const matchesStatus = statusFilter === 'ALL' || inc.status === statusFilter;
    const matchesQuery =
      searchQuery.trim() === '' ||
      inc.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inc.service.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inc.commander.name.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesSev && matchesStatus && matchesQuery;
  });

  return (
    <div className="space-y-6">
      {/* Top Overview KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Active High-Severity Outages"
          value={incidents.filter((i) => i.status !== 'resolved' && (i.severity === 'SEV-0' || i.severity === 'SEV-1')).length}
          unit="SEV-1 Critical"
          change="Active Queue"
          changeType="negative"
          statusColor="red"
          annotation="auth-gateway-prod"
          sparklineData={[0, 0, 0, 1, 1, 2, 1, 1, 1, 1]}
        />
        <MetricCard
          label="Mean Time to Mitigate (MTTM)"
          value="11.4"
          unit="min"
          change="-24.5% vs 30d avg"
          changeType="positive"
          statusColor="emerald"
          annotation="Target: < 15.0 min"
          sparklineData={[18.2, 16.5, 15.1, 14.8, 13.9, 12.8, 12.1, 11.8, 11.4, 11.4]}
        />
        <MetricCard
          label="30-Day Platform SLO"
          value="99.942"
          unit="%"
          change="Nominal"
          changeType="positive"
          statusColor="emerald"
          annotation="Error budget: 88.2% left"
          sparklineData={[99.98, 99.97, 99.96, 99.95, 99.95, 99.94, 99.942, 99.942]}
        />
        <MetricCard
          label="AI Runbook Remediation Rate"
          value="92.4"
          unit="%"
          change="+8.1% adoption"
          changeType="positive"
          statusColor="blue"
          annotation="Human authorized execution"
          sparklineData={[75, 80, 84, 86, 88, 90, 91.5, 92.4, 92.4]}
        />
      </div>

      {/* Control Bar */}
      <div className="neu-surface rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <div className="relative flex items-center w-full sm:w-auto">
            <Search className="w-3.5 h-3.5 text-[var(--ip-text-muted)] absolute left-3 pointer-events-none" />
            <input
              type="text"
              placeholder="Search code, service, or commander..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="neu-inset focus:border-[#3B82F6]/50 text-[var(--ip-text)] text-xs font-mono pl-8 pr-3 py-2 rounded-xl outline-none placeholder-[var(--ip-text-muted)] w-full sm:w-64 transition-colors"
            />
          </div>

          <div className="flex items-center neu-inset rounded-xl p-1 text-xs font-mono overflow-x-auto max-w-full">
            {['ALL', 'SEV-0', 'SEV-1', 'SEV-2'].map((sev) => (
              <button
                key={sev}
                onClick={() => setSeverityFilter(sev)}
                className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer text-[11px] shrink-0 ${
                  severityFilter === sev
                    ? 'neu-pill text-[var(--ip-text)] font-semibold'
                    : 'text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)]'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>

          <div className="flex items-center neu-inset rounded-xl p-1 text-xs font-mono overflow-x-auto max-w-full">
            {['ALL', 'mitigating', 'investigating', 'resolved'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer text-[11px] capitalize shrink-0 ${
                  statusFilter === st
                    ? 'neu-pill text-[var(--ip-text)] font-semibold'
                    : 'text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)]'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 shrink-0">
          <Button
            variant="destructive"
            size="md"
            onClick={onOpenDeclareModal}
            icon={<Plus className="w-3.5 h-3.5" />}
          >
            Declare Outage
          </Button>
        </div>
      </div>

      {/* Incident Table */}
      <div className="neu-surface rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono border-collapse">
            <thead>
              <tr className="bg-[var(--ip-surface-alt)] border-b border-[var(--ip-border)] text-[var(--ip-text-muted)] uppercase text-[11px]">
                <th className="py-3.5 px-4 w-[110px]">INCIDENT</th>
                <th className="py-3.5 px-4 w-[100px]">SEVERITY</th>
                <th className="py-3.5 px-4">TITLE & IMPACT</th>
                <th className="py-3.5 px-4 w-[160px]">SERVICE</th>
                <th className="py-3.5 px-4 w-[170px]">COMMANDER</th>
                <th className="py-3.5 px-4 w-[110px]">DURATION</th>
                <th className="py-3.5 px-4 w-[100px]">STATUS</th>
                <th className="py-3.5 px-4 w-[130px] text-right">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ip-border)]">
              {filteredIncidents.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[var(--ip-text-muted)]">
                    No incident records match the active criteria.
                  </td>
                </tr>
              ) : (
                filteredIncidents.map((inc) => {
                  const isSev0or1 = inc.severity === 'SEV-0' || inc.severity === 'SEV-1';
                  const isResolved = inc.status === 'resolved';

                  return (
                    <tr
                      key={inc.id}
                      className="hover:bg-[var(--ip-pill)]/40 transition-colors group cursor-default"
                    >
                      <td className="py-3.5 px-4 font-semibold text-[#2563EB] dark:text-[#60A5FA]">
                        {inc.code}
                      </td>

                      <td className="py-3.5 px-4">
                        <Badge
                          variant={
                            isResolved ? 'healthy' : isSev0or1 ? 'critical' : 'warning'
                          }
                          showSquare={!isResolved}
                        >
                          {inc.severity}
                        </Badge>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-sans font-medium text-sm text-[var(--ip-text)] line-clamp-1">
                          {inc.title}
                        </div>
                        <div className="text-[11px] text-[var(--ip-text-secondary)] line-clamp-1 mt-0.5">
                          {inc.impactSummary}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-[var(--ip-text)]">
                        <span className="neu-inset px-2 py-0.5 rounded-md text-[11px] text-[var(--ip-text-secondary)]">
                          {inc.service}
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <img
                            src={inc.commander.avatar}
                            alt={inc.commander.name}
                            className="w-5 h-5 rounded-md object-cover border border-[var(--ip-border-strong)]"
                            referrerPolicy="no-referrer"
                          />
                          <span className="text-[var(--ip-text)] truncate max-w-[120px]">
                            {inc.commander.name}
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-[var(--ip-text-secondary)] tabular-nums">
                        {inc.durationMinutes}m elapsed
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`text-[11px] uppercase font-semibold ${
                            isResolved
                              ? 'text-[#047857] dark:text-[#6EE7B7]'
                              : inc.status === 'mitigating'
                              ? 'text-[#2563EB] dark:text-[#93C5FD]'
                              : 'text-[#B45309] dark:text-[#FCD34D]'
                          }`}
                        >
                          {inc.status}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onSelectIncident(inc)}
                          icon={<ExternalLink className="w-3 h-3" />}
                        >
                          War Room
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
