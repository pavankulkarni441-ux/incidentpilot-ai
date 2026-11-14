import React, { useState } from 'react';
import { ServiceNode } from '../../types/incident';
import { Badge } from '../ui/Badge';
import { Network, ArrowDownRight } from 'lucide-react';

interface TopologyViewProps {
  services: ServiceNode[];
}

export const TopologyView: React.FC<TopologyViewProps> = ({ services }) => {
  const [selectedService, setSelectedService] = useState<ServiceNode>(
    services.find((s) => s.id === 'svc-auth') || services[0]
  );

  const tiers: ('Edge' | 'Gateway' | 'Core' | 'Data')[] = ['Edge', 'Gateway', 'Core', 'Data'];

  return (
    <div className="space-y-6">
      {/* Topology Header */}
      <div className="neu-surface rounded-2xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <Network className="w-5 h-5 text-[#3B82F6] dark:text-[#60A5FA] shrink-0" />
            <h2 className="text-base font-semibold text-[var(--ip-text)] tracking-tight">
              Platform Service Mesh & Topology Graph
            </h2>
          </div>
          <p className="text-xs text-[var(--ip-text-secondary)] mt-1.5 max-w-2xl">
            Live directed acyclic graph (DAG) of active RPC channels, edge ingress points, and datastore connection pools across Kubernetes clusters.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs font-mono shrink-0">
          <span className="flex items-center gap-1.5 text-[#DC2626] dark:text-[#FCA5A5]">
            <span className="w-2 h-2 bg-[#EF4444] rounded-full" />
            {services.filter((s) => s.status === 'critical').length} Critical
          </span>
          <span className="flex items-center gap-1.5 text-[#B45309] dark:text-[#FCD34D]">
            <span className="w-2 h-2 bg-[#F59E0B] rounded-full" />
            {services.filter((s) => s.status === 'degraded').length} Degraded
          </span>
          <span className="flex items-center gap-1.5 text-[#047857] dark:text-[#6EE7B7]">
            <span className="w-2 h-2 bg-[#10B981] rounded-full" />
            {services.filter((s) => s.status === 'nominal').length} Nominal
          </span>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 min-w-0 space-y-4">
          {tiers.map((tier) => {
            const tierServices = services.filter((s) => s.tier === tier);
            return (
              <div key={tier} className="neu-surface rounded-2xl p-4 sm:p-5 space-y-3.5">
                <div className="flex items-center justify-between border-b border-[var(--ip-border)] pb-2.5">
                  <span className="text-[11px] font-mono font-semibold text-[var(--ip-text-secondary)] uppercase tracking-wider">
                    Tier: {tier} Layer
                  </span>
                  <span className="text-[10px] font-mono text-[var(--ip-text-muted)]">
                    {tierServices.length} registered microservices
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {tierServices.map((svc) => {
                    const isSelected = selectedService.id === svc.id;
                    const isCrit = svc.status === 'critical';
                    const isDegraded = svc.status === 'degraded';

                    return (
                      <div
                        key={svc.id}
                        onClick={() => setSelectedService(svc)}
                        className={`p-3.5 rounded-xl font-mono text-xs cursor-pointer transition-all ${
                          isSelected
                            ? 'neu-pill ring-1 ring-[#3B82F6]/50 border border-[#3B82F6]/35'
                            : isCrit
                            ? 'neu-inset border-[#EF4444]/30 hover:border-[#EF4444]/50'
                            : isDegraded
                            ? 'neu-inset border-[#F59E0B]/30 hover:border-[#F59E0B]/50'
                            : 'neu-inset hover:border-[var(--ip-border-strong)]'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2.5 gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                isCrit ? 'bg-[#EF4444]' : isDegraded ? 'bg-[#F59E0B]' : 'bg-[#10B981]'
                              }`}
                            />
                            <span className="font-semibold text-[var(--ip-text)] truncate">{svc.name}</span>
                          </div>
                          <span
                            className={`text-[10px] uppercase px-2 py-0.5 rounded-md font-mono border shrink-0 ${
                              isCrit
                                ? 'bg-[#EF4444]/10 text-[#DC2626] dark:text-[#FCA5A5] border-[#EF4444]/25'
                                : isDegraded
                                ? 'bg-[#F59E0B]/10 text-[#B45309] dark:text-[#FCD34D] border-[#F59E0B]/25'
                                : 'bg-[#10B981]/10 text-[#047857] dark:text-[#6EE7B7] border-[#10B981]/25'
                            }`}
                          >
                            {svc.status}
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-1 pt-2.5 border-t border-[var(--ip-border)] text-[11px] tabular-nums">
                          <div>
                            <span className="text-[var(--ip-text-muted)] block text-[10px]">p99 Latency</span>
                            <span className={svc.p99Ms > 500 ? 'text-[#DC2626] dark:text-[#FCA5A5] font-semibold' : 'text-[var(--ip-text)]'}>
                              {svc.p99Ms}ms
                            </span>
                          </div>
                          <div>
                            <span className="text-[var(--ip-text-muted)] block text-[10px]">Error Rate</span>
                            <span className={svc.errorRate > 5 ? 'text-[#DC2626] dark:text-[#FCA5A5] font-semibold' : 'text-[var(--ip-text)]'}>
                              {svc.errorRate.toFixed(1)}%
                            </span>
                          </div>
                          <div>
                            <span className="text-[var(--ip-text-muted)] block text-[10px]">Throughput</span>
                            <span className="text-[var(--ip-text-secondary)]">
                              {svc.rps.toLocaleString()} rps
                            </span>
                          </div>
                        </div>

                        {svc.dependencies.length > 0 && (
                          <div className="mt-2.5 text-[10px] text-[var(--ip-text-muted)] flex items-center gap-1 truncate">
                            <ArrowDownRight className="w-3 h-3 text-[#3B82F6] dark:text-[#60A5FA] shrink-0" />
                            <span className="truncate">Calls: {svc.dependencies.join(', ')}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected Service Detail Inspector */}
        <div className="lg:col-span-4 min-w-0 neu-surface rounded-2xl p-5 space-y-4 flex flex-col justify-between h-fit">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--ip-border)] gap-2">
              <div className="min-w-0">
                <span className="text-[10px] font-mono text-[var(--ip-text-muted)] uppercase tracking-wider block">
                  Selected Node Inspector
                </span>
                <h3 className="text-sm font-semibold text-[var(--ip-text)] font-mono truncate">
                  {selectedService.name}
                </h3>
              </div>
              <Badge
                variant={
                  selectedService.status === 'critical'
                    ? 'critical'
                    : selectedService.status === 'degraded'
                    ? 'warning'
                    : 'healthy'
                }
                showSquare={selectedService.status === 'critical'}
              >
                {selectedService.status}
              </Badge>
            </div>

            <div className="neu-inset rounded-xl p-3.5 space-y-2.5 font-mono text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--ip-text-secondary)]">Deployed Image:</span>
                <span className="text-[#2563EB] dark:text-[#93C5FD] truncate max-w-[170px]">{selectedService.deployedVersion}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--ip-text-secondary)]">Topology Tier:</span>
                <span className="text-[var(--ip-text)]">{selectedService.tier} Layer</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--ip-text-secondary)]">Current Load:</span>
                <span className="text-[var(--ip-text)] tabular-nums">{selectedService.rps} requests/sec</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--ip-text-secondary)]">p99 SLA Target:</span>
                <span className="text-[var(--ip-text)]">&lt; 150ms</span>
              </div>
            </div>

            <div>
              <span className="text-[11px] font-mono text-[var(--ip-text-secondary)] uppercase tracking-wider block mb-2">
                Downstream Dependency Tree
              </span>
              {selectedService.dependencies.length === 0 ? (
                <div className="text-xs font-mono text-[var(--ip-text-muted)] neu-inset p-3 rounded-xl">
                  Terminal node (No downstream external calls)
                </div>
              ) : (
                <div className="space-y-1.5 font-mono text-xs">
                  {selectedService.dependencies.map((dep) => (
                    <div
                      key={dep}
                      className="neu-inset px-3 py-2 rounded-xl flex items-center justify-between text-[var(--ip-text)]"
                    >
                      <span className="truncate">{dep}</span>
                      <span className="text-[10px] text-[#2563EB] dark:text-[#60A5FA] shrink-0">gRPC / TCP</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <span className="text-[11px] font-mono text-[var(--ip-text-secondary)] uppercase tracking-wider block mb-2">
                Observed Latency Distribution
              </span>
              <div className="neu-inset rounded-xl p-3.5 space-y-2 font-mono text-xs">
                <div className="flex justify-between text-[11px]">
                  <span className="text-[var(--ip-text-muted)]">p50 Median</span>
                  <span className="text-[var(--ip-text)] tabular-nums">{Math.round(selectedService.p99Ms * 0.15)}ms</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-[var(--ip-text-muted)]">p95 Tail</span>
                  <span className="text-[var(--ip-text)] tabular-nums">{Math.round(selectedService.p99Ms * 0.7)}ms</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-[var(--ip-text-muted)]">p99 Outlier</span>
                  <span className={selectedService.p99Ms > 500 ? 'text-[#DC2626] dark:text-[#FCA5A5] font-semibold' : 'text-[var(--ip-text)]'}>
                    {selectedService.p99Ms}ms
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-[var(--ip-border)] text-[11px] font-mono text-[var(--ip-text-muted)]">
            Topology probe synced via Istio Envoy sidecars
          </div>
        </div>
      </div>
    </div>
  );
};
