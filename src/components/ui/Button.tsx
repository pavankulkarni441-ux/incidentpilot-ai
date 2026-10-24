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
  const baseStyles = 'inline-flex items-center justify-center font-mono font-medium rounded transition-colors duration-150 whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#3B82F6]';

  const sizeStyles = {
    sm: 'text-[11px] px-2.5 py-1 gap-1.5 leading-4',
    md: 'text-[12px] px-3.5 py-1.5 gap-2 leading-4',
    lg: 'text-[13px] px-4 py-2 gap-2.5 leading-5',
  };

  const variantStyles = {
    primary: 'bg-[#3B82F6] hover:bg-[#2563EB] text-white active:bg-[#1D4ED8]',
    destructive: 'bg-[#EF4444] hover:bg-[#DC2626] text-white active:bg-[#B91C1C]',
    secondary: 'bg-transparent border border-[#374151] text-[#D1D5DB] hover:bg-[#1F2937] hover:border-[#4B5563] active:bg-[#283548]',
    ghost: 'bg-transparent text-[#9CA3AF] hover:bg-[#1F2937] hover:text-[#FFFFFF] active:bg-[#283548]',
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
