import React from 'react';
import {
  ServiceNode,
  MetricsStatusResponse,
  LogStatusResponse,
  TraceStatusResponse,
  ClaudeConfigStatus,
  SlackConfigStatus,
  WorkflowConfigStatus,
} from '../../types/incident';
import { AlertCircle, AlertTriangle, CheckCircle2, Server } from 'lucide-react';

interface ServiceHealthPanelProps {
  services: ServiceNode[];
  activeServiceName: string;
  isMitigated: boolean;
  metricsStatus: MetricsStatusResponse | null;
  logsStatus: LogStatusResponse | null;
  tracesStatus: TraceStatusResponse | null;
  claudeStatus: ClaudeConfigStatus | null;
  diagnosisSource: 'claude_live' | 'demo_fallback';
  workflowStatus: WorkflowConfigStatus | null;
  slackStatus: SlackConfigStatus | null;
}

export const ServiceHealthPanel: React.FC<ServiceHealthPanelProps> = ({
  services,
  activeServiceName,
  isMitigated,
  metricsStatus,
  logsStatus,
  tracesStatus,
  claudeStatus,
  diagnosisSource,
  workflowStatus,
  slackStatus,
}) => {
  const effectiveServices = services.map((svc) => {
    const isAffected =
      svc.name === activeServiceName ||
      (activeServiceName === 'auth-gateway-prod' &&
        (svc.name === 'ingress-nginx-lb' || svc.name === 'aurora-pg-cluster'));

    if (isMitigated && isAffected) {
      return {
        ...svc,
        status: 'nominal' as const,
        p99Ms: svc.name === 'aurora-pg-cluster' ? 16 : 42,
        errorRate: 0.1,
      };
    }
    return svc;
  });

  // Sort critical -> degraded -> nominal
  const order = { critical: 0, degraded: 1, nominal: 2 };
  const sortedServices = [...effectiveServices].sort((a, b) => order[a.status] - order[b.status]);

  const criticalCount = sortedServices.filter((s) => s.status === 'critical').length;
  const degradedCount = sortedServices.filter((s) => s.status === 'degraded').length;
  const healthyCount = sortedServices.filter((s) => s.status === 'nominal').length;

  const metricsLabel =
    metricsStatus?.provider === 'prometheus' && metricsStatus.connected
      ? 'LIVE'
      : metricsStatus?.provider === 'prometheus'
      ? 'UNAVAILABLE'
      : 'SIMULATED';

  const logsLabel =
    logsStatus?.provider === 'http' && logsStatus.connected
      ? 'LIVE'
      : logsStatus?.provider === 'http'
      ? 'UNAVAILABLE'
      : 'SIMULATED';

  const tracesLabel =
    tracesStatus?.provider === 'http' && tracesStatus.connected
      ? 'LIVE'
      : tracesStatus?.provider === 'http'
      ? 'UNAVAILABLE'
      : 'SIMULATED';

  return (
    <div className="neu-surface rounded-2xl p-5 flex flex-col justify-between gap-4 h-full min-w-0">
      <div className="space-y-4 min-w-0">
        {/* Panel Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--ip-border)]">
          <div className="flex items-center gap-2 min-w-0">
            <Server className="w-4 h-4 text-[#3B82F6] dark:text-[#60A5FA] shrink-0" />
            <h2 className="text-sm font-semibold text-[var(--ip-text)] tracking-tight">
              Service Health
            </h2>
          </div>

          <div className="flex items-center gap-2.5 text-[11px] font-mono tabular-nums">
            <span className="text-[#DC2626] dark:text-[#F87171] font-medium">
              {criticalCount} Crit
            </span>
            <span className="text-[var(--ip-text-muted)]">·</span>
            <span className="text-[#D97706] dark:text-[#FBBF24] font-medium">
              {degradedCount} Warn
            </span>
            <span className="text-[var(--ip-text-muted)]">·</span>
            <span className="text-[#059669] dark:text-[#34D399] font-medium">
              {healthyCount} Healthy
            </span>
          </div>
        </div>

        {/* Service Status List */}
        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-0.5">
          {sortedServices.map((svc) => {
            const isCrit = svc.status === 'critical';
            const isWarn = svc.status === 'degraded';
            const isTarget = svc.name === activeServiceName;

            return (
              <div
                key={svc.id}
                className={`neu-inset rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs font-mono ${
                  isTarget ? 'ring-1 ring-[#3B82F6]/35' : ''
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {isCrit ? (
                    <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0" />
                  ) : isWarn ? (
                    <AlertTriangle className="w-4 h-4 text-[#F59E0B] shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-semibold text-[var(--ip-text)] truncate">
                        {svc.name}
                      </span>
                      {isTarget && (
                        <span className="text-[10px] text-[#2563EB] dark:text-[#60A5FA] shrink-0">
                          (Target)
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-[var(--ip-text-muted)] truncate">
                      {svc.tier} · {svc.deployedVersion}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 tabular-nums">
                  <div className="text-right">
                    <div
                      className={
                        svc.p99Ms > 500
                          ? 'text-[#DC2626] dark:text-[#FCA5A5] font-semibold'
                          : svc.p99Ms > 200
                          ? 'text-[#D97706] dark:text-[#FCD34D] font-semibold'
                          : 'text-[var(--ip-text)]'
                      }
                    >
                      {svc.p99Ms}ms
                    </div>
                    <div className="text-[10px] text-[var(--ip-text-muted)]">
                      {svc.errorRate.toFixed(1)}% err
                    </div>
                  </div>

                  <span
                    className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-md border min-w-[74px] text-center ${
                      isCrit
                        ? 'bg-[#EF4444]/12 text-[#DC2626] dark:text-[#FCA5A5] border-[#EF4444]/35'
                        : isWarn
                        ? 'bg-[#F59E0B]/12 text-[#B45309] dark:text-[#FCD34D] border-[#F59E0B]/35'
                        : 'bg-[#10B981]/12 text-[#047857] dark:text-[#6EE7B7] border-[#10B981]/35'
                    }`}
                  >
                    {isCrit ? 'Critical' : isWarn ? 'Warning' : 'Healthy'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Telemetry Providers & Control Plane Readiness */}
      <div className="pt-3 border-t border-[var(--ip-border)] space-y-2">
        <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--ip-text-muted)]">
          Signal Provenance & Safety Controls
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] font-mono">
          <div className="neu-inset rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-1">
            <span className="text-[var(--ip-text-muted)]">Metrics</span>
            <span
              className={
                metricsLabel === 'LIVE'
                  ? 'text-[#047857] dark:text-[#34D399] font-semibold'
                  : metricsLabel === 'UNAVAILABLE'
                  ? 'text-[#DC2626] dark:text-[#F87171] font-semibold'
                  : 'text-[#B45309] dark:text-[#FBBF24] font-semibold'
              }
            >
              {metricsLabel}
            </span>
          </div>

          <div className="neu-inset rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-1">
            <span className="text-[var(--ip-text-muted)]">Logs</span>
            <span
              className={
                logsLabel === 'LIVE'
                  ? 'text-[#047857] dark:text-[#34D399] font-semibold'
                  : logsLabel === 'UNAVAILABLE'
                  ? 'text-[#DC2626] dark:text-[#F87171] font-semibold'
                  : 'text-[#B45309] dark:text-[#FBBF24] font-semibold'
              }
            >
              {logsLabel}
            </span>
          </div>

          <div className="neu-inset rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-1">
            <span className="text-[var(--ip-text-muted)]">Traces</span>
            <span
              className={
                tracesLabel === 'LIVE'
                  ? 'text-[#047857] dark:text-[#34D399] font-semibold'
                  : tracesLabel === 'UNAVAILABLE'
                  ? 'text-[#DC2626] dark:text-[#F87171] font-semibold'
                  : 'text-[#B45309] dark:text-[#FBBF24] font-semibold'
              }
            >
              {tracesLabel}
            </span>
          </div>

          <div className="neu-inset rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-1">
            <span className="text-[var(--ip-text-muted)]">AI</span>
            <span
              className={
                claudeStatus?.live_inference_working || diagnosisSource === 'claude_live'
                  ? 'text-[#047857] dark:text-[#34D399] font-semibold'
                  : 'text-[#B45309] dark:text-[#FBBF24] font-semibold'
              }
            >
              {claudeStatus?.live_inference_working || diagnosisSource === 'claude_live'
                ? 'LIVE'
                : 'FALLBACK'}
            </span>
          </div>

          <div className="neu-inset rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-1">
            <span className="text-[var(--ip-text-muted)]">Orch</span>
            <span
              className={
                workflowStatus?.ready !== false
                  ? 'text-[#047857] dark:text-[#34D399] font-semibold'
                  : 'text-[#DC2626] dark:text-[#F87171] font-semibold'
              }
            >
              {workflowStatus?.ready !== false ? 'READY' : 'OFFLINE'}
            </span>
          </div>

          <div className="neu-inset rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-1">
            <span className="text-[var(--ip-text-muted)]">Slack</span>
            <span
              className={
                slackStatus?.configured
                  ? 'text-[#047857] dark:text-[#34D399] font-semibold'
                  : 'text-[var(--ip-text-secondary)] font-semibold'
              }
            >
              {slackStatus?.configured ? 'READY' : 'STANDBY'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
