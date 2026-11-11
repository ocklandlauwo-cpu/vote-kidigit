// UI strings (Design System 11.2): keys in English, values in sw.json and en.json. Staff screens
// use both; voter screens use Swahili only. Each app initialises i18next with these resources
// (the shared package depends only on zod).
import en from './en.json';
import sw from './sw.json';
import voterEn from './voter-en.json';
import voterSw from './voter-sw.json';

export const languages = ['sw', 'en'] as const;
export type Language = (typeof languages)[number];
export const DEFAULT_LANGUAGE: Language = 'sw';

export type Messages = typeof sw;

/** Swahili defines the keys; English must have exactly the same ones (tested). */
export const messages: Record<Language, Messages> = { sw, en };

export function isLanguage(value: unknown): value is Language {
  return value === 'sw' || value === 'en';
}

export type VoterMessages = typeof voterSw;

/**
 * Voter screens (VTR-WEB, KSK, RES) have their own, much smaller set, so the voter app does not
 * ship the staff portal's strings. Swahili defines the keys; English must match (tested).
 */
export const voterMessages: Record<Language, VoterMessages> = { sw: voterSw, en: voterEn };
