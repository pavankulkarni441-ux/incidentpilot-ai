import React, { useState } from 'react';
import { ServiceNode } from '../../types/incident';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Network, Server, ArrowDownRight, Activity, Cpu, HardDrive, ShieldAlert, CheckCircle2 } from 'lucide-react';

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
      <div className="bg-[#111827] border border-[#374151] rounded-lg p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-[#3B82F6]" />
            <h2 className="text-base font-semibold text-[#F9FAFB] tracking-tight">
              Platform Service Mesh & Topology Graph
            </h2>
          </div>
          <p className="text-xs text-[#9CA3AF] mt-1 max-w-2xl">
            Live directed acyclic graph (DAG) of active RPC channels, edge ingress points, and datastore connection pools across Kubernetes clusters.
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="flex items-center gap-1.5 text-[#F87171]">
            <span className="w-2 h-2 bg-[#EF4444] rounded-none" />
            2 Critical
          </span>
          <span className="flex items-center gap-1.5 text-[#FBBF24]">
            <span className="w-2 h-2 bg-[#F59E0B] rounded-none" />
            1 Degraded
          </span>
          <span className="flex items-center gap-1.5 text-[#34D399]">
            <span className="w-2 h-2 bg-[#10B981] rounded-none" />
            5 Nominal
          </span>
        </div>
      </div>

      {/* Main Grid: Architectural Tier Flow & Node Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Tier Layout View (8 Cols) */}
        <div className="lg:col-span-8 space-y-4">
          {tiers.map((tier) => {
            const tierServices = services.filter((s) => s.tier === tier);
            return (
              <div
                key={tier}
                className="bg-[#111827] border border-[#374151] rounded-lg p-4 space-y-3"
              >
                <div className="flex items-center justify-between border-b border-[#1F2937] pb-2">
                  <span className="text-[11px] font-mono font-semibold text-[#9CA3AF] uppercase tracking-wider">
                    Tier: {tier} Layer
                  </span>
                  <span className="text-[10px] font-mono text-[#6B7280]">
                    {tierServices.length} registered microservices
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {tierServices.map((svc) => {
                    const isSelected = selectedService.id === svc.id;
                    const isCrit = svc.status === 'critical';
                    const isDegraded = svc.status === 'degraded';

                    return (
                      <div
                        key={svc.id}
                        onClick={() => setSelectedService(svc)}
                        className={`p-3 rounded border font-mono text-xs cursor-pointer transition-all ${
                          isSelected
                            ? 'border-[#3B82F6] bg-[#1F2937] shadow-md'
                            : isCrit
                            ? 'border-[#EF4444]/60 bg-[#151117] hover:border-[#EF4444]'
                            : isDegraded
                            ? 'border-[#F59E0B]/50 bg-[#151411] hover:border-[#F59E0B]'
                            : 'border-[#1F2937] bg-[#0B0F17] hover:border-[#374151]'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2 h-2 rounded-none shrink-0 ${
                                isCrit
                                  ? 'bg-[#EF4444]'
                                  : isDegraded
                                  ? 'bg-[#F59E0B]'
                                  : 'bg-[#10B981]'
                              }`}
                            />
                            <span className="font-semibold text-[#DCE2F3] truncate max-w-[150px]">
                              {svc.name}
                            </span>
                          </div>
                          <span
                            className={`text-[10px] uppercase px-1.5 py-0.2 rounded font-mono ${
                              isCrit
                                ? 'bg-red-950 text-[#F87171] border border-red-800'
                                : isDegraded
                                ? 'bg-amber-950 text-[#FBBF24] border border-amber-800'
                                : 'bg-emerald-950 text-[#34D399] border border-emerald-800'
                            }`}
                          >
                            {svc.status}
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-1 pt-2 border-t border-[#1F2937] text-[11px] tabular-nums">
                          <div>
                            <span className="text-[#6B7280] block text-[10px]">p99 Latency</span>
                            <span className={svc.p99Ms > 500 ? 'text-[#EF4444] font-semibold' : 'text-[#DCE2F3]'}>
                              {svc.p99Ms}ms
                            </span>
                          </div>
                          <div>
                            <span className="text-[#6B7280] block text-[10px]">Error Rate</span>
                            <span className={svc.errorRate > 5 ? 'text-[#EF4444] font-semibold' : 'text-[#DCE2F3]'}>
                              {svc.errorRate.toFixed(1)}%
                            </span>
                          </div>
                          <div>
                            <span className="text-[#6B7280] block text-[10px]">Throughput</span>
                            <span className="text-[#9CA3AF]">
                              {svc.rps.toLocaleString()} rps
                            </span>
                          </div>
                        </div>

                        {svc.dependencies.length > 0 && (
                          <div className="mt-2 text-[10px] text-[#6B7280] flex items-center gap-1 truncate">
                            <ArrowDownRight className="w-3 h-3 text-[#3B82F6]" />
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

        {/* Selected Service Detail Inspector (4 Cols) */}
        <div className="lg:col-span-4 bg-[#111827] border border-[#374151] rounded-lg p-5 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#1F2937]">
              <div>
                <span className="text-[10px] font-mono text-[#6B7280] uppercase tracking-wider block">
                  Selected Node Inspector
                </span>
                <h3 className="text-sm font-semibold text-[#F9FAFB] font-mono">
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

            {/* Spec metadata */}
            <div className="bg-[#080C13] border border-[#1F2937] rounded p-3 space-y-2 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[#9CA3AF]">Deployed Image:</span>
                <span className="text-[#60A5FA] truncate max-w-[170px]">{selectedService.deployedVersion}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#9CA3AF]">Topology Tier:</span>
                <span className="text-[#DCE2F3]">{selectedService.tier} Layer</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#9CA3AF]">Current Load:</span>
                <span className="text-[#DCE2F3] tabular-nums">{selectedService.rps} requests/sec</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#9CA3AF]">p99 SLA Target:</span>
                <span className="text-[#DCE2F3]">&lt; 150ms</span>
              </div>
            </div>

            {/* Dependencies */}
            <div>
              <span className="text-[11px] font-mono text-[#9CA3AF] uppercase block mb-1.5">
                Downstream Dependency Tree
              </span>
              {selectedService.dependencies.length === 0 ? (
                <div className="text-xs font-mono text-[#6B7280] bg-[#080C13] p-2.5 rounded border border-[#1F2937]">
                  Terminal node (No downstream external calls)
                </div>
              ) : (
                <div className="space-y-1.5 font-mono text-xs">
                  {selectedService.dependencies.map((dep) => (
                    <div
                      key={dep}
                      className="bg-[#080C13] border border-[#1F2937] px-2.5 py-1.5 rounded flex items-center justify-between text-[#C2C6D6]"
                    >
                      <span className="truncate">{dep}</span>
                      <span className="text-[10px] text-[#3B82F6]">gRPC / TCP</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Telemetry Sparklines */}
            <div>
              <span className="text-[11px] font-mono text-[#9CA3AF] uppercase block mb-1.5">
                Observed Latency Distribution
              </span>
              <div className="bg-[#080C13] border border-[#1F2937] rounded p-3 space-y-2 font-mono text-xs">
                <div className="flex justify-between text-[11px]">
                  <span className="text-[#6B7280]">p50 Median</span>
                  <span className="text-[#DCE2F3] tabular-nums">{Math.round(selectedService.p99Ms * 0.15)}ms</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-[#6B7280]">p95 Tail</span>
                  <span className="text-[#DCE2F3] tabular-nums">{Math.round(selectedService.p99Ms * 0.7)}ms</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-[#6B7280]">p99 Outlier</span>
                  <span className={selectedService.p99Ms > 500 ? 'text-[#EF4444] font-semibold' : 'text-[#DCE2F3]'}>
                    {selectedService.p99Ms}ms
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-[#1F2937] text-[11px] font-mono text-[#6B7280]">
            Topology probe synced via Istio Envoy sidecars
          </div>
        </div>
      </div>
    </div>
  );
};
