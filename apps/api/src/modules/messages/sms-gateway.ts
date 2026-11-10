// The SMS provider behind one interface (Tech Stack 11.2: one adapter class per external
// service). SMS_DRIVER picks Beem Africa or the fake that records messages (development, tests).
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';

export interface OutgoingSms {
  /** E.164, e.g. +255712345678. */
  to: string;
  text: string;
  senderId: string;
  /** Our message id, passed to the provider where it takes one. */
  reference: string;
}

export interface SentSms {
  providerMessageId: string;
}

/** A refused or failed send. `retryable` is false when trying again cannot help. */
export class SmsSendError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'SmsSendError';
  }
}

export interface SmsGateway {
  send(sms: OutgoingSms): Promise<SentSms>;
}

export const SMS_GATEWAY = Symbol('SMS_GATEWAY');

/** Provider errors are stored on the message; keep them short and free of the request. */
const errorText = (text: string) => text.replace(/\s+/g, ' ').slice(0, 200);

/**
 * Beem Africa (PRD SMS-01, Tech Stack 10): POST {BEEM_BASE_URL}/v1/send with HTTP Basic auth
 * (API key : secret key), one recipient per request because each message carries its own code.
 * The response's request_id identifies the message in delivery reports.
 */
@Injectable()
export class BeemSmsAdapter implements SmsGateway {
  private readonly url: string;
  private readonly authorization: string;

  constructor(config: ConfigService<Env, true>) {
    const base: string = config.get('BEEM_BASE_URL', { infer: true });
    const key: string = config.get('BEEM_API_KEY', { infer: true });
    const secret: string = config.get('BEEM_SECRET_KEY', { infer: true });
    this.url = `${base.replace(/\/+$/, '')}/v1/send`;
    this.authorization = `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
  }

  async send(sms: OutgoingSms): Promise<SentSms> {
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: 'POST',
        headers: { Authorization: this.authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_addr: sms.senderId,
          schedule_time: '',
          encoding: 0,
          message: sms.text,
          recipients: [{ recipient_id: 1, dest_addr: sms.to.replace(/^\+/, '') }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error: unknown) {
      // Timeouts and network failures: the next attempt may well succeed.
      throw new SmsSendError(errorText(error instanceof Error ? error.message : 'network'), true);
    }
    const body = (await response.json().catch(() => null)) as {
      successful?: boolean;
      request_id?: number | string;
      message?: string;
    } | null;
    if (!response.ok || !body?.successful || body.request_id === undefined) {
      const reason = errorText(`${response.status} ${body?.message ?? response.statusText}`);
      // 4xx other than 429 is a refusal (bad number, sender ID, credentials): do not retry.
      const retryable = response.status >= 500 || response.status === 429 || response.ok;
      throw new SmsSendError(reason, retryable);
    }
    return { providerMessageId: String(body.request_id) };
  }
}

/**
 * Records messages instead of sending them (SMS_DRIVER=fake). Tests read `outbox`, choose
 * failures with `failWith`, and the development log shows each message with the code masked.
 */
@Injectable()
export class FakeSmsAdapter implements SmsGateway {
  private readonly logger = new Logger('FakeSms');
  readonly outbox: (OutgoingSms & { providerMessageId: string })[] = [];
  /** Decides per message whether the "provider" refuses it; null sends. */
  failWith: ((sms: OutgoingSms) => SmsSendError | null) | null = null;
  private counter = 0;

  send(sms: OutgoingSms): Promise<SentSms> {
    const error = this.failWith?.(sms);
    if (error) return Promise.reject(error);
    this.counter += 1;
    const providerMessageId = `fake-${Date.now()}-${this.counter}`;
    this.outbox.push({ ...sms, providerMessageId });
    if (process.env.NODE_ENV === 'development') {
      this.logger.log({ message: 'SMS (fake, not sent)', to: sms.to.slice(-3), text: sms.text });
    }
    return Promise.resolve({ providerMessageId });
  }
}
