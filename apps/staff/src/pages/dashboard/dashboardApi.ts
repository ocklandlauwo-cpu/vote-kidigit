// Dashboard cards (App Flow 5.2): one query each, so a slow or failing card never holds up the
// others. Turnout refreshes every 30 seconds like the control room.
import { useQuery } from '@tanstack/react-query';
import {
  DashboardActivitySchema,
  DashboardEventsSchema,
  DashboardEventStaffSchema,
  DashboardMyEventsSchema,
  DashboardOrganizationsSchema,
  DashboardTiesSchema,
  DashboardTurnoutSchema,
  SearchResultsSchema,
} from '@vote-kidigit/shared';
import { api } from '../../api/client';

const TURNOUT_REFRESH_MS = 30_000;

function card<T>(
  name: string,
  schema: { parse: (data: unknown) => T },
  enabled: boolean,
  refetchInterval?: number,
) {
  return {
    queryKey: ['dashboard', name],
    queryFn: () => api(`/v1/dashboard/${name}`, { schema }),
    enabled,
    refetchInterval,
  };
}

export const useDashboardEvents = (enabled = true) =>
  useQuery(card('events', DashboardEventsSchema, enabled));
export const useDashboardTurnout = (enabled = true) =>
  useQuery(card('turnout', DashboardTurnoutSchema, enabled, TURNOUT_REFRESH_MS));
export const useDashboardTies = (enabled = true) =>
  useQuery(card('ties', DashboardTiesSchema, enabled));
export const useDashboardActivity = (enabled = true) =>
  useQuery(card('activity', DashboardActivitySchema, enabled));
export const useDashboardEventStaff = (enabled = true) =>
  useQuery(card('event-staff', DashboardEventStaffSchema, enabled));
export const useDashboardMyEvents = (enabled = true) =>
  useQuery(card('my-events', DashboardMyEventsSchema, enabled));
export const useDashboardOrganizations = (enabled = true) =>
  useQuery(card('organizations', DashboardOrganizationsSchema, enabled));

/** Global search (App Flow 3.6): from 2 characters. */
export function useSearch(q: string) {
  const text = q.trim();
  return useQuery({
    queryKey: ['search', text],
    queryFn: () => api(`/v1/search?q=${encodeURIComponent(text)}`, { schema: SearchResultsSchema }),
    enabled: text.length >= 2,
    placeholderData: (previous) => previous,
  });
}
