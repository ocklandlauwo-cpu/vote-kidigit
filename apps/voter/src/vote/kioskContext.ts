// Kiosk mode for the shared voter screens (Design System 10.10): a wider frame, the larger scale,
// and the hidden exit gesture (5 taps on the organization logo).
import { createContext, useContext } from 'react';

export interface KioskMode {
  token: string;
  /** Counts a tap on the logo; five in a row open the staff exit. */
  onLogoTap: () => void;
}

export const KioskContext = createContext<KioskMode | null>(null);

export function useKiosk(): KioskMode | null {
  return useContext(KioskContext);
}

/** KSK-06: seconds before the screen returns to the start. */
export const RETURN_SECONDS = 10;
