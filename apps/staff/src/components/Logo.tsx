// Logo lockups (Design System 2.3). The wordmark is live text: "Vote-" in weight 500 and
// text-secondary, "Kidigit" in weight 700 and logo-ink, letter spacing -0.01em.
import { LogoMark } from './LogoMark';

export type LogoLockup = 'horizontal-large' | 'horizontal-small' | 'mark' | 'stacked';

/** Mark size, wordmark size and gap in px for each lockup (Design System 2.3). */
const LOCKUPS: Record<LogoLockup, { mark: number; word: number; gap: number }> = {
  'horizontal-large': { mark: 40, word: 24, gap: 12 },
  'horizontal-small': { mark: 28, word: 18, gap: 8 },
  mark: { mark: 28, word: 0, gap: 0 },
  stacked: { mark: 64, word: 28, gap: 12 },
};

interface LogoProps {
  lockup?: LogoLockup;
}

export function Logo({ lockup = 'horizontal-small' }: LogoProps) {
  const { mark, word, gap } = LOCKUPS[lockup];
  if (lockup === 'mark') return <LogoMark size={mark} />;

  return (
    <span
      style={{
        display: 'inline-flex',
        flexDirection: lockup === 'stacked' ? 'column' : 'row',
        alignItems: 'center',
        gap,
      }}
    >
      <LogoMark size={mark} />
      <span
        aria-hidden="true"
        style={{
          fontFamily: 'var(--vk-font-family)',
          fontSize: word,
          lineHeight: 1,
          letterSpacing: '-0.01em',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontWeight: 500, color: 'var(--vk-text-secondary)' }}>Vote-</span>
        <span style={{ fontWeight: 700, color: 'var(--vk-logo-ink)' }}>Kidigit</span>
      </span>
    </span>
  );
}
