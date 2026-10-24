import React from 'react';

export type BadgeVariant = 'critical' | 'warning' | 'healthy' | 'ai-hypothesis' | 'neutral';

interface BadgeProps {
  variant: BadgeVariant;
  confidence?: number;
  showSquare?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  variant,
  confidence,
  showSquare = false,
  children,
  className = '',
}) => {
  const baseClasses = 'inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono font-medium rounded tracking-wide uppercase tabular-nums border whitespace-nowrap shrink-0';

  if (variant === 'ai-hypothesis') {
    return (
      <span
        className={`${baseClasses} bg-[rgba(59,130,246,0.12)] border-[rgba(59,130,246,0.4)] text-[#60A5FA] ${className}`}
      >
        <span className="w-1.5 h-1.5 bg-[#3B82F6] rounded-none shrink-0" />
        <span>{children || 'AI HYPOTHESIS'}</span>
        {confidence !== undefined && (
          <span className="text-[#93C5FD] font-semibold border-l border-[rgba(59,130,246,0.3)] pl-1.5 ml-0.5">
            CONF: {confidence.toFixed(1)}%
          </span>
        )}
      </span>
    );
  }

  if (variant === 'critical') {
    return (
      <span
        className={`${baseClasses} bg-[rgba(239,68,68,0.12)] border-[rgba(239,68,68,0.4)] text-[#F87171] ${className}`}
      >
        <span className="w-1.5 h-1.5 bg-[#EF4444] rounded-none shrink-0" />
        <span>{children}</span>
      </span>
    );
  }

  if (variant === 'warning') {
    return (
      <span
        className={`${baseClasses} bg-[rgba(245,158,11,0.12)] border-[rgba(245,158,11,0.4)] text-[#FBBF24] ${className}`}
      >
        {showSquare && <span className="w-1.5 h-1.5 bg-[#F59E0B] rounded-none shrink-0" />}
        <span>{children}</span>
      </span>
    );
  }

  if (variant === 'healthy') {
    return (
      <span
        className={`${baseClasses} bg-[rgba(16,185,129,0.12)] border-[rgba(16,185,129,0.4)] text-[#34D399] ${className}`}
      >
        {showSquare && <span className="w-1.5 h-1.5 bg-[#10B981] rounded-none shrink-0" />}
        <span>{children}</span>
      </span>
    );
  }

  // neutral
  return (
    <span
      className={`${baseClasses} bg-[#1F2937] border-[#374151] text-[#9CA3AF] ${className}`}
    >
      <span>{children}</span>
    </span>
  );
};
