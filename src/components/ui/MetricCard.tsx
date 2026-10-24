import React from 'react';

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  statusColor?: 'red' | 'amber' | 'emerald' | 'blue';
  sparklineData?: number[];
  annotation?: string;
  className?: string;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  unit,
  change,
  changeType = 'neutral',
  statusColor = 'blue',
  sparklineData = [12, 14, 13, 17, 24, 38, 45, 62, 85, 94],
  annotation,
  className = '',
}) => {
  // Generate SVG path for sparkline
  const min = Math.min(...sparklineData);
  const max = Math.max(...sparklineData);
  const range = max - min || 1;
  const height = 28;
  const width = 120;
  const step = width / (sparklineData.length - 1);

  const points = sparklineData.map((val, idx) => {
    const x = idx * step;
    const y = height - ((val - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const pathD = `M ${points.join(' L ')}`;

  const strokeColors = {
    red: '#EF4444',
    amber: '#F59E0B',
    emerald: '#10B981',
    blue: '#3B82F6',
  };

  const changeColors = {
    positive: 'text-[#10B981]',
    negative: 'text-[#EF4444]',
    neutral: 'text-[#9CA3AF]',
  };

  return (
    <div
      className={`bg-[#111827] border border-[#374151] hover:border-[#4B5563] rounded-lg p-4 transition-colors duration-150 flex flex-col justify-between ${className}`}
    >
      <div>
        <div className="flex items-center justify-between text-xs text-[#9CA3AF] mb-1.5">
          <span className="font-normal tracking-wide">{label}</span>
          {change && (
            <span className={`text-[11px] font-mono tabular-nums ${changeColors[changeType]}`}>
              {change}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold text-[#F9FAFB] font-mono tabular-nums tracking-tight">
            {value}
          </span>
          {unit && <span className="text-xs font-mono text-[#9CA3AF]">{unit}</span>}
        </div>
      </div>

      <div className="mt-3 pt-2 border-t border-[#1F2937] flex items-center justify-between">
        {annotation ? (
          <span className="text-[11px] font-mono text-[#6B7280] truncate">{annotation}</span>
        ) : (
          <span className="text-[11px] font-mono text-[#6B7280]">Real-time Telemetry</span>
        )}
        <div className="w-[100px] h-[28px] overflow-hidden">
          <svg
            className="w-full h-full overflow-visible"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
          >
            <path
              d={pathD}
              fill="none"
              stroke={strokeColors[statusColor]}
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
};
