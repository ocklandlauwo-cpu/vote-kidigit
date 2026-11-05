import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AssignableRole, MeResponse, PermissionKey, UserDetail } from '@vote-kidigit/shared';
import { App } from 'antd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME_KEY } from '../../auth/useAuth';
import { jsonResponse, renderWithProviders, routeFetch, testQueryClient } from '../../test/render';
import { UserDrawer } from './UserDrawer';

const USER_ID = '0190f0a1-2b3c-7d4e-8f90-0000000000b1';
const ME_ID = '0190f0a1-2b3c-7d4e-8f90-0000000000b0';
const ROLE = {
  moderator: '0190f0a1-2b3c-7d4e-8f90-0000000000c1',
  observer: '0190f0a1-2b3c-7d4e-8f90-0000000000c2',
  admin: '0190f0a1-2b3c-7d4e-8f90-0000000000c3',
  superAdmin: '0190f0a1-2b3c-7d4e-8f90-0000000000c4',
};

function me(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    id: ME_ID,
    email: 'admin@example.test',
    fullName: 'Admin',
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
    role: { id: ROLE.admin, name: 'Admin', systemKey: 'admin' },
    permissions: ['staff.manage'] as PermissionKey[],
    mappedEventIds: [],
    csrfToken: 'c',
    sessionExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    ...overrides,
  };
}

