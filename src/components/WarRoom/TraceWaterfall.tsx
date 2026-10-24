import React, { useState } from 'react';
import { TraceSpan } from '../../types/incident';
import { Clock, AlertCircle, CheckCircle2, Database, Layers, Copy, Check } from 'lucide-react';

interface TraceWaterfallProps {
  spans: TraceSpan[];
}

export const TraceWaterfall: React.FC<TraceWaterfallProps> = ({ spans }) => {
  const [selectedSpan, setSelectedSpan] = useState<TraceSpan>(spans[0]?.children?.[0]?.children?.[0] || spans[0]);
  const [copiedQuery, setCopiedQuery] = useState(false);
  const [viewMode, setViewMode] = useState<'waterfall' | 'flame'>('waterfall');

  const totalDuration = spans[0]?.durationMs || 1856;

  const copySql = (sql: string) => {
    navigator.clipboard.writeText(sql);
    setCopiedQuery(true);
    setTimeout(() => setCopiedQuery(false), 2000);
  };

  const renderSpanRow = (span: TraceSpan, depth = 0) => {
    const leftPercent = (span.startOffsetMs / totalDuration) * 100;
    const widthPercent = Math.max((span.durationMs / totalDuration) * 100, 2);
    const isSelected = selectedSpan?.id === span.id;

    return (
      <div key={span.id} className="group">
        <div
          onClick={() => setSelectedSpan(span)}
          className={`flex items-center text-xs font-mono py-2 px-3 border-b border-[#1F2937] hover:bg-[#1F2937]/70 cursor-pointer transition-colors ${
            isSelected ? 'bg-[#1F2937] border-l-2 border-l-[#3B82F6]' : ''
          }`}
        >
          {/* Service and operation name */}
          <div
            className="w-[300px] shrink-0 truncate flex items-center gap-2"
            style={{ paddingLeft: `${depth * 16}px` }}
          >
            {span.hasError ? (
              <AlertCircle className="w-3.5 h-3.5 text-[#EF4444] shrink-0" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
            )}
            <span className="font-semibold text-[#DCE2F3] truncate">{span.serviceName}</span>
            <span className="text-[#6B7280] text-[11px] truncate">{span.operationName}</span>
          </div>

          {/* Timing bar */}
          <div className="flex-1 px-4 relative h-6 flex items-center">
            {/* Background grid markings */}
            <div className="absolute inset-0 flex justify-between pointer-events-none opacity-15">
              <div className="border-r border-[#424754] h-full" />
              <div className="border-r border-[#424754] h-full" />
              <div className="border-r border-[#424754] h-full" />
              <div className="border-r border-[#424754] h-full" />
            </div>

            <div
              className={`h-4 rounded-[2px] transition-all relative flex items-center justify-end px-1.5 ${
                span.hasError
                  ? 'bg-[#EF4444]/80 text-[#FFF] shadow-[0_0_10px_rgba(239,68,68,0.3)]'
                  : 'bg-[#3B82F6]/80 text-[#FFF]'
              }`}
              style={{
                marginLeft: `${leftPercent}%`,
                width: `${widthPercent}%`,
                minWidth: '28px',
              }}
            >
              <span className="text-[10px] font-mono font-medium drop-shadow-sm whitespace-nowrap">
                {span.durationMs}ms
              </span>
            </div>
          </div>

          {/* Status code */}
          <div className="w-[60px] text-right shrink-0">
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                span.statusCode >= 500
                  ? 'bg-red-950/60 text-[#F87171] border border-red-800/50'
                  : 'bg-emerald-950/60 text-[#34D399] border border-emerald-800/50'
              }`}
            >
              {span.statusCode}
            </span>
          </div>
        </div>

        {/* Render child spans recursively */}
        {span.children?.map((child) => renderSpanRow(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="bg-[#111827] border border-[#374151] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-[#151C27] border-b border-[#374151] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-[#3B82F6]" />
          <span className="text-xs font-mono font-semibold text-[#DCE2F3]">
            DISTRIBUTED TRACE WATERFALL
          </span>
          <span className="text-xs font-mono text-[#6B7280]">
            Trace ID: <strong className="text-[#9CA3AF]">tr-8f4b1029-ee34</strong>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-[#080C13] border border-[#374151] rounded p-0.5 text-xs font-mono">
            <button
              onClick={() => setViewMode('waterfall')}
              className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                viewMode === 'waterfall' ? 'bg-[#3B82F6] text-white' : 'text-[#9CA3AF] hover:text-white'
              }`}
            >
              Waterfall
            </button>
            <button
              onClick={() => setViewMode('flame')}
              className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                viewMode === 'flame' ? 'bg-[#3B82F6] text-white' : 'text-[#9CA3AF] hover:text-white'
              }`}
            >
              Flame Graph
            </button>
          </div>

          <span className="text-xs font-mono text-[#F87171] bg-red-950/40 border border-red-900/60 px-2 py-0.5 rounded">
            Total Latency: {totalDuration}ms
          </span>
        </div>
      </div>

      {/* Main split: Waterfall vs Span Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#374151]">
        {/* Left: Waterfall / Flame view (8 cols) */}
        <div className="lg:col-span-8 bg-[#0B0F17] overflow-x-auto">
          {/* Time axis header */}
          <div className="flex items-center text-[11px] font-mono text-[#6B7280] py-2 px-3 border-b border-[#1F2937] bg-[#0E1420]">
            <div className="w-[300px] shrink-0">SERVICE / OPERATION</div>
            <div className="flex-1 px-4 flex justify-between">
              <span>0ms</span>
              <span>450ms</span>
              <span>900ms</span>
              <span>1350ms</span>
              <span>1856ms</span>
            </div>
            <div className="w-[60px] text-right shrink-0">STATUS</div>
          </div>

          {/* Span list */}
          <div>{spans.map((span) => renderSpanRow(span))}</div>
        </div>

        {/* Right: Selected Span Inspector Drawer (4 cols) */}
        <div className="lg:col-span-4 p-4 bg-[#111827] flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-[#1F2937]">
              <div className="text-[11px] font-mono text-[#9CA3AF] uppercase">Span Inspector</div>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                  selectedSpan.hasError
                    ? 'bg-red-950/60 text-[#F87171] border border-red-800'
                    : 'bg-emerald-950/60 text-[#34D399] border border-emerald-800'
                }`}
              >
                HTTP {selectedSpan.statusCode}
              </span>
            </div>

            <div>
              <div className="text-xs font-semibold text-[#F9FAFB] font-mono truncate">
                {selectedSpan.serviceName}
              </div>
              <div className="text-[11px] font-mono text-[#9CA3AF] truncate mt-0.5">
                {selectedSpan.operationName}
              </div>
            </div>

            {/* Timing KPI */}
            <div className="grid grid-cols-2 gap-2 bg-[#080C13] border border-[#1F2937] rounded p-2.5 text-xs font-mono">
              <div>
                <span className="text-[10px] text-[#6B7280] block">Span Duration</span>
                <span className={`text-sm font-semibold tabular-nums ${selectedSpan.hasError ? 'text-[#EF4444]' : 'text-[#3B82F6]'}`}>
                  {selectedSpan.durationMs}ms
                </span>
              </div>
              <div>
                <span className="text-[10px] text-[#6B7280] block">Start Offset</span>
                <span className="text-sm font-semibold text-[#DCE2F3] tabular-nums">
                  +{selectedSpan.startOffsetMs}ms
                </span>
              </div>
            </div>

            {/* SQL Query breakdown if database span */}
            {selectedSpan.sqlQuery && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-mono text-[#9CA3AF]">
                  <span className="flex items-center gap-1">
                    <Database className="w-3.5 h-3.5 text-[#ca8100]" />
                    Executed Statement
                  </span>
                  <button
                    onClick={() => copySql(selectedSpan.sqlQuery!)}
                    className="flex items-center gap-1 text-[10px] text-[#60A5FA] hover:underline cursor-pointer"
                  >
                    {copiedQuery ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedQuery ? 'Copied' : 'Copy SQL'}</span>
                  </button>
                </div>
                <div className="bg-[#080C13] border border-[#374151] rounded p-2 text-[11px] font-mono text-[#FFB95F] leading-relaxed overflow-x-auto">
                  <code>{selectedSpan.sqlQuery}</code>
                </div>
              </div>
            )}

            {/* Metadata Tags */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-mono text-[#9CA3AF] uppercase">Span Attributes & Tags</div>
              <div className="bg-[#080C13] border border-[#1F2937] rounded divide-y divide-[#1F2937] max-h-[160px] overflow-y-auto font-mono text-[11px]">
                {Object.entries(selectedSpan.tags).map(([key, val]) => (
                  <div key={key} className="flex items-start justify-between p-1.5 gap-2">
                    <span className="text-[#9CA3AF] truncate shrink-0">{key}:</span>
                    <span className="text-[#DCE2F3] truncate text-right">{val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-2 text-[10px] font-mono text-[#6B7280] border-t border-[#1F2937]">
            OpenTelemetry collector span # {selectedSpan.id}
          </div>
        </div>
      </div>
    </div>
  );
};
