import React, { useState, useEffect } from 'react';
import { TelemetryLog } from '../../types/incident';
import { Terminal, Search, Pause, Play, Copy, Check, Filter } from 'lucide-react';

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

  // Simulate incoming live telemetry stream
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
    <div className="bg-[#111827] border border-[#374151] rounded-lg overflow-hidden flex flex-col">
      {/* Header with Search and Filter bar */}
      <div className="bg-[#151C27] border-b border-[#374151] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-[#3B82F6]" />
          <span className="text-xs font-mono font-semibold text-[#DCE2F3]">
            LIVE TELEMETRY STREAM
          </span>
          <span className="text-[11px] font-mono text-[#6B7280]">
            ({filteredLogs.length} events)
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Search bar conforming to design spec */}
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-[#6B7280] absolute left-2 pointer-events-none" />
            <input
              type="text"
              placeholder="Filter payload or source..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-[#080C13] border border-[#374151] focus:border-[#3B82F6] text-[#F9FAFB] text-xs font-mono pl-7 pr-3 py-1 rounded outline-none placeholder-[#4B5563] w-48 sm:w-64 transition-colors"
            />
          </div>

          {/* Severity filter buttons */}
          <div className="flex items-center bg-[#080C13] border border-[#374151] rounded p-0.5 text-xs font-mono">
            {(['ALL', 'CRIT', 'WARN', 'INFO'] as const).map((sev) => (
              <button
                key={sev}
                onClick={() => setSeverityFilter(sev)}
                className={`px-2 py-0.5 rounded transition-colors cursor-pointer text-[11px] ${
                  severityFilter === sev
                    ? 'bg-[#1F2937] text-white font-semibold'
                    : 'text-[#9CA3AF] hover:text-white'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>

          {/* Stream toggle */}
          <button
            onClick={() => setIsStreaming(!isStreaming)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono bg-[#1F2937] border border-[#374151] hover:border-[#4B5563] text-[#DCE2F3] rounded cursor-pointer transition-colors"
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

      {/* Log Rows - Strictly conforming to design doc */}
      <div className="bg-[#111827] max-h-[380px] overflow-y-auto divide-y divide-[#1F2937]">
        {filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-[#6B7280]">
            No telemetry records match current filters.
          </div>
        ) : (
          filteredLogs.map((log) => {
            const isCrit = log.severity === 'CRIT';
            const isWarn = log.severity === 'WARN';

            return (
              <div
                key={log.id}
                className="flex items-start gap-3 px-3 py-2 text-xs font-mono hover:bg-[#1F2937] transition-colors group cursor-default"
              >
                {/* Fixed-width Timestamp */}
                <div className="w-[84px] shrink-0 text-[#6B7280] text-[11px] tabular-nums pt-0.5">
                  {log.timestamp}
                </div>

                {/* Fixed-width Severity Indicator */}
                <div className="w-[52px] shrink-0 pt-0.5">
                  <span
                    className={`inline-block text-[10px] font-semibold px-1 py-0.2 rounded border ${
                      isCrit
                        ? 'bg-red-950/60 text-[#F87171] border-red-800'
                        : isWarn
                        ? 'bg-amber-950/60 text-[#FBBF24] border-amber-800'
                        : 'bg-slate-800 text-[#9CA3AF] border-slate-700'
                    }`}
                  >
                    {log.severity}
                  </span>
                </div>

                {/* Fixed-width Source Micro-badge */}
                <div className="w-[130px] shrink-0 truncate text-[#9CA3AF] text-[11px] pt-0.5">
                  <span className="bg-[#080C13] border border-[#1F2937] px-1.5 py-0.5 rounded text-[#C2C6D6]">
                    {log.source}
                  </span>
                </div>

                {/* Payload message in code-inline */}
                <div className="flex-1 text-[#E5E7EB] text-[12px] font-mono break-all pt-0.5 selection:bg-[#3B82F6]">
                  <code>{log.payload}</code>
                </div>

                {/* Quick copy affordance on hover */}
                <button
                  onClick={() => copyLog(log)}
                  className="opacity-0 group-hover:opacity-100 text-[#6B7280] hover:text-white transition-opacity shrink-0 cursor-pointer pt-0.5"
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
      <div className="bg-[#151C27] border-t border-[#374151] px-4 py-2 flex items-center justify-between text-[11px] font-mono text-[#6B7280]">
        <span>Ingestion Rate: 420 events/sec • Buffer: 100 rows</span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-none bg-[#10B981]" />
          Stream Connection Nominal
        </span>
      </div>
    </div>
  );
};
