import type { EventStatus, MessageType } from '../../generated/prisma/enums.js';

/**
 * In which event states a message type may go out. Checked when a batch is started, resumed or
 * resent, and again by the worker before each send: a code must not reach a voter after the
 * event was cancelled or closed.
 */
const SENDABLE: Record<MessageType, readonly EventStatus[]> = {
  code_delivery: ['scheduled', 'open'],
  reminder_before_open: ['scheduled'],
  voting_open: ['open'],
  reminder_before_close: ['open'],
  vote_confirmation: ['open', 'closed', 'results_published'],
  results_published: ['results_published'],
  event_cancelled: ['cancelled'],
  event_extended: ['open'],
};

export function maySend(type: MessageType, status: EventStatus): boolean {
  return SENDABLE[type].includes(status);
}

/** The reason given when a batch is refused: the event is not (or no longer) in that state. */
export function notSendableReason(type: MessageType): string {
  return type === 'code_delivery' ? 'NOT_PUBLISHED' : 'NOT_OPEN';
}
