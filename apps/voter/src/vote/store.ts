// State of one voter's visit (App Flow 8.2). The ballot token, identity and event card survive a
// page refresh in sessionStorage (closing the tab ends them); the choices live only in memory, so
// closing the browser loses them and nothing is recorded. A small external store keeps the
// voter app free of a state library.
import type {
  SubmitBallotResponse,
  VoterBallot,
  VoterEventCard,
  VoterIdentity,
  VoterStatus,
} from '@vote-kidigit/shared';
import { useSyncExternalStore } from 'react';
import type { Choice } from './rules';

export interface VoteState {
  token: string | null;
  identity: VoterIdentity | null;
  event: VoterEventCard | null;
  /** The status read before voting: which categories open later (VTR-WEB-06). */
  status: VoterStatus | null;
  ballot: VoterBallot | null;
  choices: Record<string, Choice>;
  result: SubmitBallotResponse | null;
  lastActivity: number;
}

const STORAGE_KEY = 'vk.vote';

const empty = (): VoteState => ({
  token: null,
  identity: null,
  event: null,
  status: null,
  ballot: null,
  choices: {},
  result: null,
  lastActivity: Date.now(),
});

function load(): VoteState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const saved = JSON.parse(raw) as Pick<VoteState, 'token' | 'identity' | 'event' | 'result'>;
    return { ...empty(), ...saved };
  } catch {
    return empty();
  }
}

let state: VoteState = load();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    const { token, identity, event, result } = state;
    if (token || result) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token, identity, event, result }));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Private mode without storage: the visit still works until a refresh.
  }
}

export function setVoteState(change: Partial<VoteState>): void {
  state = { ...state, ...change };
  persist();
  for (const listener of listeners) listener();
}

export function getVoteState(): VoteState {
  return state;
}

/** Ends the visit: token, choices and result are forgotten. */
export function resetVote(): void {
  state = empty();
  persist();
  for (const listener of listeners) listener();
}

export function useVote(): VoteState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
