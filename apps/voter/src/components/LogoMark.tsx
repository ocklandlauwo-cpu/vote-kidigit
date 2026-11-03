// Vote-Kidigit mark (Design System 2.2): a ballot paper with a tick entering a ballot box.
// Colours come from the --vk-logo-* tokens, so it adapts to light and dark.

interface LogoMarkProps {
  /** Rendered size in px (minimum 20; favicon 32). */
  size?: number;
}

export function LogoMark({ size = 32 }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={Math.max(size, 20)}
      height={Math.max(size, 20)}
      role="img"
      aria-label="Vote-Kidigit"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="9"
        y="2"
        width="14"
        height="16"
        rx="2"
        fill="var(--vk-logo-paper)"
        stroke="var(--vk-logo-ink)"
        strokeWidth="2"
      />
      <path
        d="M12.5 9.5l2.5 2.5 4.5-5"
        fill="none"
        stroke="var(--vk-logo-ink)"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="3" y="15" width="26" height="14" rx="3" fill="var(--vk-logo-ink)" />
      <rect x="8" y="15" width="16" height="2.5" rx="1.25" fill="var(--vk-logo-slot)" />
    </svg>
  );
}
