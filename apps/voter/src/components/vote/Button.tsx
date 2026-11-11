// Voter buttons (Design System 7.1 on the voter scale): primary, secondary and tertiary, sizes L
// (48 px, full width in the action bar) and S. Loading keeps the label and disables the button.
import { LoadingOutlined } from '@ant-design/icons';
import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'tertiary';
  size?: 'L' | 'S';
  block?: boolean;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'L',
  block = false,
  loading = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'vk-btn',
    `vk-btn--${variant}`,
    size === 'S' ? 'vk-btn--s' : '',
    block ? 'w-full' : '',
    className,
  ].join(' ');
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <LoadingOutlined aria-hidden />}
      {children}
    </button>
  );
}
