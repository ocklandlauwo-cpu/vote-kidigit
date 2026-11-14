/** IANA time zones offered in the pickers (the browser's list, or a short fallback). */
export const timeZones: string[] = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['Africa/Dar_es_Salaam', 'Africa/Nairobi', 'Africa/Kampala', 'UTC'];
  }
})();
