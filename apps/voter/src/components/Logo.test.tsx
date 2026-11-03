import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Logo } from './Logo';
import { LogoMark } from './LogoMark';

describe('LogoMark', () => {
  it('is an accessible image coloured only by tokens', () => {
    const { container } = render(<LogoMark size={40} />);
    const svg = screen.getByRole('img', { name: 'Vote-Kidigit' });
    expect(svg).toHaveAttribute('width', '40');
    const fills = [...container.querySelectorAll('[fill],[stroke]')].flatMap((el) => [
      el.getAttribute('fill'),
      el.getAttribute('stroke'),
    ]);
    for (const value of fills.filter((v) => v && v !== 'none')) {
      expect(value).toMatch(/^var\(--vk-logo-(ink|paper|slot)\)$/);
    }
  });

  it('never renders below the 20 px minimum', () => {
    render(<LogoMark size={12} />);
    expect(screen.getByRole('img')).toHaveAttribute('width', '20');
  });
});

describe('Logo', () => {
  it('renders the wordmark as live text next to the mark', () => {
    const { container } = render(<Logo lockup="horizontal-large" />);
    expect(screen.getByRole('img', { name: 'Vote-Kidigit' })).toHaveAttribute('width', '40');
    expect(container.textContent).toBe('Vote-Kidigit');
  });

  it('renders only the mark for the mark lockup', () => {
    const { container } = render(<Logo lockup="mark" />);
    expect(container.textContent).toBe('');
    expect(screen.getByRole('img')).toHaveAttribute('width', '28');
  });
});
