import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';
// Control heights of the design handoff: 26px, 28px and 32px.
type Size = 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    'bg-accent font-semibold text-on-accent hover:bg-accent-hover disabled:bg-surface-3 disabled:text-text-3',
  secondary:
    'border border-line-2 bg-surface font-medium text-text hover:border-text-3 disabled:opacity-50',
  ghost: 'font-medium text-text-2 hover:bg-surface-3 hover:text-text disabled:opacity-50',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-[26px] gap-[5px] px-[9px] text-xs',
  md: 'h-7 gap-1.5 px-2.5 text-[12.5px]',
  lg: 'h-8 gap-2 px-3 text-[13px]',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = 'primary',
  size = 'lg',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    />
  );
}
