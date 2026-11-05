// i18next for the staff portal (Design System 11.2): Swahili first, English switchable. The
// language is the signed-in user's (users.language, synced by the app); before sign-in it is the
// one last chosen on this device.
import { DEFAULT_LANGUAGE, isLanguage, type Language, messages } from '@vote-kidigit/shared';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

export const LANGUAGE_STORAGE_KEY = 'vk.language';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: (typeof messages)['sw'] };
  }
}

export function storedLanguage(): Language {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(value) ? value : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  resources: {
    sw: { translation: messages.sw },
    en: { translation: messages.en },
  },
  lng: storedLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false }, // React escapes
  returnNull: false,
  initAsync: false,
});

function applyDocumentLanguage(language: string): void {
  document.documentElement.lang = language;
}
applyDocumentLanguage(i18n.language);
i18n.on('languageChanged', applyDocumentLanguage);

/** Switches the interface language and remembers it on this device. */
export async function setLanguage(language: Language): Promise<void> {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // private mode: the choice lasts for this page only
  }
  if (i18n.language !== language) await i18n.changeLanguage(language);
}

export function currentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
}
