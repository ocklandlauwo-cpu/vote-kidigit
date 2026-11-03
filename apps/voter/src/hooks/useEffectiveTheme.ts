import { getEffectiveTheme, subscribeTheme, type EffectiveTheme } from '@vote-kidigit/shared';
import { useSyncExternalStore } from 'react';

/** The theme in effect (explicit choice, else the device setting), kept live (Design System 12.4). */
export function useEffectiveTheme(): EffectiveTheme {
  return useSyncExternalStore(subscribeTheme, getEffectiveTheme, () => 'light');
}
