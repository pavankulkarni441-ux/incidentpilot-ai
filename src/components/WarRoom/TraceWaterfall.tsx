import React, { useState, useEffect, useMemo } from 'react';
import { TraceSpan, TraceEvidenceSummary, DistributedTraceItem } from '../../types/incident';
import { AlertCircle, CheckCircle2, Database, Layers, Copy, Check } from 'lucide-react';

interface TraceWaterfallProps {
  spans: TraceSpan[];
  traceEvidence?: TraceEvidenceSummary;
}

function buildSpanTreeFromDistributedTrace(trace: DistributedTraceItem): TraceSpan[] {
  const rootStartMs = Date.parse(trace.start_time) || 0;
  const nodeMap = new Map<string, TraceSpan>();

  for (const sp of trace.spans) {
    const startMs = Date.parse(sp.start_time);
    const offsetMs = Number.isFinite(startMs) && Number.isFinite(rootStartMs) ? Math.max(0, startMs - rootStartMs) : 0;
    const isSlow = sp.duration_ms >= trace.slow_threshold_ms;
    const tags: Record<string, string> = {
      trace_id: sp.trace_id,
      span_id: sp.span_id,
      parent_span_id: sp.parent_span_id || 'ROOT',
      start_time: sp.start_time,
      status: sp.status,
      data_source: sp.data_source,
      ...(isSlow ? { slow_span: `true (>=${trace.slow_threshold_ms}ms)` } : {}),
      ...(sp.error_message ? { error_message: sp.error_message } : {}),
    };

    const isSql =
      sp.service_name.includes('pg') ||
      sp.service_name.includes('db') ||
      /^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sp.operation_name);

    nodeMap.set(sp.span_id, {
      id: sp.span_id,
      serviceName: sp.service_name,
      operationName: sp.operation_name,
      durationMs: sp.duration_ms,
      startOffsetMs: offsetMs,
      statusCode: sp.status === 'ERROR' ? 500 : 200,
      hasError: sp.status === 'ERROR',
      tags,
      ...(isSql ? { sqlQuery: sp.operation_name } : {}),
      children: [],
    });
  }

  const roots: TraceSpan[] = [];
  for (const sp of trace.spans) {
    const node = nodeMap.get(sp.span_id)!;
    if (sp.parent_span_id && nodeMap.has(sp.parent_span_id)) {
      nodeMap.get(sp.parent_span_id)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function findDefaultSelectedSpan(spans: TraceSpan[]): TraceSpan | null {
  const flat: TraceSpan[] = [];
  const walk = (list: TraceSpan[]) => {
    for (const s of list) {
      flat.push(s);
      if (s.children?.length) walk(s.children);
    }
  };
  walk(spans);
  if (flat.length === 0) return null;
  const leafError = [...flat].reverse().find((s) => s.hasError);
  return leafError || flat[0];
}

export const TraceWaterfall: React.FC<TraceWaterfallProps> = ({ spans, traceEvidence }) => {
  const [activeTraceIdx, setActiveTraceIdx] = useState(0);
  const [copiedQuery, setCopiedQuery] = useState(false);
  const [viewMode, setViewMode] = useState<'waterfall' | 'flame'>('waterfall');

  const activeDistributedTrace: DistributedTraceItem | undefined =
    traceEvidence?.available && traceEvidence.traces.length > 0
      ? traceEvidence.traces[Math.min(activeTraceIdx, traceEvidence.traces.length - 1)]
      : undefined;

  const renderedSpans = useMemo<TraceSpan[]>(() => {
    if (traceEvidence) {
      if (!traceEvidence.available || !activeDistributedTrace) {
        return [];
      }
      return buildSpanTreeFromDistributedTrace(activeDistributedTrace);
    }
    return spans;
  }, [traceEvidence, activeDistributedTrace, spans]);

  const [selectedSpan, setSelectedSpan] = useState<TraceSpan | null>(() => findDefaultSelectedSpan(renderedSpans));

  useEffect(() => {
    setSelectedSpan(findDefaultSelectedSpan(renderedSpans));
  }, [renderedSpans]);

  useEffect(() => {
    setActiveTraceIdx(0);
  }, [traceEvidence?.service]);

  const totalDuration = activeDistributedTrace?.total_duration_ms || renderedSpans[0]?.durationMs || 0;
  const displayTraceId = activeDistributedTrace?.trace_id || (traceEvidence ? 'N/A' : 'tr-8f4b1029-ee34');

  const copySql = (sql: string) => {
    navigator.clipboard.writeText(sql);
    setCopiedQuery(true);
    setTimeout(() => setCopiedQuery(false), 2000);
  };

  const renderSpanRow = (span: TraceSpan, depth = 0) => {
    const safeTotal = Math.max(totalDuration, 1);
    const leftPercent = Math.min((span.startOffsetMs / safeTotal) * 100, 96);
    const widthPercent = Math.max(Math.min((span.durationMs / safeTotal) * 100, 100 - leftPercent), 2);
    const isSelected = selectedSpan?.id === span.id;
    const isSlow = span.tags.slow_span !== undefined;

    return (
      <div key={span.id} className="group">
        <div
          onClick={() => setSelectedSpan(span)}
          className={`flex items-center text-xs font-mono py-2.5 px-3 border-b border-[var(--ip-border)] hover:bg-[var(--ip-pill)]/50 cursor-pointer transition-colors ${
            isSelected ? 'bg-[var(--ip-pill)] ring-1 ring-inset ring-[#3B82F6]/35' : ''
          }`}
        >
          {/* Service and operation name */}
          <div
            className="w-[230px] sm:w-[280px] shrink-0 truncate flex items-center gap-2"
            style={{ paddingLeft: `${depth * 14}px` }}
          >
            {span.hasError ? (
              <AlertCircle className="w-3.5 h-3.5 text-[#EF4444] shrink-0" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
            )}
            <span className="font-semibold text-[var(--ip-text)] truncate">{span.serviceName}</span>
            <span className="text-[var(--ip-text-muted)] text-[11px] truncate">{span.operationName}</span>
          </div>

          {/* Timing bar */}
          <div className="flex-1 min-w-[160px] px-4 relative h-6 flex items-center">
            <div className="absolute inset-0 flex justify-between pointer-events-none opacity-15">
              <div className="border-r border-[var(--ip-text-muted)] h-full" />
              <div className="border-r border-[var(--ip-text-muted)] h-full" />
              <div className="border-r border-[var(--ip-text-muted)] h-full" />
              <div className="border-r border-[var(--ip-text-muted)] h-full" />
            </div>

            <div
              className={`h-4 rounded transition-all relative flex items-center justify-end px-1.5 ${
                span.hasError
                  ? 'bg-[#EF4444]/85 text-white'
                  : isSlow
                  ? 'bg-[#F59E0B]/85 text-white'
                  : 'bg-[#3B82F6]/85 text-white'
              }`}
              style={{
                marginLeft: `${leftPercent}%`,
                width: `${widthPercent}%`,
                minWidth: '28px',
              }}
            >
              <span className="text-[10px] font-mono font-medium whitespace-nowrap">
                {span.durationMs}ms
              </span>
            </div>
          </div>

          {/* Status */}
          <div className="w-[70px] text-right shrink-0">
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono border ${
                span.hasError
                  ? 'bg-[#EF4444]/10 text-[#DC2626] dark:text-[#FCA5A5] border-[#EF4444]/25'
                  : 'bg-[#10B981]/10 text-[#047857] dark:text-[#6EE7B7] border-[#10B981]/25'
              }`}
            >
              {span.tags.status || span.statusCode}
            </span>
          </div>
        </div>

        {span.children?.map((child) => renderSpanRow(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="neu-surface rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="border-b border-[var(--ip-border)] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <Layers className="w-4 h-4 text-[#3B82F6] dark:text-[#60A5FA] shrink-0" />
          <span className="text-xs font-mono font-semibold text-[var(--ip-text)] tracking-wide">
            DISTRIBUTED TRACE WATERFALL
          </span>
          {traceEvidence && (
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded-md border ${
                !traceEvidence.available
                  ? 'text-[#DC2626] dark:text-[#FCA5A5] bg-[#EF4444]/10 border-[#EF4444]/25'
                  : traceEvidence.data_source === 'LIVE'
                  ? 'text-[#047857] dark:text-[#6EE7B7] bg-[#10B981]/10 border-[#10B981]/25'
                  : 'text-[#B45309] dark:text-[#FCD34D] bg-[#F59E0B]/10 border-[#F59E0B]/25'
              }`}
            >
              {!traceEvidence.available
                ? `${traceEvidence.data_source} UNAVAILABLE`
                : `${traceEvidence.data_source} · ${traceEvidence.provider.toUpperCase()}`}
            </span>
          )}
          <span className="text-xs font-mono text-[var(--ip-text-muted)] truncate">
            Trace ID: <strong className="text-[var(--ip-text-secondary)]">{displayTraceId}</strong>
          </span>
          {traceEvidence?.available && traceEvidence.traces.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 ml-1">
              {traceEvidence.traces.map((tr, idx) => (
                <button
                  key={tr.trace_id}
                  onClick={() => setActiveTraceIdx(idx)}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-md border cursor-pointer transition-colors ${
                    idx === activeTraceIdx
                      ? 'bg-[#3B82F6]/15 text-[#2563EB] dark:text-[#93C5FD] border-[#3B82F6]/35'
                      : 'neu-inset text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)]'
                  }`}
                >
                  #{idx + 1} ({tr.status})
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center neu-inset rounded-lg p-0.5 text-xs font-mono">
            <button
              onClick={() => setViewMode('waterfall')}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                viewMode === 'waterfall' ? 'neu-pill text-[var(--ip-text)] font-medium' : 'text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)]'
              }`}
            >
              Waterfall
            </button>
            <button
              onClick={() => setViewMode('flame')}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                viewMode === 'flame' ? 'neu-pill text-[var(--ip-text)] font-medium' : 'text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)]'
              }`}
            >
              Flame Graph
            </button>
          </div>

          <span className="text-xs font-mono text-[#DC2626] dark:text-[#FCA5A5] bg-[#EF4444]/10 border border-[#EF4444]/25 px-2.5 py-1 rounded-lg">
            Total Latency: {totalDuration}ms
          </span>
        </div>
      </div>

      {traceEvidence && !traceEvidence.available ? (
        <div className="p-5 bg-[var(--ip-inset)] text-xs font-mono text-[#DC2626] dark:text-[#FCA5A5]">
          External distributed trace source unavailable ({traceEvidence.unavailable_reason || 'provider error'}). Missing spans were not invented.
        </div>
      ) : renderedSpans.length === 0 ? (
        <div className="p-5 bg-[var(--ip-inset)] text-xs font-mono text-[var(--ip-text-secondary)]">
          No distributed traces observed for {traceEvidence?.service || 'service'} in the active window ({traceEvidence?.since || '30m'}).
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[var(--ip-border)]">
          {/* Left: Waterfall */}
          <div className="lg:col-span-8 min-w-0 bg-[var(--ip-inset)] overflow-x-auto">
            <div className="flex items-center text-[11px] font-mono text-[var(--ip-text-muted)] py-2.5 px-3 border-b border-[var(--ip-border)] bg-[var(--ip-surface-alt)] min-w-[480px]">
              <div className="w-[230px] sm:w-[280px] shrink-0">SERVICE / OPERATION</div>
              <div className="flex-1 min-w-[160px] px-4 flex justify-between">
                <span>0ms</span>
                <span>{Math.round(totalDuration * 0.25)}ms</span>
                <span>{Math.round(totalDuration * 0.5)}ms</span>
                <span>{Math.round(totalDuration * 0.75)}ms</span>
                <span>{totalDuration}ms</span>
              </div>
              <div className="w-[70px] text-right shrink-0">STATUS</div>
            </div>

            <div className="min-w-[480px]">{renderedSpans.map((span) => renderSpanRow(span))}</div>
          </div>

          {/* Right: Selected Span Inspector */}
          {selectedSpan && (
            <div className="lg:col-span-4 min-w-0 p-4 sm:p-5 bg-[var(--ip-surface)] flex flex-col justify-between space-y-4">
              <div className="space-y-3.5">
                <div className="flex items-center justify-between pb-2.5 border-b border-[var(--ip-border)]">
                  <div className="text-[11px] font-mono text-[var(--ip-text-secondary)] uppercase tracking-wider">
                    Span Inspector
                  </div>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-md border ${
                      selectedSpan.hasError
                        ? 'bg-[#EF4444]/10 text-[#DC2626] dark:text-[#FCA5A5] border-[#EF4444]/25'
                        : 'bg-[#10B981]/10 text-[#047857] dark:text-[#6EE7B7] border-[#10B981]/25'
                    }`}
                  >
                    {selectedSpan.tags.status || `HTTP ${selectedSpan.statusCode}`}
                  </span>
                </div>

                <div>
                  <div className="text-xs font-semibold text-[var(--ip-text)] font-mono truncate">
                    {selectedSpan.serviceName}
                  </div>
                  <div className="text-[11px] font-mono text-[var(--ip-text-secondary)] truncate mt-0.5">
                    {selectedSpan.operationName}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 neu-inset rounded-xl p-3 text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-[var(--ip-text-muted)] block">Span Duration</span>
                    <span
                      className={`text-sm font-semibold tabular-nums ${
                        selectedSpan.hasError ? 'text-[#DC2626] dark:text-[#FCA5A5]' : 'text-[#2563EB] dark:text-[#60A5FA]'
                      }`}
                    >
                      {selectedSpan.durationMs}ms
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[var(--ip-text-muted)] block">Start Offset</span>
                    <span className="text-sm font-semibold text-[var(--ip-text)] tabular-nums">
                      +{selectedSpan.startOffsetMs}ms
                    </span>
                  </div>
                </div>

                {selectedSpan.sqlQuery && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono text-[var(--ip-text-secondary)]">
                      <span className="flex items-center gap-1.5">
                        <Database className="w-3.5 h-3.5 text-[#F59E0B]" />
                        Executed Statement
                      </span>
                      <button
                        onClick={() => copySql(selectedSpan.sqlQuery!)}
                        className="flex items-center gap-1 text-[10px] text-[#2563EB] dark:text-[#60A5FA] hover:underline cursor-pointer"
                      >
                        {copiedQuery ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedQuery ? 'Copied' : 'Copy SQL'}</span>
                      </button>
                    </div>
                    <div className="neu-inset rounded-xl p-2.5 text-[11px] font-mono text-[#B45309] dark:text-[#FCD34D] leading-relaxed overflow-x-auto">
                      <code>{selectedSpan.sqlQuery}</code>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="text-[11px] font-mono text-[var(--ip-text-secondary)] uppercase tracking-wider">
                    Span Attributes & Tags
                  </div>
                  <div className="neu-inset rounded-xl divide-y divide-[var(--ip-border)] max-h-[160px] overflow-y-auto font-mono text-[11px]">
                    {Object.entries(selectedSpan.tags).map(([key, val]) => (
                      <div key={key} className="flex items-start justify-between p-2 gap-2">
                        <span className="text-[var(--ip-text-secondary)] truncate shrink-0">{key}:</span>
                        <span className="text-[var(--ip-text)] break-words text-right">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-2.5 text-[10px] font-mono text-[var(--ip-text-muted)] border-t border-[var(--ip-border)]">
                Trace span # {selectedSpan.id} · Provenance: {selectedSpan.tags.data_source || 'SIMULATED'}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
