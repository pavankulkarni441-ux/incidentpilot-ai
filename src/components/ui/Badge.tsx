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
  const baseClasses =
    'inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] font-mono font-medium rounded-lg tracking-wide uppercase tabular-nums border whitespace-nowrap shrink-0';

  if (variant === 'ai-hypothesis') {
    return (
      <span
        className={`${baseClasses} bg-[#3B82F6]/12 border-[#3B82F6]/35 text-[#2563EB] dark:text-[#60A5FA] ${className}`}
      >
        <span className="w-1.5 h-1.5 bg-[#3B82F6] rounded-full shrink-0" />
        <span>{children || 'AI HYPOTHESIS'}</span>
        {confidence !== undefined && (
          <span className="text-[#1D4ED8] dark:text-[#93C5FD] font-semibold border-l border-[#3B82F6]/30 pl-1.5 ml-0.5">
            CONF {confidence.toFixed(1)}%
          </span>
        )}
      </span>
    );
  }

  if (variant === 'critical') {
    return (
      <span
        className={`${baseClasses} bg-[#EF4444]/12 border-[#EF4444]/35 text-[#DC2626] dark:text-[#FCA5A5] ${className}`}
      >
        <span className="w-1.5 h-1.5 bg-[#EF4444] rounded-full shrink-0" />
        <span>{children}</span>
      </span>
    );
  }

  if (variant === 'warning') {
    return (
      <span
        className={`${baseClasses} bg-[#F59E0B]/12 border-[#F59E0B]/35 text-[#B45309] dark:text-[#FCD34D] ${className}`}
      >
        {showSquare && <span className="w-1.5 h-1.5 bg-[#F59E0B] rounded-full shrink-0" />}
        <span>{children}</span>
      </span>
    );
  }

  if (variant === 'healthy') {
    return (
      <span
        className={`${baseClasses} bg-[#10B981]/12 border-[#10B981]/35 text-[#047857] dark:text-[#6EE7B7] ${className}`}
      >
        {showSquare && <span className="w-1.5 h-1.5 bg-[#10B981] rounded-full shrink-0" />}
        <span>{children}</span>
      </span>
    );
  }

  return (
    <span
      className={`${baseClasses} bg-[var(--ip-pill)] border-[var(--ip-border-strong)] text-[var(--ip-text-secondary)] ${className}`}
    >
      <span>{children}</span>
    </span>
  );
};
