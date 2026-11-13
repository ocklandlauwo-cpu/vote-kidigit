/** A path inside the staff portal only: never another site (no open redirect). */
export function safeReturnTo(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
    ? value
    : '/';
}

/**
 * Navigation state after sign-in (App Flow 5.1): landing on the dashboard marks it, so a
 * moderator with one active event is taken to that event; a deep link is left alone.
 */
export function landingState(to: string): { landing: true } | undefined {
  return to === '/' ? { landing: true } : undefined;
}
