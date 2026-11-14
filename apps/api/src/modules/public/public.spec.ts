// POST /api/v1/public/contact (Implementation Plan step 38): both public forms reach the team
// mailbox through the worker, invalid input is refused field by field, bots filling the
// honeypot get the same answer and nothing is sent, the route is rate-limited per address, and
// the visitor's text is never logged.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { MailService, type MailMessage } from '../../mail/mail.service.js';
import { uniqueSuffix } from '../../testing/db.js';
import { createTestHttpApp, testIp } from '../../testing/http.js';
import { WorkerModule } from '../../worker.module.js';

const CONTACT = '/api/v1/public/contact';

describe('public contact and demo forms', () => {
  let app: NestExpressApplication;
  let logs: string[];
  let worker: TestingModule;
  let outbox: MailMessage[];

  const post = (body: object, ip = testIp()) =>
    request(app.getHttpServer()).post(CONTACT).set('X-Forwarded-For', ip).send(body);

  /** The team email whose text contains `marker` (test files share the mailbox). */
  async function waitForMail(marker: string): Promise<MailMessage> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const mail = outbox.find((m) => m.text.includes(marker));
      if (mail) return mail;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`no email containing ${marker}`);
  }

  beforeAll(async () => {
    ({ app, logs } = await createTestHttpApp());
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    outbox = worker.get(MailService).outbox;
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
  });

  it('emails a demo request to the team, with Reply-To the visitor', async () => {
    const org = `SACCO ya Walimu ${uniqueSuffix()}`;
    await post({
      kind: 'demo',
      name: 'Asha Mwinyi',
      organization: org,
      phone: '0754 123 456',
      email: 'Asha@Example.test',
      expectedVoters: 850,
      preferredDate: '2026-12-03',
      message: '<b>Uchaguzi</b> wa bodi',
      language: 'sw',
    }).expect(202);
    const mail = await waitForMail(org);
    expect(mail.to).toBe('team@example.test');
    expect(mail.replyTo).toBe('asha@example.test');
    expect(mail.subject).toBe('Ombi la onyesho / Demo request');
    expect(mail.text).toContain('Simu / Phone: +255754123456');
    expect(mail.text).toContain('Wapiga kura / Expected voters: 850');
    expect(mail.html).toContain('&#60;b&#62;Uchaguzi&#60;/b&#62;');
    expect(mail.html).not.toContain('<b>Uchaguzi');
  });

  it('emails a contact message; the phone is optional', async () => {
    const name = `John Kim ${uniqueSuffix()}`;
    await post({
      kind: 'contact',
      name,
      email: 'john@example.test',
      phone: '',
      message: 'Please call me about pricing.',
      language: 'en',
    }).expect(202);
    const mail = await waitForMail(name);
    expect(mail.subject).toBe('Ujumbe wa tovuti / Website message');
    expect(mail.text).toContain('Simu / Phone: —');
    expect(mail.text).toContain('Lugha / Language: en');
  });

  it('refuses invalid fields with their paths and never echoes the input', async () => {
    const res = await post({
      kind: 'demo',
      name: 'A',
      organization: '',
      phone: '12345',
      email: 'not-an-email',
      expectedVoters: 0,
      preferredDate: '2026-02-30',
    }).expect(400);
    const body = res.body as { code: string; details: { issues: { path: string }[] } };
    expect(body.code).toBe('VALIDATION_FAILED');
    const paths = [...new Set(body.details.issues.map((i) => i.path))].sort();
    expect(paths).toEqual(
      ['email', 'expectedVoters', 'name', 'organization', 'phone', 'preferredDate'].sort(),
    );
    expect(JSON.stringify(res.body)).not.toContain('not-an-email');
    await post({ kind: 'other', name: 'Asha', email: 'a@example.test' }).expect(400);
  });

  it('accepts a filled honeypot without sending anything', async () => {
    const name = `Bot ${uniqueSuffix()}`;
    await post({
      kind: 'contact',
      name,
      email: 'bot@example.test',
      message: 'Buy cheap things now please',
      website: 'https://spam.example',
    }).expect(202);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(outbox.some((m) => m.text.includes(name))).toBe(false);
  });

  it('allows 5 requests a minute per address', async () => {
    const ip = testIp();
    const body = { kind: 'contact', name: 'X', email: 'x@example.test', message: 'short' };
    for (let i = 0; i < 5; i += 1) await post(body, ip).expect(400);
    await post(body, ip).expect(429);
  });

  it('never logs what the visitor wrote', async () => {
    const secret = `Siri-${uniqueSuffix()}`;
    await post({
      kind: 'contact',
      name: 'Neema',
      email: 'neema@example.test',
      message: `Ujumbe wangu ${secret}`,
    }).expect(202);
    await waitForMail(secret);
    expect(logs.join('\n')).not.toContain(secret);
  });
});
