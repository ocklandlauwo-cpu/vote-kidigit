// "siku 2, saa 3" / "2 days, 3 hours": the two largest units of a time span (App Flow 6.3
// countdown to opening). The span is rounded up to whole minutes first, so it never reads
// "23 hours, 60 minutes".
import type { TFunction } from 'i18next';

export function durationText(t: TFunction, ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts =
    days > 0
      ? [
          t('common.duration.days', { count: days }),
          hours > 0 ? t('common.duration.hours', { count: hours }) : '',
        ]
      : hours > 0
        ? [
            t('common.duration.hours', { count: hours }),
            minutes > 0 ? t('common.duration.minutes', { count: minutes }) : '',
          ]
        : [t('common.duration.minutes', { count: minutes })];
  return parts.filter(Boolean).join(', ');
}
