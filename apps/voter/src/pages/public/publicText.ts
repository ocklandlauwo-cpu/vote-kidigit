// Strings of the public website (PUB-01 to PUB-05) in Swahili and English. The site has its own
// i18next instance, so its language switch never changes the voter screens, which stay Swahili
// (Design System 11.2). The visitor's choice is remembered in this browser only.
import { DEFAULT_LANGUAGE, isLanguage, type Language } from '@vote-kidigit/shared';
// Imported here, not through the shared index, so only the public pages' chunks carry them.
import publicEn from '@vote-kidigit/shared/i18n/public-en.json';
import publicSw from '@vote-kidigit/shared/i18n/public-sw.json';
import i18next from 'i18next';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Every key of the public strings, e.g. 'home.title'. */
export type PublicKey = Paths<typeof publicSw>;

const STORAGE_KEY = 'vk.publicLanguage';

function storedLanguage(): Language {
  try {
    const value = globalThis.localStorage.getItem(STORAGE_KEY);
    return isLanguage(value) ? value : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export const publicI18n = i18next.createInstance();

void publicI18n.init({
  resources: {
    sw: { translation: publicSw },
    en: { translation: publicEn },
  },
  lng: storedLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false }, // React escapes
  returnNull: false,
  initAsync: false,
});

export function setPublicLanguage(language: Language): void {
  void publicI18n.changeLanguage(language);
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Private mode or blocked storage: the choice lasts for this visit only.
  }
}

type Translate = (key: PublicKey, options?: Record<string, string | number>) => string;

/** `t` for public keys and the current language; re-renders when the language changes. */
export function usePublicText(): { t: Translate; language: Language } {
  const { i18n } = useTranslation(undefined, { i18n: publicI18n });
  const language = isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
  const t = useCallback<Translate>(
    (key, options) =>
      (i18n.t as (k: string, o?: object) => string)(key, { ...options, lng: language }),
    [i18n, language],
  );
  return { t, language };
}

/** Sets the tab title for a public page. */
export function usePageTitle(key: PublicKey): void {
  const { t } = usePublicText();
  const title = t(key);
  useEffect(() => {
    document.title = title;
  }, [title]);
}
