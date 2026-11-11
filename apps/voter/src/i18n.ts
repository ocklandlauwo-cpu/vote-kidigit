// i18next for voter screens (Design System 11.2): Swahili, with English ready for later. Only the
// voter strings ship in this app (voter-sw.json / voter-en.json in the shared package).
import { DEFAULT_LANGUAGE, voterMessages } from '@vote-kidigit/shared';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: (typeof voterMessages)['sw'] };
  }
}

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  resources: {
    sw: { translation: voterMessages.sw },
    en: { translation: voterMessages.en },
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false }, // React escapes
  returnNull: false,
  initAsync: false,
});
