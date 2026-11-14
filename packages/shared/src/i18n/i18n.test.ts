import { describe, expect, it } from 'vitest';
import { messages, voterMessages } from './index.js';
import publicEn from './public-en.json';
import publicSw from './public-sw.json';

// The public website's strings are imported by its own chunk only (step 38).
const publicMessages = { sw: publicSw, en: publicEn };

function keys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, inner]) =>
    keys(inner, prefix ? `${prefix}.${key}` : key),
  );
}

function values(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(values);
}

describe('UI strings', () => {
  it('has the same keys in Swahili and English', () => {
    expect(keys(messages.en).sort()).toEqual(keys(messages.sw).sort());
  });

  it('has no empty strings', () => {
    for (const language of ['sw', 'en'] as const) {
      expect(values(messages[language]).filter((v) => v.trim() === '')).toEqual([]);
    }
  });

  it('uses the same placeholders in both languages', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    const sw = keys(messages.sw);
    for (const key of sw) {
      const get = (root: unknown) =>
        key
          .split('.')
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], root);
      expect([key, placeholders(String(get(messages.en)))]).toEqual([
        key,
        placeholders(String(get(messages.sw))),
      ]);
    }
  });

  it('follows the writing rules: no exclamation marks, no system words (Design System 11)', () => {
    for (const language of ['sw', 'en'] as const) {
      for (const text of values(messages[language])) {
        expect(text).not.toMatch(/!/);
        expect(text).not.toMatch(/\b(token|payload|null|error 500|click here|invalid input)\b/i);
      }
    }
  });
});

describe('voter UI strings', () => {
  it('has the same keys in Swahili and English, none empty', () => {
    expect(keys(voterMessages.en).sort()).toEqual(keys(voterMessages.sw).sort());
    for (const language of ['sw', 'en'] as const) {
      expect(values(voterMessages[language]).filter((v) => v.trim() === '')).toEqual([]);
    }
  });
});

describe('public website strings', () => {
  it('has the same keys and placeholders in Swahili and English, none empty', () => {
    expect(keys(publicMessages.en).sort()).toEqual(keys(publicMessages.sw).sort());
    for (const language of ['sw', 'en'] as const) {
      expect(values(publicMessages[language]).filter((v) => v.trim() === '')).toEqual([]);
      for (const text of values(publicMessages[language])) expect(text).not.toMatch(/!/);
    }
  });
});
