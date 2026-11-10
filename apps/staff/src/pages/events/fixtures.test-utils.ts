// Test data for the event screens.
import type { EventDetail, EventStatus, MeResponse, PermissionKey } from '@vote-kidigit/shared';

export const EVENT_ID = '0190f0a1-2b3c-7d4e-8f90-0000000000f1';

export function me(permissions: PermissionKey[], overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    id: '0190f0a1-2b3c-7d4e-8f90-0000000000a0',
    email: 'staff@example.test',
    fullName: 'Neema Mushi',
    phone: null,
    language: 'sw',
    themePreference: 'system',
    isPlatformAdmin: false,
    isOrgSuperAdmin: false,
    organization: {
      id: '0190f0a1-2b3c-7d4e-8f90-0000000000d1',
      name: 'Chama',
      slug: 'chama',
      timeZone: 'Africa/Dar_es_Salaam',
      primaryColor: null,
      sessionTimeoutMinutes: 15,
    },
    role: null,
    permissions,
    mappedEventIds: [],
    csrfToken: 'c',
    sessionExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    ...overrides,
  };
}

export function eventDetail(
  status: EventStatus,
  overrides: Partial<EventDetail> = {},
): EventDetail {
  return {
    id: EVENT_ID,
    name: 'AGM 2027',
    status,
    isActive: true,
    startAt: '2026-11-20T05:00:00.000Z',
    endAt: '2026-11-20T13:00:00.000Z',
    activeCategories: 2,
    voters: 1200,
    moderators: ['Juma Ali'],
    updatedAt: '2026-11-06T08:00:00.000Z',
    showParty: false,
    resultsVisibility: 'full',
    reminderBeforeOpenHours: 24,
    reminderBeforeCloseMinutes: 60,
    firstCodeSentAt: null,
    openedAt: null,
    closedAt: null,
    cancelledAt: status === 'cancelled' ? '2026-11-06T09:00:00.000Z' : null,
    cancelReason: status === 'cancelled' ? 'Mkutano umeahirishwa' : null,
    cancelledBy: status === 'cancelled' ? 'Neema Mushi <neema@example.test>' : null,
    archivedAt: null,
    categories: 2,
    contesters: 5,
    codeCounts: { notSent: 200, sent: 600, delivered: 380, failed: 20 },
    createdAt: '2026-11-01T08:00:00.000Z',
    ...overrides,
  };
}
