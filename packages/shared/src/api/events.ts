import { z } from 'zod';
import {
  AssignmentTypeSchema,
  EventStatusSchema,
  ResultsVisibilitySchema,
  UserStatusSchema,
} from '../constants/enums.js';
import { pageSchema, PaginationQuerySchema } from './common.js';

// Events (Backend Schema 12.5, App Flow 6.1-6.3, 6.9).

export const EventNameSchema = z.string().trim().min(2).max(150);

const windowRefinement = <T extends { startAt?: string; endAt?: string }>(body: T) =>
  body.startAt === undefined ||
  body.endAt === undefined ||
  Date.parse(body.endAt) > Date.parse(body.startAt);
const windowIssue = { message: 'must be after the start', path: ['endAt'] };

/** A row of EVT-01. Turnout joins with participation (step 22). */
export const EventSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: EventStatusSchema,
  isActive: z.boolean(),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  activeCategories: z.number().int(),
  voters: z.number().int(),
  moderators: z.array(z.string()),
  updatedAt: z.iso.datetime(),
});
export type EventSummary = z.infer<typeof EventSummarySchema>;

export const EventListQuerySchema = PaginationQuerySchema.extend({
  status: EventStatusSchema.optional(),
  q: z.string().trim().max(150).optional(),
  /** Admins only (event.access_all): also list deactivated events. */
  includeInactive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type EventListQuery = z.infer<typeof EventListQuerySchema>;

export const EventPageSchema = pageSchema(EventSummarySchema);
export type EventPage = z.infer<typeof EventPageSchema>;

/** EVT-02: name and window; the event starts as Draft. */
export const CreateEventRequestSchema = z
  .object({
    name: EventNameSchema,
    startAt: z.iso.datetime({ offset: true }),
    endAt: z.iso.datetime({ offset: true }),
  })
  .refine(windowRefinement, windowIssue);
export type CreateEventRequest = z.infer<typeof CreateEventRequestSchema>;

/**
 * EVT-09. Name and window change only in Draft; party display, results visibility and
 * reminders later too (the database enforces which).
 */
export const UpdateEventRequestSchema = z
  .object({
    name: EventNameSchema,
    startAt: z.iso.datetime({ offset: true }),
    endAt: z.iso.datetime({ offset: true }),
    showParty: z.boolean(),
    resultsVisibility: ResultsVisibilitySchema,
    reminderBeforeOpenHours: z.number().int().min(1).max(168).nullable(),
    reminderBeforeCloseMinutes: z.number().int().min(5).max(1440).nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'nothing to change')
  .refine(windowRefinement, windowIssue);
export type UpdateEventRequest = z.infer<typeof UpdateEventRequestSchema>;

export const EventDetailSchema = EventSummarySchema.extend({
  showParty: z.boolean(),
  resultsVisibility: ResultsVisibilitySchema,
  reminderBeforeOpenHours: z.number().int().nullable(),
  reminderBeforeCloseMinutes: z.number().int().nullable(),
  firstCodeSentAt: z.iso.datetime().nullable(),
  openedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  cancelReason: z.string().nullable(),
  /** Who cancelled (from the audit log), for the Cancelled overview. */
  cancelledBy: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  categories: z.number().int(),
  contesters: z.number().int(),
  /** Voters per code status: the Scheduled overview shows sent / delivered / failed. */
  codeCounts: z.object({
    notSent: z.number().int(),
    sent: z.number().int(),
    delivered: z.number().int(),
    failed: z.number().int(),
  }),
  createdAt: z.iso.datetime(),
});
export type EventDetail = z.infer<typeof EventDetailSchema>;

// Lifecycle (Backend Schema 12.5, App Flow 6.8, 6.11).

/** POST /events/:eventId/publish: Schedule (opens at the start time) or Open now. */
export const PublishEventRequestSchema = z
  .object({
    mode: z.enum(['schedule', 'open_now']),
    /** "Send codes now" (App Flow 6.8): takes effect when SMS sending exists (step 21). */
    sendCodes: z.boolean().default(false),
  })
  .strict();
export type PublishEventRequest = z.input<typeof PublishEventRequestSchema>;

/** POST /events/:eventId/cancel: type the event name and give a reason (App Flow 6.11). */
export const CancelEventRequestSchema = z
  .object({
    confirmName: z.string().max(200),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();
export type CancelEventRequest = z.infer<typeof CancelEventRequestSchema>;

/** app.publish_checklist() (App Flow 6.3), in order. */
export const checklistItems = [
  'details',
  'categories',
  'contesters',
  'rules',
  'voters',
  'eligibility',
] as const;
export type ChecklistItemKey = (typeof checklistItems)[number];

export const ChecklistItemSchema = z.object({
  item: z.enum(checklistItems),
  ok: z.boolean(),
  /** e.g. { categoryIds: [...] } naming what to fix, or counts. */
  detail: z.record(z.string(), z.unknown()),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const ChecklistResponseSchema = z.object({ items: z.array(ChecklistItemSchema) });
export type ChecklistResponse = z.infer<typeof ChecklistResponseSchema>;

// Assignments (App Flow 7.2): the same mapping from the event (EVT-09) or the person (USR-03).

export const EventAssignmentSchema = z.object({
  userId: z.uuid(),
  fullName: z.string(),
  email: z.string(),
  userStatus: UserStatusSchema,
  type: AssignmentTypeSchema,
});
export type EventAssignment = z.infer<typeof EventAssignmentSchema>;

export const EventAssignmentsResponseSchema = z.object({ items: z.array(EventAssignmentSchema) });
export type EventAssignmentsResponse = z.infer<typeof EventAssignmentsResponseSchema>;

/** PUT /events/:eventId/assignments replaces the whole list. */
export const ReplaceEventAssignmentsRequestSchema = z.object({
  assignments: z
    .array(z.object({ userId: z.uuid(), type: AssignmentTypeSchema }))
    .max(200)
    .refine(
      (items) => new Set(items.map((a) => a.userId)).size === items.length,
      'a user appears twice',
    ),
});
export type ReplaceEventAssignmentsRequest = z.infer<typeof ReplaceEventAssignmentsRequestSchema>;

export const UserAssignmentSchema = z.object({
  eventId: z.uuid(),
  eventName: z.string(),
  eventStatus: EventStatusSchema,
  type: AssignmentTypeSchema,
});
export type UserAssignment = z.infer<typeof UserAssignmentSchema>;

export const UserAssignmentsResponseSchema = z.object({ items: z.array(UserAssignmentSchema) });
export type UserAssignmentsResponse = z.infer<typeof UserAssignmentsResponseSchema>;

/** PUT /users/:userId/assignments replaces the user's whole list. */
export const ReplaceUserAssignmentsRequestSchema = z.object({
  assignments: z
    .array(z.object({ eventId: z.uuid(), type: AssignmentTypeSchema }))
    .max(200)
    .refine(
      (items) => new Set(items.map((a) => a.eventId)).size === items.length,
      'an event appears twice',
    ),
});
export type ReplaceUserAssignmentsRequest = z.infer<typeof ReplaceUserAssignmentsRequestSchema>;
