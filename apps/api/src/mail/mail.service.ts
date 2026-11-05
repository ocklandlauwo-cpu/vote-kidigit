import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../config/env.schema.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sends email (Tech Stack 6.1: Nodemailer through the DirectAdmin SMTP server). Development
 * prints each message to the log instead of sending it; tests keep messages in `outbox`.
 * Only the worker sends mail: the API adds jobs to the email queue.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter;
  private readonly mode: 'smtp' | 'log' | 'memory';
  private readonly from: string;
  /** Messages "sent" in test mode, newest last. */
  readonly outbox: MailMessage[] = [];

  constructor(config: ConfigService<Env, true>) {
    const env = config.get('NODE_ENV', { infer: true });
    this.from = config.get('MAIL_FROM', { infer: true });
    this.mode = env === 'production' ? 'smtp' : env === 'test' ? 'memory' : 'log';
    this.transport =
      this.mode === 'smtp'
        ? nodemailer.createTransport({
            host: config.get('SMTP_HOST', { infer: true }),
            port: config.get('SMTP_PORT', { infer: true }),
            secure: config.get('SMTP_PORT', { infer: true }) === 465,
            requireTLS: config.get('SMTP_PORT', { infer: true }) !== 465,
            auth: {
              user: config.get('SMTP_USER', { infer: true }),
              pass: config.get('SMTP_PASSWORD', { infer: true }),
            },
          })
        : nodemailer.createTransport({ jsonTransport: true });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
    if (this.mode === 'memory') this.outbox.push(message);
    if (this.mode === 'log') {
      // Development only: the link in the message is what the developer clicks.
      process.stdout.write(
        `\n--- email to ${message.to}: ${message.subject}\n${message.text}\n--- end of email\n\n`,
      );
    }
    this.logger.log({ msg: 'email sent', subject: message.subject, transport: this.mode });
  }
}
