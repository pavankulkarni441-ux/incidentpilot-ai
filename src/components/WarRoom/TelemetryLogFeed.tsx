import React, { useState, useEffect } from 'react';
import { TelemetryLog } from '../../types/incident';
import { Terminal, Search, Pause, Play, Copy, Check } from 'lucide-react';

interface TelemetryLogFeedProps {
  initialLogs: TelemetryLog[];
  isMitigated?: boolean;
}

export const TelemetryLogFeed: React.FC<TelemetryLogFeedProps> = ({ initialLogs, isMitigated = false }) => {
  const [logs, setLogs] = useState<TelemetryLog[]>(initialLogs);
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'ALL' | 'CRIT' | 'WARN' | 'INFO'>('ALL');
  const [isStreaming, setIsStreaming] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isStreaming) return;

    const interval = setInterval(() => {
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');

      let newLog: TelemetryLog;

      if (isMitigated) {
        const nominalMessages = [
          { sev: 'INFO' as const, src: 'auth-gw-canary', msg: 'HikariCP active connections stabilized at 14/60. Acquisition latency: 2.4ms.' },
          { sev: 'INFO' as const, src: 'ingress-nginx', msg: 'upstream response status 200 OK, request: "POST /v1/oauth2/token/verify", upstream_response_time: 0.042s' },
          { sev: 'INFO' as const, src: 'aurora-pg-master', msg: 'token revocation query resolved from Redis cache bitset in 0.8ms' },
          { sev: 'INFO' as const, src: 'datadog-agent', msg: 'Monitor [auth-gateway.p99_latency] returned to normal baseline (42ms < 500ms).' },
        ];
        const pick = nominalMessages[Math.floor(Math.random() * nominalMessages.length)];
        newLog = {
          id: `log-${Date.now()}`,
          timestamp: timeStr,
          severity: pick.sev,
          source: pick.src,
          payload: pick.msg,
        };
      } else {
        const errorMessages = [
          { sev: 'CRIT' as const, src: 'auth-gw-78b9c', msg: 'HikariPool-1 - Connection acquisition timed out after 1800ms. Waiting queue: 54' },
          { sev: 'CRIT' as const, src: 'ingress-nginx', msg: 'upstream timed out (110: Operation timed out) while reading response header' },
          { sev: 'WARN' as const, src: 'pg-bouncer-01', msg: 'max client connections (100) reached for database auth_tokens_db' },
          { sev: 'WARN' as const, src: 'aurora-pg-master', msg: 'checkpoint starting: time checkpoint due; 421 dirty buffers queued' },
          { sev: 'INFO' as const, src: 'envoy-mesh', msg: 'circuit breaker trip threshold approached on cluster auth-gateway (94%)' },
        ];
        const pick = errorMessages[Math.floor(Math.random() * errorMessages.length)];
        newLog = {
          id: `log-${Date.now()}`,
          timestamp: timeStr,
          severity: pick.sev,
          source: pick.src,
          payload: pick.msg,
        };
      }

      setLogs((prev) => [newLog, ...prev.slice(0, 99)]);
    }, 2800);

    return () => clearInterval(interval);
  }, [isStreaming, isMitigated]);

  const copyLog = (log: TelemetryLog) => {
    navigator.clipboard.writeText(`[${log.timestamp}] [${log.severity}] [${log.source}] ${log.payload}`);
    setCopiedId(log.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredLogs = logs.filter((log) => {
    const matchesSev = severityFilter === 'ALL' || log.severity === severityFilter;
    const matchesQuery =
      searchQuery.trim() === '' ||
      log.payload.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.source.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSev && matchesQuery;
  });

  return (
    <div className="neu-surface rounded-2xl overflow-hidden flex flex-col">
      {/* Header */}
      <div className="border-b border-[var(--ip-border)] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Terminal className="w-4 h-4 text-[#3B82F6] dark:text-[#60A5FA] shrink-0" />
          <span className="text-xs font-mono font-semibold text-[var(--ip-text)] tracking-wide">
            LIVE TELEMETRY STREAM
          </span>
          <span className="text-[11px] font-mono text-[var(--ip-text-muted)]">
            ({filteredLogs.length} events)
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
          <div className="relative flex items-center flex-1 sm:flex-initial min-w-0">
            <Search className="w-3.5 h-3.5 text-[var(--ip-text-muted)] absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Filter payload or source..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="neu-inset focus:border-[#3B82F6]/50 text-[var(--ip-text)] text-xs font-mono pl-8 pr-3 py-1.5 rounded-lg outline-none placeholder-[var(--ip-text-muted)] w-full sm:w-64 transition-colors"
            />
          </div>

          <div className="flex items-center neu-inset rounded-lg p-0.5 text-xs font-mono">
            {(['ALL', 'CRIT', 'WARN', 'INFO'] as const).map((sev) => (
              <button
                key={sev}
                onClick={() => setSeverityFilter(sev)}
                className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer text-[11px] ${
                  severityFilter === sev
                    ? 'neu-pill text-[var(--ip-text)] font-semibold'
                    : 'text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)]'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>

          <button
            onClick={() => setIsStreaming(!isStreaming)}
            className="neu-pill flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-[var(--ip-text)] rounded-lg cursor-pointer transition-colors"
          >
            {isStreaming ? (
              <>
                <Pause className="w-3.5 h-3.5 text-[#F59E0B]" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 text-[#10B981]" />
                <span>Resume</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Log Rows */}
      <div className="bg-[var(--ip-inset)]/70 max-h-[380px] overflow-y-auto divide-y divide-[var(--ip-border)]">
        {filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-[var(--ip-text-muted)]">
            No telemetry records match current filters.
          </div>
        ) : (
          filteredLogs.map((log) => {
            const isCrit = log.severity === 'CRIT';
            const isWarn = log.severity === 'WARN';

            return (
              <div
                key={log.id}
                className="flex flex-wrap sm:flex-nowrap items-start gap-2.5 sm:gap-3 px-4 py-2.5 text-xs font-mono hover:bg-[var(--ip-pill)]/50 transition-colors group cursor-default"
              >
                <div className="w-[82px] shrink-0 text-[var(--ip-text-muted)] text-[11px] tabular-nums pt-0.5">
                  {log.timestamp}
                </div>

                <div className="w-[52px] shrink-0 pt-0.5">
                  <span
                    className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${
                      isCrit
                        ? 'bg-[#EF4444]/10 text-[#DC2626] dark:text-[#FCA5A5] border-[#EF4444]/25'
                        : isWarn
                        ? 'bg-[#F59E0B]/10 text-[#B45309] dark:text-[#FCD34D] border-[#F59E0B]/25'
                        : 'bg-[var(--ip-pill)] text-[var(--ip-text-secondary)] border-[var(--ip-border)]'
                    }`}
                  >
                    {log.severity}
                  </span>
                </div>

                <div className="w-[125px] shrink-0 truncate text-[11px] pt-0.5">
                  <span className="neu-inset px-2 py-0.5 rounded-md text-[var(--ip-text-secondary)]">
                    {log.source}
                  </span>
                </div>

                <div className="flex-1 min-w-0 text-[var(--ip-text)] text-[12px] font-mono break-words pt-0.5 selection:bg-[#3B82F6]">
                  <code>{log.payload}</code>
                </div>

                <button
                  onClick={() => copyLog(log)}
                  className="opacity-60 sm:opacity-0 group-hover:opacity-100 text-[var(--ip-text-muted)] hover:text-[var(--ip-text)] transition-opacity shrink-0 cursor-pointer pt-0.5"
                  title="Copy log entry"
                >
                  {copiedId === log.id ? (
                    <Check className="w-3.5 h-3.5 text-[#10B981]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Footer bar */}
      <div className="border-t border-[var(--ip-border)] px-5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[var(--ip-text-muted)]">
        <span>Ingestion Rate: 420 events/sec · Buffer: 100 rows</span>
        <span className="flex items-center gap-1.5 text-[var(--ip-text-secondary)]">
          <span className="w-2 h-2 rounded-full bg-[#10B981]" />
          Stream Connection Nominal
        </span>
      </div>
    </div>
  );
};
