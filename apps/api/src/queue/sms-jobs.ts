// Jobs on the sms queue: one per message (SMS or email to a voter). The payload names the
// message; the worker reads the voter's encrypted code itself, so no code is ever in Redis.

export const SMS_JOB = { send: 'send' } as const;

export interface SendMessageJob {
  messageId: string;
  organizationId: string;
  requestId: string;
}
