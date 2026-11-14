import React from 'react';

export type ButtonVariant = 'primary' | 'destructive' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  icon,
  children,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center justify-center font-medium rounded-xl transition-all duration-150 whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B82F6]/60';

  const sizeStyles = {
    sm: 'text-xs px-3 py-1.5 gap-1.5 leading-4',
    md: 'text-xs px-4 py-2 gap-2 leading-4',
    lg: 'text-sm px-5 py-2.5 gap-2 leading-5',
  };

  const variantStyles = {
    primary:
      'bg-[#3B82F6] hover:bg-[#2563EB] active:bg-[#1D4ED8] text-white border border-white/10 shadow-[4px_4px_10px_rgba(14,16,21,0.45),-2px_-2px_6px_rgba(255,255,255,0.06)]',
    destructive:
      'bg-[#DC2626] hover:bg-[#B91C1C] active:bg-[#991B1B] text-white border border-white/10 shadow-[4px_4px_10px_rgba(14,16,21,0.45),-2px_-2px_6px_rgba(255,255,255,0.06)]',
    secondary:
      'neu-pill text-[var(--ip-text)] hover:border-[var(--ip-border-strong)] active:opacity-90',
    ghost:
      'bg-transparent text-[var(--ip-text-secondary)] hover:bg-[var(--ip-pill)] hover:text-[var(--ip-text)]',
  };

  return (
    <button
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
    </button>
  );
};