function user(overrides: Partial<UserDetail> = {}): UserDetail {
  return {
    id: USER_ID,
    fullName: 'Juma Ali',
    email: 'juma@example.test',
    phone: '+255712000111',
    status: 'active',
    isOrgSuperAdmin: false,
    role: { id: ROLE.moderator, name: 'Moderator', systemKey: 'moderator' },
    lastLoginAt: '2026-11-03T11:00:00.000Z',
    createdAt: '2026-11-01T08:00:00.000Z',
    invitation: null,
    recentActivity: [
      {
        id: '0190f0a1-2b3c-7d4e-8f90-0000000000e1',
        organizationId: null,
        organizationName: null,
        actorType: 'user',
        actorUserId: ME_ID,
        actorLabel: 'Admin <admin@example.test>',
        eventId: null,
        action: 'user.invite',
        entityType: 'users',
        entityId: USER_ID,
        before: null,
        after: null,
        reason: null,
        ip: null,
        createdAt: '2026-11-01T08:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

const ROLES: AssignableRole[] = [
  {
    id: ROLE.superAdmin,
    name: 'Org Super Admin',
    systemKey: 'org_super_admin',
    isSystem: true,
    assignable: false,
  },
  { id: ROLE.admin, name: 'Admin', systemKey: 'admin', isSystem: true, assignable: false },
  {
    id: ROLE.moderator,
    name: 'Moderator',
    systemKey: 'moderator',
    isSystem: true,
    assignable: true,
  },
  { id: ROLE.observer, name: 'Observer', systemKey: 'observer', isSystem: true, assignable: true },
];

function renderDrawer(
  detail: UserDetail,
  routes: Record<string, (body: unknown) => Response> = {},
  signedIn: MeResponse = me(),
) {
  const stub = routeFetch({
    [`GET /v1/users/${USER_ID}`]: () => jsonResponse(200, detail),
    'GET /v1/users/roles': () => jsonResponse(200, { items: ROLES }),
    ...routes,
  });
  vi.stubGlobal('fetch', stub.fetch);
  const queryClient = testQueryClient();
  queryClient.setQueryData(ME_KEY, signedIn);
  const onClose = vi.fn();
  const view = renderWithProviders(
    <App>
      <UserDrawer userId={detail.id} onClose={onClose} />
    </App>,
    { queryClient },
  );
  return { ...view, calls: stub.calls, onClose };
}

const button = (name: string) => screen.getByRole('button', { name });

/** The button once it is usable: actions wait for the role list (assignable roles). */
async function enabled(name: string): Promise<HTMLElement> {
  // Looked up on every try: the enabled button replaces the greyed-out one (with its tooltip).
  return waitFor(() => {
    const found = screen.getByRole('button', { name });
    expect(found).toBeEnabled();
    return found;
  });
}

describe('USR-03 user drawer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the details, role, status and recent activity', async () => {
    renderDrawer(user());
    expect(
      await screen.findByText('juma@example.test', { selector: '.ant-typography' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Hai')).toBeInTheDocument(); // status badge
    expect(screen.getByText('Msimamizi wa uchaguzi')).toBeInTheDocument(); // default role, in Swahili
    expect(screen.getByText('3 Nov 2026, saa 14:00')).toBeInTheDocument();
    expect(screen.getByText('user.invite')).toBeInTheDocument();
  });

  it('shows the pending invitation and resends it', async () => {
    const { calls } = renderDrawer(
      user({
        status: 'invited',
        lastLoginAt: null,
        invitation: { sentAt: '2026-11-03T11:00:00.000Z', expiresAt: '2099-11-05T11:00:00.000Z' },
      }),
      {
        [`POST /v1/users/${USER_ID}/resend-invite`]: () =>
          jsonResponse(200, { invitationSent: true }),
      },
    );
    expect(await screen.findByText(/Ulitumwa 3 Nov 2026, saa 14:00/)).toBeInTheDocument();
    await userEvent.click(await enabled('Tuma mwaliko tena'));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/resend-invite'))).toBe(
        true,
      ),
    );
    expect(await screen.findByText('Mwaliko umetumwa tena')).toBeInTheDocument();
  });

  it('deactivates after confirmation', async () => {
    const { calls } = renderDrawer(user(), {
      [`POST /v1/users/${USER_ID}/deactivate`]: () =>
        jsonResponse(200, user({ status: 'deactivated' })),
    });
    await userEvent.click(await enabled('Zima akaunti'));
    expect(await screen.findByText('Zima akaunti ya Juma Ali?')).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/deactivate'))).toBe(false);
    const dialogButtons = screen.getAllByRole('button', { name: 'Zima akaunti' });
    await userEvent.click(dialogButtons[dialogButtons.length - 1] as HTMLElement);
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/deactivate'))).toBe(true));
    expect(await screen.findByText('Akaunti imezimwa')).toBeInTheDocument();
  });

  it('offers Reactivate for a deactivated user', async () => {
    renderDrawer(user({ status: 'deactivated' }));
    expect(await enabled('Washa akaunti')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Zima akaunti' })).toBeNull();
  });

  it('deletes only after typing the name', async () => {
    const { calls, onClose } = renderDrawer(user(), {
      [`DELETE /v1/users/${USER_ID}`]: () => new Response(null, { status: 204 }),
    });
    await userEvent.click(await enabled('Futa'));
    const input = await screen.findByLabelText('Andika "Juma Ali" kuthibitisha');
    const confirmDelete = () =>
      screen.getAllByRole('button', { name: 'Futa' }).at(-1) as HTMLElement;
    expect(confirmDelete()).toBeDisabled();
    await userEvent.type(input, 'Juma Ali');
    await userEvent.click(confirmDelete());
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('edits name, phone and role, offering only the roles the user may give', async () => {
    const { calls } = renderDrawer(user(), {
      [`PATCH /v1/users/${USER_ID}`]: () =>
        jsonResponse(
          200,
          user({ role: { id: ROLE.observer, name: 'Observer', systemKey: 'observer' } }),
        ),
    });
    await userEvent.click(await enabled('Hariri'));
    const name = screen.getByLabelText('Jina kamili');
    await userEvent.clear(name);
    await userEvent.type(name, 'Juma Hamisi');
    await userEvent.click(screen.getByLabelText('Jukumu'));
    const admin = await screen.findByTitle('Msimamizi', { exact: true });
    expect(admin.closest('.ant-select-item')).toHaveClass('ant-select-item-option-disabled');
    await userEvent.click(await screen.findByTitle('Mwangalizi'));
    await userEvent.click(button('Hifadhi'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      fullName: 'Juma Hamisi',
      phone: '+255712000111',
      roleId: ROLE.observer,
    });
  });

  it('greys out every action on your own account', async () => {
    renderDrawer(user({ id: USER_ID }), {}, me({ id: USER_ID }));
    expect(await screen.findByRole('button', { name: 'Hariri' })).toBeDisabled();
    expect(button('Zima akaunti')).toBeDisabled();
    expect(button('Futa')).toBeDisabled();
  });

  it('greys out actions an Admin may not take on an Org Super Admin or another Admin', async () => {
    const view = renderDrawer(
      user({
        isOrgSuperAdmin: true,
        role: { id: ROLE.superAdmin, name: 'Org Super Admin', systemKey: 'org_super_admin' },
      }),
    );
    expect(await screen.findByRole('button', { name: 'Zima akaunti' })).toBeDisabled();
    view.unmount();
    renderDrawer(user({ role: { id: ROLE.admin, name: 'Admin', systemKey: 'admin' } }));
    expect(await screen.findByRole('button', { name: 'Zima akaunti' })).toBeDisabled();
  });

  it('explains when the organization would lose its last Org Super Admin', async () => {
    renderDrawer(user(), {
      [`POST /v1/users/${USER_ID}/deactivate`]: () =>
        jsonResponse(409, { code: 'LAST_SUPER_ADMIN', message: 'x' }),
    });
    await userEvent.click(await enabled('Zima akaunti'));
    const dialogButtons = await screen.findAllByRole('button', { name: 'Zima akaunti' });
    await userEvent.click(dialogButtons.at(-1) as HTMLElement);
    expect(
      await screen.findByText('Shirika linahitaji angalau Msimamizi Mkuu mmoja aliye hai.'),
    ).toBeInTheDocument();
  });

  it('shows ERR-03 for a user that does not exist', async () => {
    vi.stubGlobal('fetch', routeFetch({}).fetch);
    const queryClient = testQueryClient();
    queryClient.setQueryData(ME_KEY, me());
    renderWithProviders(
      <App>
        <UserDrawer userId={USER_ID} onClose={vi.fn()} />
      </App>,
      { queryClient },
    );
    expect(await screen.findByText('Hatukuweza kupata ukurasa huo')).toBeInTheDocument();
  });
});
