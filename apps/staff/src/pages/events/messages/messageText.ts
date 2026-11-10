// Small helpers of the Messages tab (EVT-07).
import type { Batch, MessageType } from '@vote-kidigit/shared';

/** Characters in one SMS: 160 in the GSM alphabet, 70 once any other character is used. */
export function counterLimit(encoding: 'gsm7' | 'ucs2'): number {
  return encoding === 'gsm7' ? 160 : 70;
}

/** App Flow 6.7: the cards, in this order. */
export const TEMPLATE_ORDER: MessageType[] = [
  'code_delivery',
  'reminder_before_open',
  'voting_open',
  'reminder_before_close',
  'vote_confirmation',
  'results_published',
  'event_cancelled',
  'event_extended',
];

export function isActive(batch: Batch): boolean {
  return batch.status === 'queued' || batch.status === 'sending' || batch.status === 'paused';
}

/** Messages that failed in a paused or finished batch can be sent again. */
export function mayResendFailed(batch: Batch): boolean {
  return batch.failedCount > 0 && batch.status !== 'queued' && batch.status !== 'sending';
}

/** A message waiting to be sent shows as "Not sent" (Design System 3.3 Code / SMS). */
export function codeBadge(status: 'queued' | 'sent' | 'delivered' | 'failed') {
  return status === 'queued' ? 'not_sent' : status;
}
