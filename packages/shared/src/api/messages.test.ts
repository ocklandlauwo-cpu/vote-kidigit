import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATES,
  PutTemplatesRequestSchema,
  REDACTED_CODE,
  renderTemplate,
  smsLength,
  unknownPlaceholders,
} from './messages.js';

const typical = {
  voter_name: 'Asha Mollel',
  org_name: 'Chama cha Walimu Arusha',
  event_name: 'Mkutano Mkuu 2027',
  voting_code: 'K7M4-Q9XR',
  voting_link: 'https://kura.example.tz/v/abc123',
  ussd_code: '*150*55#',
  start_time: '20/11 08:00',
  end_time: '20/11 16:00',
  results_link: 'https://kura.example.tz/r/abc123',
};

describe('message templates', () => {
  it('fills the placeholders and leaves unknown ones visible', () => {
    expect(renderTemplate('{org_name}: {voting_code} {nope}', typical)).toBe(
      'Chama cha Walimu Arusha: K7M4-Q9XR {nope}',
    );
    expect(renderTemplate('{voter_name}', {})).toBe('');
    expect(unknownPlaceholders('{voting_code} {pin} {pin} {org_name}')).toEqual(['pin']);
  });

  it('keeps the code SMS within one message with typical values (Design System 11.7)', () => {
    const text = renderTemplate(DEFAULT_TEMPLATES.code_delivery.sms, typical);
    expect(smsLength(text)).toMatchObject({ encoding: 'gsm7', segments: 1 });
    expect(text.indexOf('K7M4-Q9XR')).toBeLessThan(text.indexOf('20/11 08:00'));
    for (const template of Object.values(DEFAULT_TEMPLATES)) {
      expect(unknownPlaceholders(template.sms)).toEqual([]);
      expect(unknownPlaceholders(template.subject)).toEqual([]);
    }
  });

  it('never mentions choices in the vote confirmation (SMS-08)', () => {
    expect(DEFAULT_TEMPLATES.vote_confirmation.sms).not.toMatch(/\{voting_code\}|mgombea/);
  });

  it('counts SMS parts like the network does (SMS-04)', () => {
    expect(smsLength('a'.repeat(160))).toEqual({ encoding: 'gsm7', characters: 160, segments: 1 });
    expect(smsLength('a'.repeat(161))).toEqual({ encoding: 'gsm7', characters: 161, segments: 2 });
    expect(smsLength('€'.repeat(80))).toEqual({ encoding: 'gsm7', characters: 160, segments: 1 });
    expect(smsLength('ŋ'.repeat(70))).toEqual({ encoding: 'ucs2', characters: 70, segments: 1 });
    expect(smsLength('ŋ'.repeat(71))).toEqual({ encoding: 'ucs2', characters: 71, segments: 2 });
    expect(smsLength(REDACTED_CODE).encoding).toBe('ucs2');
  });

  it('refuses templates with placeholders outside the list', () => {
    const put = (body: string) =>
      PutTemplatesRequestSchema.safeParse({
        templates: [{ type: 'code_delivery', channel: 'sms', body }],
      }).success;
    expect(put('Msimbo: {voting_code}')).toBe(true);
    expect(put('Msimbo: {code}')).toBe(false);
  });
});
