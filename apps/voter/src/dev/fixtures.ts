// Sample voter data for the component gallery and tests (not used by the product).
import type {
  BallotCategory,
  VoterBallot,
  VoterEventCard,
  VoterIdentity,
} from '@vote-kidigit/shared';

export const EVENT_ID = '0190f0a1-2b3c-7d4e-8f90-0000000000f1';

export const card = (change: Partial<VoterEventCard> = {}): VoterEventCard => ({
  id: EVENT_ID,
  name: 'Uchaguzi Mkuu 2027',
  organizationName: 'Chama cha Walimu',
  logoUrl: null,
  primaryColor: null,
  timeZone: 'Africa/Dar_es_Salaam',
  helpPhone: '+255754000222',
  startAt: '2026-11-20T05:00:00.000Z',
  endAt: '2026-11-20T13:00:00.000Z',
  state: 'open',
  ...change,
});

export const identity: VoterIdentity = {
  fullName: 'Asha Mollel',
  membershipId: 'M-101',
  photoUrl: null,
};

let n = 0;
const id = () => `0190f0a1-2b3c-7d4e-8f90-${String((n += 1)).padStart(12, '0')}`;

export function category(
  name: string,
  contesters: string[],
  rules: Partial<BallotCategory['rules']> = {},
): BallotCategory {
  return {
    id: id(),
    name,
    pictureUrl: null,
    rules: {
      selectionMode: 'exact',
      exactCount: 1,
      minCount: null,
      maxCount: null,
      allowSkip: false,
      yesNo: contesters.length === 1,
      ...rules,
    },
    contesters: contesters.map((fullName) => ({ id: id(), fullName, party: null, photoUrl: null })),
  };
}

export const ballotOf = (...categories: BallotCategory[]): VoterBallot => ({
  categories,
  showParty: false,
});
