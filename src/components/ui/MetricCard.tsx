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
  const min = Math.min(...sparklineData);
  const max = Math.max(...sparklineData);
  const range = max - min || 1;
  const height = 28;
  const width = 96;
  const step = width / Math.max(sparklineData.length - 1, 1);

  const points = sparklineData.map((val, idx) => {
    const x = idx * step;
    const y = height - ((val - min) / range) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const pathD = `M ${points.join(' L ')}`;

  const strokeColors = {
    red: '#EF4444',
    amber: '#F59E0B',
    emerald: '#10B981',
    blue: '#3B82F6',
  };

  const dotColors = {
    red: 'bg-[#EF4444]',
    amber: 'bg-[#F59E0B]',
    emerald: 'bg-[#10B981]',
    blue: 'bg-[#3B82F6]',
  };

  const changeColors = {
    positive: 'text-[#047857] dark:text-[#34D399]',
    negative: 'text-[#DC2626] dark:text-[#F87171]',
    neutral: 'text-[var(--ip-text-secondary)]',
  };

  return (
    <div
      className={`neu-surface rounded-2xl p-4 sm:p-5 flex flex-col justify-between transition-colors duration-150 min-w-0 ${className}`}
    >
      <div>
        <div className="flex items-center justify-between gap-2 text-xs text-[var(--ip-text-secondary)] mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2 h-2 rounded-full shrink-0 ${dotColors[statusColor]}`} />
            <span className="font-medium truncate">{label}</span>
          </div>
          {change && (
            <span className={`text-[11px] font-mono tabular-nums shrink-0 ${changeColors[changeType]}`}>
              {change}
            </span>
          )}
        </div>

        <div className="flex items-baseline gap-1.5 mt-1">
          <span className="text-2xl sm:text-[26px] font-semibold text-[var(--ip-text)] font-mono tabular-nums tracking-tight">
            {value}
          </span>
          {unit && <span className="text-xs font-mono text-[var(--ip-text-muted)] truncate">{unit}</span>}
        </div>
      </div>

      <div className="mt-3.5 pt-3 border-t border-[var(--ip-border)] flex items-center justify-between gap-3">
        <span className="text-[11px] font-mono text-[var(--ip-text-muted)] truncate">
          {annotation || 'Telemetry'}
        </span>
        <div className="w-[84px] h-[28px] shrink-0 overflow-hidden">
          <svg
            className="w-full h-full overflow-visible"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
          >
            <path
              d={pathD}
              fill="none"
              stroke={strokeColors[statusColor]}
              strokeWidth="1.85"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
};
