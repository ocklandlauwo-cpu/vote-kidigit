// Where each publish checklist item is fixed (App Flow 6.3: "each line links to the place").
import type { ChecklistItemKey } from '@vote-kidigit/shared';

/** The workspace tab where each checklist item is fixed. */
export const FIX: Record<ChecklistItemKey, string> = {
  details: 'settings',
  categories: 'categories',
  contesters: 'categories',
  rules: 'categories',
  voters: 'voters',
  eligibility: 'categories',
};
