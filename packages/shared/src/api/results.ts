// Results (PRD RES-*, App Flow 6.12–6.14 and 11, Backend Schema 6.4–6.7, 12.10): closing and
// reopening, the frozen snapshot with winners and ties, tie resolution, publication, the public
// link, and the public / voter results pages (winners only when the event says so).
import { z } from 'zod';
import { ChoiceKindSchema, ResultsVisibilitySchema, TieOutcomeSchema } from '../constants/enums.js';

/** POST /events/:eventId/reopen (App Flow 6.11): a new end time and why. */
export const ReopenEventRequestSchema = z
  .object({
    newEndAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(10).max(500),
  })
  .strict()
  .refine((body) => Date.parse(body.newEndAt) > Date.now(), {
    path: ['newEndAt'],
    message: 'must be in the future',
  });
export type ReopenEventRequest = z.infer<typeof ReopenEventRequestSchema>;

export const ResultRowSchema = z.object({
  contesterId: z.uuid(),
  name: z.string(),
  party: z.string().nullable(),
  photoUrl: z.string().nullable(),
  choice: ChoiceKindSchema,
  votes: z.number().int(),
  percent: z.number(),
  rank: z.number().int(),
  isWinner: z.boolean(),
});
export type ResultRow = z.infer<typeof ResultRowSchema>;

export const TieResolutionSchema = z.object({
  outcome: TieOutcomeSchema,
  winnerIds: z.array(z.uuid()),
  reason: z.string(),
  resolvedBy: z.string(),
  resolvedAt: z.iso.datetime(),
});

export const ResultCategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  seats: z.number().int(),
  thresholdPct: z.number().nullable(),
  quorumPct: z.number().nullable(),
  eligibleVoters: z.number().int(),
  votersVoted: z.number().int(),
  validVotes: z.number().int(),
  skipped: z.number().int(),
  quorumMet: z.boolean().nullable(),
  thresholdMet: z.boolean().nullable(),
  hasTie: z.boolean(),
  tie: TieResolutionSchema.nullable(),
  rows: z.array(ResultRowSchema),
});
export type ResultCategory = z.infer<typeof ResultCategorySchema>;

export const ResultSnapshotSchema = z.object({
  id: z.uuid(),
  version: z.number().int(),
  generatedAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().nullable(),
  registeredVoters: z.number().int(),
  votersVoted: z.number().int(),
  contentHash: z.string(),
  categories: z.array(ResultCategorySchema),
});
export type ResultSnapshot = z.infer<typeof ResultSnapshotSchema>;

/** GET /events/:eventId/results (RES-01). */
export const EventResultsSchema = z.object({
  /** not_closed: voting still running (no numbers); closed: frozen, not published. */
  state: z.enum(['not_closed', 'closed', 'published']),
  snapshot: ResultSnapshotSchema.nullable(),
  /** Categories with a tie still to resolve before publication. */
  unresolvedTies: z.number().int(),
  publicUrl: z.string().nullable(),
  publicEnabled: z.boolean(),
  visibility: ResultsVisibilitySchema,
});
export type EventResults = z.infer<typeof EventResultsSchema>;

/** POST /events/:eventId/results/ties (RES-03). */
export const ResolveTieRequestSchema = z
  .object({
    categoryId: z.uuid(),
    outcome: TieOutcomeSchema,
    winnerIds: z.array(z.uuid()).max(50).default([]),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();
export type ResolveTieRequest = z.input<typeof ResolveTieRequestSchema>;

/** POST /events/:eventId/results/publish: type the event name to confirm. */
export const PublishResultsRequestSchema = z
  .object({ confirmName: z.string().trim().min(1) })
  .strict();
export type PublishResultsRequest = z.infer<typeof PublishResultsRequestSchema>;

/** POST /events/:eventId/results/public-link */
export const PublicLinkRequestSchema = z.object({ enabled: z.boolean() }).strict();
export type PublicLinkRequest = z.infer<typeof PublicLinkRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Public results (RES-04) and the voter's results (VTR-WEB-08)
// ---------------------------------------------------------------------------------------------

export const PublicResultRowSchema = z.object({
  name: z.string(),
  party: z.string().nullable(),
  photoUrl: z.string().nullable(),
  choice: ChoiceKindSchema,
  /** Null when the event publishes winners only. */
  votes: z.number().int().nullable(),
  percent: z.number().nullable(),
  isWinner: z.boolean(),
});

export const PublicResultCategorySchema = z.object({
  name: z.string(),
  seats: z.number().int(),
  votersVoted: z.number().int().nullable(),
  quorumMet: z.boolean().nullable(),
  /** "Decided by …": how a tie at the last seat was settled. */
  tieNote: z.string().nullable(),
  rows: z.array(PublicResultRowSchema),
});

export const PublicResultsSchema = z.object({
  event: z.object({
    name: z.string(),
    organizationName: z.string(),
    logoUrl: z.string().nullable(),
    primaryColor: z.string().nullable(),
    timeZone: z.string(),
    closedAt: z.iso.datetime().nullable(),
    publishedAt: z.iso.datetime().nullable(),
  }),
  visibility: ResultsVisibilitySchema,
  version: z.number().int(),
  contentHash: z.string(),
  turnout: z.object({ registered: z.number().int(), voted: z.number().int() }).nullable(),
  categories: z.array(PublicResultCategorySchema),
});
export type PublicResults = z.infer<typeof PublicResultsSchema>;

export const VoterResultsSchema = PublicResultsSchema.extend({
  /** "Ulipiga kura saa {time}". */
  votedAt: z.iso.datetime().nullable(),
});
export type VoterResults = z.infer<typeof VoterResultsSchema>;

/**
 * PRD NFR-22: a category with fewer than this many voters can reveal individual choices, so its
 * turnout and results carry a warning on staff screens.
 */
export const SMALL_GROUP_MIN = 5;

export function isSmallGroup(voted: number): boolean {
  return voted > 0 && voted < SMALL_GROUP_MIN;
}
