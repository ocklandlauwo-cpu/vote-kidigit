// Staff emails in Swahili and English (Implementation Plan step 10; wording style Design System
// 11: short, polite, one purpose, no exclamation marks). Plain text plus a minimal HTML version.
import type { PublicContactPayload } from '@vote-kidigit/shared';
import type { MailMessage } from './mail.service.js';

export type Language = 'sw' | 'en';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function render(to: string, subject: string, paragraphs: string[], link: string): MailMessage {
  const text = [...paragraphs.slice(0, 2), link, ...paragraphs.slice(2)].join('\n\n');
  const html = [
    ...paragraphs.slice(0, 2).map((p) => `<p>${escapeHtml(p)}</p>`),
    `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
    ...paragraphs.slice(2).map((p) => `<p>${escapeHtml(p)}</p>`),
  ].join('\n');
  return { to, subject, text, html };
}

export interface InvitationEmail {
  to: string;
  fullName: string;
  organizationName: string | null;
  link: string;
  language: Language;
}

/** Invitation with a set-password link valid for 48 hours (PRD USR-02, App Flow 4.2). */
export function invitationEmail(input: InvitationEmail): MailMessage {
  const org = input.organizationName ?? 'Vote-Kidigit';
  return input.language === 'en'
    ? render(
        input.to,
        `Your Vote-Kidigit account for ${org}`,
        [
          `Hello ${input.fullName},`,
          `You have been invited to run elections for ${org} on Vote-Kidigit. Open this link to set your password:`,
          'The link is valid for 48 hours. If you were not expecting this email, you can ignore it.',
        ],
        input.link,
      )
    : render(
        input.to,
        `Akaunti yako ya Vote-Kidigit kwa ${org}`,
        [
          `Habari ${input.fullName},`,
          `Umealikwa kusimamia chaguzi za ${org} kwenye Vote-Kidigit. Fungua kiungo hiki kuweka nenosiri lako:`,
          'Kiungo kinafanya kazi kwa saa 48. Kama hukutarajia barua pepe hii, unaweza kuipuuza.',
        ],
        input.link,
      );
}

export interface PasswordResetEmail {
  to: string;
  fullName: string;
  link: string;
  language: Language;
}

/** Password reset with a link valid for 60 minutes (PRD USR-08, App Flow AUTH-03/04). */
export function passwordResetEmail(input: PasswordResetEmail): MailMessage {
  return input.language === 'en'
    ? render(
        input.to,
        'Reset your Vote-Kidigit password',
        [
          `Hello ${input.fullName},`,
          'Someone asked to reset the password of your Vote-Kidigit account. Open this link to choose a new one:',
          'The link is valid for 60 minutes and works once. If you did not ask for this, ignore this email: your password stays the same.',
        ],
        input.link,
      )
    : render(
        input.to,
        'Weka upya nenosiri lako la Vote-Kidigit',
        [
          `Habari ${input.fullName},`,
          'Kuna ombi la kuweka upya nenosiri la akaunti yako ya Vote-Kidigit. Fungua kiungo hiki kuchagua jipya:',
          'Kiungo kinafanya kazi kwa dakika 60 na mara moja tu. Kama hukuomba hili, puuza barua pepe hii: nenosiri lako halitabadilika.',
        ],
        input.link,
      );
}

export interface ContactEmail {
  to: string;
  request: PublicContactPayload;
  /** ISO time the API received the form. */
  receivedAt: string;
}

/**
 * A contact (PUB-04) or demo (PUB-05) request for the Vote-Kidigit team. Reply-To is the
 * visitor, so answering the email answers them. Visitor text is escaped in the HTML version.
 */
export function contactEmail({ to, request, receivedAt }: ContactEmail): MailMessage {
  const rows: [string, string][] =
    request.kind === 'demo'
      ? [
          ['Jina / Name', request.name],
          ['Taasisi / Organization', request.organization],
          ['Simu / Phone', request.phone],
          ['Barua pepe / Email', request.email],
          ['Wapiga kura / Expected voters', String(request.expectedVoters)],
          ['Tarehe / Preferred date', request.preferredDate],
          ['Lugha / Language', request.language],
          ['Ujumbe / Message', request.message ?? '—'],
        ]
      : [
          ['Jina / Name', request.name],
          ['Barua pepe / Email', request.email],
          ['Simu / Phone', request.phone ?? '—'],
          ['Lugha / Language', request.language],
          ['Ujumbe / Message', request.message],
        ];
  rows.push(['Imepokelewa / Received (UTC)', receivedAt]);
  const subject =
    request.kind === 'demo'
      ? `Ombi la onyesho / Demo request: ${request.organization}`
      : `Ujumbe wa tovuti / Website message: ${request.name}`;
  const text = rows.map(([label, value]) => `${label}: ${value}`).join('\n');
  const html = `<table>\n${rows
    .map(
      ([label, value]) =>
        `<tr><th align="left" valign="top">${escapeHtml(label)}</th><td style="white-space:pre-wrap">${escapeHtml(value)}</td></tr>`,
    )
    .join('\n')}\n</table>`;
  return { to, subject: subject.replace(/[\r\n]+/g, ' '), text, html, replyTo: request.email };
}
