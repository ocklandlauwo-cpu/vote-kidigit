import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserSummary } from '@vote-kidigit/shared';
import { App } from 'antd';
import { Outlet } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME_KEY } from '../../auth/useAuth';
import { jsonResponse, renderWithProviders, routeFetch, testQueryClient } from '../../test/render';
import { EventSettings } from './EventSettings';
import { EVENT_ID, eventDetail, me } from './fixtures.test-utils';

const ME_ID = '0190f0a1-2b3c-7d4e-8f90-0000000000a0';
const moderatorRole = {
  id: '0190f0a1-2b3c-7d4e-8f90-000000000201',
  name: 'Msimamizi',
  systemKey: 'moderator',
};
const adminRole = { id: '0190f0a1-2b3c-7d4e-8f90-000000000202', name: 'Admin', systemKey: 'admin' };

function user(n: number, fullName: string, overrides: Partial<UserSummary> = {}): UserSummary {
  return {
    id: `0190f0a1-2b3c-7d4e-8f90-0000000001${String(n).padStart(2, '0')}`,
    fullName,
    email: `user${n}@example.test`,
    phone: null,
    status: 'active',
    isOrgSuperAdmin: false,
    role: moderatorRole,
    lastLoginAt: null,
    createdAt: '2026-11-01T08:00:00.000Z',
    ...overrides,
  };
}

describe('EVT-09 staff assignments', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('offers only people who need a mapping: not admins, Org Super Admins or oneself', async () => {
    const users = [
      user(1, 'Juma Ali'),
      user(2, 'Asha Said', { role: { ...moderatorRole, systemKey: null, name: 'Karani' } }),
      user(3, 'Baraka Admin', { role: adminRole }),
      user(4, 'Neema Mkuu', { isOrgSuperAdmin: true, role: null }),
      user(5, 'Mimi Mwenyewe', { id: ME_ID }),
      user(6, 'Zawadi Zimwa', { status: 'deactivated' }),
    ];
    vi.stubGlobal(
      'fetch',
      routeFetch({
        [`GET /v1/events/${EVENT_ID}/assignments`]: () => jsonResponse(200, { items: [] }),
        'GET /v1/users?pageSize=100': () =>
          jsonResponse(200, { items: users, total: users.length, page: 1, pageSize: 100 }),
      }).fetch,
    );
    const queryClient = testQueryClient();
    queryClient.setQueryData(
      ME_KEY,
      me(['event.view', 'event.edit', 'assignments.manage', 'event.access_all']),
    );
    const { router } = renderWithProviders(<p />, {
      path: '/start',
      queryClient,
      routes: [
        {
          path: '/settings',
          element: (
            <App>
              <Outlet context={eventDetail('draft')} />
            </App>
          ),
          children: [{ index: true, element: <EventSettings /> }],
        },
      ],
    });
    void router.navigate('/settings');

    const select = await screen.findByRole('combobox', { name: 'Ongeza mtu' });
    await waitFor(() => expect(select.closest('.ant-select-loading')).toBeNull());
    await userEvent.click(select);
    await waitFor(() =>
      expect(
        [...document.querySelectorAll('.ant-select-item-option')].map((o) => o.textContent),
      ).toEqual(['Juma Ali', 'Asha Said']),
    );
  });
});
