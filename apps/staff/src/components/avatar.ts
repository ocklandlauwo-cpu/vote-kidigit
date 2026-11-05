// Initials and a stable tint for avatars (Design System 8.11).
const TONES = ['info', 'success', 'warning', 'violet', 'danger', 'neutral'] as const;

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export function avatarTone(userId: string): (typeof TONES)[number] {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length] ?? 'neutral';
}
