import React, { useState } from 'react';
import { PodMetric } from '../../types/incident';
import { Server, Terminal, X } from 'lucide-react';

interface PodHealthMatrixProps {
  pods: PodMetric[];
}

export const PodHealthMatrix: React.FC<PodHealthMatrixProps> = ({ pods }) => {
  const [inspectedPod, setInspectedPod] = useState<PodMetric | null>(null);
  const saturatedCount = pods.filter(
    (p) => p.status === 'Degraded' || p.activeConnections >= p.maxConnections
  ).length;
  const nominalCount = pods.length - saturatedCount;

  return (
    <div className="neu-surface rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="border-b border-[var(--ip-border)] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <Server className="w-4 h-4 text-[#3B82F6] dark:text-[#60A5FA] shrink-0" />
          <span className="text-xs font-mono font-semibold text-[var(--ip-text)] tracking-wide">
            KUBERNETES REPLICA POOL MATRIX
          </span>
          <span className="text-xs font-mono text-[var(--ip-text-muted)]">
            Deployment: <strong className="text-[var(--ip-text-secondary)]">auth-gateway-prod</strong> ({pods.length} Replicas)
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono text-[var(--ip-text-secondary)]">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 bg-[#EF4444] rounded-full" />
            {saturatedCount} Saturated
          </span>
          <span className="text-[var(--ip-border-strong)]">|</span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 bg-[#10B981] rounded-full" />
            {nominalCount} Nominal
          </span>
        </div>
      </div>

      {/* Pod Grid */}
      <div className="p-4 sm:p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 bg-[var(--ip-inset)]/60">
        {pods.map((pod) => {
          const isDegraded = pod.status === 'Degraded' || pod.activeConnections >= pod.maxConnections;
          return (
            <div
              key={pod.name}
              onClick={() => setInspectedPod(pod)}
              className={`neu-surface rounded-xl p-3.5 transition-all cursor-pointer hover:border-[var(--ip-border-strong)] ${
                isDegraded ? 'ring-1 ring-[#EF4444]/30' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-2.5 gap-2">
                <div className="flex items-center gap-2 font-mono text-xs font-medium min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      isDegraded ? 'bg-[#EF4444]' : 'bg-[#10B981]'
                    }`}
                  />
                  <span className="text-[var(--ip-text)] truncate">{pod.name}</span>
                </div>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-md border shrink-0 ${
                    isDegraded
                      ? 'bg-[#EF4444]/10 text-[#DC2626] dark:text-[#FCA5A5] border-[#EF4444]/25'
                      : 'bg-[#10B981]/10 text-[#047857] dark:text-[#6EE7B7] border-[#10B981]/25'
                  }`}
                >
                  {pod.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5 text-[11px] font-mono pt-2.5 border-t border-[var(--ip-border)]">
                <div>
                  <span className="text-[var(--ip-text-muted)] block text-[10px]">CPU Saturation</span>
                  <span
                    className={`font-semibold tabular-nums ${
                      pod.cpuUsage > 85 ? 'text-[#DC2626] dark:text-[#FCA5A5]' : 'text-[var(--ip-text)]'
                    }`}
                  >
                    {pod.cpuUsage.toFixed(1)}%
                  </span>
                </div>

                <div>
                  <span className="text-[var(--ip-text-muted)] block text-[10px]">DB Connections</span>
                  <span
                    className={`font-semibold tabular-nums ${
                      pod.activeConnections >= pod.maxConnections
                        ? 'text-[#DC2626] dark:text-[#FCA5A5]'
                        : 'text-[#047857] dark:text-[#6EE7B7]'
                    }`}
                  >
                    {pod.activeConnections} / {pod.maxConnections}
                  </span>
                </div>

                <div>
                  <span className="text-[var(--ip-text-muted)] block text-[10px]">Memory Allocated</span>
                  <span className="text-[var(--ip-text)] tabular-nums">
                    {pod.memoryMb}MB <span className="text-[var(--ip-text-muted)]">/ 1024MB</span>
                  </span>
                </div>

                <div>
                  <span className="text-[var(--ip-text-muted)] block text-[10px]">Restarts / Uptime</span>
                  <span className="text-[var(--ip-text)] tabular-nums">
                    {pod.restarts > 0 ? (
                      <span className="text-[#B45309] dark:text-[#FCD34D] font-semibold">{pod.restarts} (OOM)</span>
                    ) : (
                      '0'
                    )}{' '}
                    · <span className="text-[var(--ip-text-secondary)]">{pod.uptime}</span>
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Flyout Drawer for Pod Logs */}
      {inspectedPod && (
        <div className="border-t border-[var(--ip-border)] bg-[var(--ip-surface-alt)] p-4 sm:p-5">
          <div className="flex items-center justify-between pb-2.5 border-b border-[var(--ip-border)] mb-3 font-mono text-xs gap-2">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <Terminal className="w-3.5 h-3.5 text-[#3B82F6] dark:text-[#60A5FA] shrink-0" />
              <span className="text-[var(--ip-text)] font-semibold truncate">Pod Stdout Tail: {inspectedPod.name}</span>
              <span className="text-[var(--ip-text-muted)]">Container: auth-gateway</span>
            </div>
            <button
              onClick={() => setInspectedPod(null)}
              className="text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)] cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="neu-inset font-mono text-[11px] text-[var(--ip-text-secondary)] space-y-1 p-3.5 rounded-xl max-h-40 overflow-y-auto">
            <div className="text-[#DC2626] dark:text-[#FCA5A5]">[ERROR] 10:38:12.901 HikariPool-1 - Connection acquisition timed out after 1800ms.</div>
            <div>[DEBUG] 10:38:12.902 Waiting threads on AuthHikariPool: 48 (pool size 20/20)</div>
            <div className="text-[#B45309] dark:text-[#FCD34D]">[WARN]  10:38:13.110 org.postgresql.util.PSQLException: FATAL: remaining connection slots reserved</div>
            <div className="text-[var(--ip-text-muted)]">[INFO]  10:38:13.115 Dropping downstream HTTP keep-alive connection fd=412 to ingress-nginx</div>
            <div className="text-[#047857] dark:text-[#6EE7B7]">[INFO]  10:38:14.001 Health probe /healthz responded HTTP 503 Service Unavailable</div>
          </div>
        </div>
      )}
    </div>
  );
};
