// Voter API (Backend Schema 8.3, 8.4, 12.11; App Flow 8): sign-in with membership ID and code,
// the identity check, per-category status, the ballot and its submission. Voters have no staff
// session: after sign-in they carry a ballot token (Authorization: Bearer).
import { z } from 'zod';
import { ChoiceKindSchema, SelectionModeSchema } from '../constants/enums.js';

/** Event states a voter can meet (Draft events are never shown to voters). */
export const voterEventStates = [
  'scheduled',
  'open',
  'closed',
  'results_published',
  'cancelled',
] as const;
export const VoterEventStateSchema = z.enum(voterEventStates);
export type VoterEventState = z.infer<typeof VoterEventStateSchema>;

/** GET /vote/events/:eventId — the card on the sign-in page. */
export const VoterEventCardSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  organizationName: z.string(),
  logoUrl: z.string().nullable(),
  /** Organization colour for voter screens (Design System 3.4), or null for the default. */
  primaryColor: z.string().nullable(),
  timeZone: z.string(),
  helpPhone: z.string().nullable(),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  state: VoterEventStateSchema,
});
export type VoterEventCard = z.infer<typeof VoterEventCardSchema>;

/** POST /vote/sign-in. The code may be typed with or without the dash, in any case. */
export const VoterSignInRequestSchema = z
  .object({
    eventId: z.uuid().optional(),
    membershipId: z.string().trim().min(1).max(50),
    code: z.string().trim().min(1).max(20),
  })
  .strict();
export type VoterSignInRequest = z.infer<typeof VoterSignInRequestSchema>;

/** 300 CHOOSE_EVENT details: the pair matches voters in several events. */
export const ChooseEventDetailsSchema = z.object({
  events: z.array(z.object({ id: z.uuid(), name: z.string(), organizationName: z.string() })),
});
export type ChooseEventDetails = z.infer<typeof ChooseEventDetailsSchema>;

/** 401 INVALID_CREDENTIALS details, and 423 VOTER_LOCKED details. */
export const SignInFailureDetailsSchema = z.object({
  attemptsLeft: z.number().int().optional(),
  lockedUntil: z.iso.datetime().optional(),
});

export const VoterIdentitySchema = z.object({
  fullName: z.string(),
  membershipId: z.string(),
  photoUrl: z.string().nullable(),
});
export type VoterIdentity = z.infer<typeof VoterIdentitySchema>;

export const VoterSignInResponseSchema = z.object({
  token: z.string(),
  voter: VoterIdentitySchema,
  event: VoterEventCardSchema,
});
export type VoterSignInResponse = z.infer<typeof VoterSignInResponseSchema>;

/** POST /vote/confirm-identity: where the voter goes next. */
export const ConfirmIdentityResponseSchema = z.object({ next: z.enum(['ballot', 'status']) });
export type ConfirmIdentityResponse = z.infer<typeof ConfirmIdentityResponseSchema>;

/** POST /vote/not-me: the election officer to contact (App Flow 8.2). */
export const NotMeResponseSchema = z.object({ contactPhone: z.string().nullable() });
export type NotMeResponse = z.infer<typeof NotMeResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Status (VTR-WEB-07, App Flow 8.3)
// ---------------------------------------------------------------------------------------------

export const voterCategoryStates = ['voted', 'open', 'opens_later', 'closed'] as const;

export const VoterCategoryStatusSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  state: z.enum(voterCategoryStates),
  votedAt: z.iso.datetime().nullable(),
  opensAt: z.iso.datetime().nullable(),
  closesAt: z.iso.datetime().nullable(),
});
export type VoterCategoryStatus = z.infer<typeof VoterCategoryStatusSchema>;

export const VoterStatusSchema = z.object({
  event: VoterEventCardSchema,
  /** Categories this voter is eligible for, in display order. */
  categories: z.array(VoterCategoryStatusSchema),
  /** At least one open category not voted in yet. */
  canVote: z.boolean(),
  /** First time the voter voted in this event, for "Umeshapiga kura saa {time}". */
  votedAt: z.iso.datetime().nullable(),
});
export type VoterStatus = z.infer<typeof VoterStatusSchema>;

// ---------------------------------------------------------------------------------------------
// Ballot (VTR-WEB-04, -05) and submission (Backend Schema 8.4)
// ---------------------------------------------------------------------------------------------

export const BallotContesterSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  party: z.string().nullable(),
  photoUrl: z.string().nullable(),
});
export type BallotContester = z.infer<typeof BallotContesterSchema>;

export const BallotCategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  pictureUrl: z.string().nullable(),
  rules: z.object({
    selectionMode: SelectionModeSchema,
    exactCount: z.number().int().nullable(),
    minCount: z.number().int().nullable(),
    maxCount: z.number().int().nullable(),
    allowSkip: z.boolean(),
    /** One contester: the voter answers Yes or No (Ndiyo / Hapana). */
    yesNo: z.boolean(),
  }),
  /** In this voter's own random order, stable for the session. */
  contesters: z.array(BallotContesterSchema),
});
export type BallotCategory = z.infer<typeof BallotCategorySchema>;

export const VoterBallotSchema = z.object({
  categories: z.array(BallotCategorySchema),
  showParty: z.boolean(),
});
export type VoterBallot = z.infer<typeof VoterBallotSchema>;

export const BallotSelectionSchema = z
  .object({
    categoryId: z.uuid(),
    choice: ChoiceKindSchema,
    contesterIds: z.array(z.uuid()).max(50).default([]),
  })
  .strict();

export const SubmitBallotRequestSchema = z
  .object({ selections: z.array(BallotSelectionSchema).min(1).max(100) })
  .strict();
export type SubmitBallotRequest = z.input<typeof SubmitBallotRequestSchema>;

export const ballotRejectionReasons = [
  'CATEGORY_NOT_FOUND',
  'CATEGORY_CLOSED',
  'NOT_ELIGIBLE',
  'ALREADY_VOTED',
  'RULE_NOT_MET',
] as const;

export const SubmitBallotResponseSchema = z.object({
  recorded: z.array(z.object({ categoryId: z.uuid(), name: z.string() })),
  rejected: z.array(
    z.object({
      categoryId: z.string().nullable(),
      name: z.string().nullable(),
      reason: z.enum(ballotRejectionReasons),
    }),
  ),
  votedAt: z.iso.datetime(),
});
export type SubmitBallotResponse = z.infer<typeof SubmitBallotResponseSchema>;
