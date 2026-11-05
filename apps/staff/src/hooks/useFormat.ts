import { useTranslation } from 'react-i18next';
import { useMe } from '../auth/useAuth';
import { DEFAULT_TIME_ZONE, formatDate, formatDateTime } from '../format';
import { currentLanguage } from '../i18n';

/** Formatters in the signed-in user's organization time zone and current language. */
export function useFormat() {
  useTranslation(); // re-render on language change
  const timeZone = useMe().data?.organization?.timeZone ?? DEFAULT_TIME_ZONE;
  const language = currentLanguage();
  return {
    timeZone,
    date: (iso: string | null | undefined) => (iso ? formatDate(iso, timeZone, language) : ''),
    dateTime: (iso: string | null | undefined) =>
      iso ? formatDateTime(iso, timeZone, language) : '',
  };
}
