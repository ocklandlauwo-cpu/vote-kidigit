// Dashboards (App Flow 5, Backend Schema 12.4) and global search (App Flow 3.6). Each card has
// its own endpoint so cards load and fail independently ("Couldn't load this. Retry").
import { z } from 'zod';
import { EventStatusSchema, OrgStatusSchema } from '../constants/enums.js';
import { AuditEntrySchema } from './audit.js';

/** DSH-01 platform, DSH-02 organization, DSH-03 moderator, DSH-04 observer (App Flow 5.1). */
export const DashboardKindSchema = z.enum(['platform', 'organization', 'moderator', 'observer']);
export type DashboardKind = z.infer<typeof DashboardKindSchema>;

/**
 * Which dashboard a user gets: platform admins DSH-01; whoever sees every event of the
 * organization (event.access_all: Org Super Admin, Admin) DSH-02; whoever may change an event
 * (event.edit: moderators) DSH-03; everyone else DSH-04.
 */
export function dashboardKind(user: {
  isPlatformAdmin: boolean;
  permissions: readonly string[];
}): DashboardKind {
  if (user.isPlatformAdmin) return 'platform';
  if (user.permissions.includes('event.access_all')) return 'organization';
  if (user.permissions.includes('event.edit')) return 'moderator';
  return 'observer';
}

/** "Active" for the landing rule (App Flow 5.1): Draft, Scheduled, Open or Closed. */
export const ACTIVE_EVENT_STATUSES = ['draft', 'scheduled', 'open', 'closed'] as const;

const EventRef = z.object({
  eventId: z.uuid(),
  eventName: z.string(),
  /** Platform dashboard only. */
  organizationName: z.string().nullable(),
});

/** GET /dashboard/events: events by status and the next one to open. */
export const DashboardEventsSchema = z.object({
  byStatus: z.object({
    draft: z.number().int(),
    scheduled: z.number().int(),
    open: z.number().int(),
    closed: z.number().int(),
    results_published: z.number().int(),
  }),
  nextToOpen: EventRef.extend({ startAt: z.iso.datetime() }).nullable(),
});
export type DashboardEvents = z.infer<typeof DashboardEventsSchema>;

/** GET /dashboard/turnout: one bar per Open event. */
export const DashboardTurnoutSchema = z.array(
  EventRef.extend({ registered: z.number().int(), voted: z.number().int() }),
);
export type DashboardTurnout = z.infer<typeof DashboardTurnoutSchema>;

/** GET /dashboard/ties: categories of closed events with a tie still to resolve. */
export const DashboardTiesSchema = z.array(
  EventRef.extend({ categoryId: z.uuid(), categoryName: z.string() }),
);
export type DashboardTies = z.infer<typeof DashboardTiesSchema>;

/** GET /dashboard/activity: the last 10 audit entries the user may see. */
export const DashboardActivitySchema = z.array(AuditEntrySchema);

const EventStaffRow = z.object({
  eventId: z.uuid(),
  eventName: z.string(),
  status: EventStatusSchema,
  moderators: z.array(z.string()),
  categories: z.number().int(),
});

/** GET /dashboard/event-staff (DSH-02): moderators and categories per event. */
export const DashboardEventStaffSchema = z.array(EventStaffRow);
export type DashboardEventStaff = z.infer<typeof DashboardEventStaffSchema>;

/** GET /dashboard/my-events (DSH-03, DSH-04): the events the user is mapped to. */
export const DashboardMyEventsSchema = z.array(
  z.object({
    eventId: z.uuid(),
    eventName: z.string(),
    status: EventStatusSchema,
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
    role: z.enum(['moderator', 'observer']),
  }),
);
export type DashboardMyEvents = z.infer<typeof DashboardMyEventsSchema>;

/** GET /dashboard/organizations (DSH-01): one row per organization, events inside. */
export const DashboardOrganizationsSchema = z.array(
  z.object({
    id: z.uuid(),
    name: z.string(),
    status: OrgStatusSchema,
    events: z.number().int(),
    moderators: z.number().int(),
    categories: z.number().int(),
    voters: z.number().int(),
    lastActivityAt: z.iso.datetime().nullable(),
    eventRows: z.array(EventStaffRow),
  }),
);
export type DashboardOrganizations = z.infer<typeof DashboardOrganizationsSchema>;

// ---------------------------------------------------------------------------------------------
// Global search (App Flow 3.6)
// ---------------------------------------------------------------------------------------------

export const SearchQuerySchema = z.object({ q: z.string().trim().min(2).max(100) });
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/** At most this many hits per group. */
export const SEARCH_LIMIT = 5;

export const SearchResultsSchema = z.object({
  events: z.array(z.object({ id: z.uuid(), name: z.string(), status: EventStatusSchema })),
  /** Voters of events the user may see, with voter.view; the phone is never returned. */
  voters: z.array(
    z.object({
      id: z.uuid(),
      fullName: z.string(),
      membershipId: z.string(),
      eventId: z.uuid(),
      eventName: z.string(),
    }),
  ),
  /** Staff, with staff.manage. */
  staff: z.array(z.object({ id: z.uuid(), fullName: z.string(), email: z.string() })),
});
export type SearchResults = z.infer<typeof SearchResultsSchema>;
