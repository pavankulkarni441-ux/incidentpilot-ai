import React, { useState } from 'react';
import { PodMetric } from '../../types/incident';
import { Server, Activity, Terminal, X, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';

interface PodHealthMatrixProps {
  pods: PodMetric[];
}

export const PodHealthMatrix: React.FC<PodHealthMatrixProps> = ({ pods }) => {
  const [inspectedPod, setInspectedPod] = useState<PodMetric | null>(null);

  return (
    <div className="bg-[#111827] border border-[#374151] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-[#151C27] border-b border-[#374151] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-[#3B82F6]" />
          <span className="text-xs font-mono font-semibold text-[#DCE2F3]">
            KUBERNETES REPLICA POOL MATRIX
          </span>
          <span className="text-xs font-mono text-[#6B7280]">
            Deployment: <strong className="text-[#9CA3AF]">auth-gateway-prod</strong> (6 Replicas)
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-[#9CA3AF]">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 bg-[#EF4444] rounded-none" />
            4 Saturated
          </span>
          <span className="text-[#424754]">|</span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 bg-[#10B981] rounded-none" />
            2 Nominal
          </span>
        </div>
      </div>

      {/* Pod Grid */}
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 bg-[#0B0F17]">
        {pods.map((pod) => {
          const isDegraded = pod.status === 'Degraded' || pod.activeConnections >= pod.maxConnections;
          return (
            <div
              key={pod.name}
              onClick={() => setInspectedPod(pod)}
              className={`bg-[#111827] border rounded p-3 transition-all cursor-pointer hover:border-[#4B5563] ${
                isDegraded
                  ? 'border-[#EF4444]/60 bg-[#161217]'
                  : 'border-[#374151] hover:bg-[#1F2937]/50'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 font-mono text-xs font-medium">
                  <span
                    className={`w-2 h-2 rounded-none shrink-0 ${
                      isDegraded ? 'bg-[#EF4444]' : 'bg-[#10B981]'
                    }`}
                  />
                  <span className="text-[#DCE2F3] truncate max-w-[150px]">{pod.name}</span>
                </div>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    isDegraded
                      ? 'bg-red-950/70 text-[#F87171] border border-red-800'
                      : 'bg-emerald-950/70 text-[#34D399] border border-emerald-800'
                  }`}
                >
                  {pod.status}
                </span>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono pt-2 border-t border-[#1F2937]">
                <div>
                  <span className="text-[#6B7280] block text-[10px]">CPU Saturation</span>
                  <span
                    className={`font-semibold tabular-nums ${
                      pod.cpuUsage > 85 ? 'text-[#EF4444]' : 'text-[#DCE2F3]'
                    }`}
                  >
                    {pod.cpuUsage.toFixed(1)}%
                  </span>
                </div>

                <div>
                  <span className="text-[#6B7280] block text-[10px]">DB Connections</span>
                  <span
                    className={`font-semibold tabular-nums ${
                      pod.activeConnections >= pod.maxConnections ? 'text-[#EF4444]' : 'text-[#34D399]'
                    }`}
                  >
                    {pod.activeConnections} / {pod.maxConnections}
                  </span>
                </div>

                <div>
                  <span className="text-[#6B7280] block text-[10px]">Memory Allocated</span>
                  <span className="text-[#DCE2F3] tabular-nums">
                    {pod.memoryMb}MB <span className="text-[#6B7280]">/ 1024MB</span>
                  </span>
                </div>

                <div>
                  <span className="text-[#6B7280] block text-[10px]">Restarts / Uptime</span>
                  <span className="text-[#DCE2F3] tabular-nums">
                    {pod.restarts > 0 ? (
                      <span className="text-[#F59E0B] font-semibold">{pod.restarts} (OOM)</span>
                    ) : (
                      '0'
                    )}{' '}
                    • <span className="text-[#9CA3AF]">{pod.uptime}</span>
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Flyout Drawer for Pod Logs */}
      {inspectedPod && (
        <div className="border-t border-[#374151] bg-[#080C13] p-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-[#1F2937] mb-2 font-mono text-xs">
            <div className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-[#3B82F6]" />
              <span className="text-[#DCE2F3] font-semibold">Pod Stdout Tail: {inspectedPod.name}</span>
              <span className="text-[#6B7280]">Container: auth-gateway</span>
            </div>
            <button
              onClick={() => setInspectedPod(null)}
              className="text-[#9CA3AF] hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="font-mono text-[11px] text-[#C2C6D6] space-y-1 bg-[#05090F] p-3 rounded border border-[#1F2937] max-h-40 overflow-y-auto">
            <div className="text-[#F87171]">[ERROR] 10:38:12.901 HikariPool-1 - Connection acquisition timed out after 1800ms.</div>
            <div className="text-[#9CA3AF]">[DEBUG] 10:38:12.902 Waiting threads on AuthHikariPool: 48 (pool size 20/20)</div>
            <div className="text-[#EF4444]">[WARN]  10:38:13.110 org.postgresql.util.PSQLException: FATAL: remaining connection slots reserved</div>
            <div className="text-[#6B7280]">[INFO]  10:38:13.115 Dropping downstream HTTP keep-alive connection fd=412 to ingress-nginx</div>
            <div className="text-[#34D399]">[INFO]  10:38:14.001 Health probe /healthz responded HTTP 503 Service Unavailable</div>
          </div>
        </div>
      )}
    </div>
  );
};
