import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Permission, PERMISSION_CATALOGUE, type PermissionKey } from '@vote-kidigit/shared';
import { App } from 'antd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithProviders, routeFetch } from '../../test/render';
import { RoleEditor } from './RoleEditorPage';

const CATALOGUE: Permission[] = PERMISSION_CATALOGUE.filter((p) => p.scope !== 'platform').map(
  (p) => ({
    key: p.key,
    scope: p.scope,
    module: p.module,
    descriptionEn: `${p.key} (en)`,
    descriptionSw: `${p.key} (sw)`,
    isFixedForSuperAdmin: p.key === 'roles.manage',
  }),
);

const ROLE_ID = '0190f0a1-2b3c-7d4e-8f90-0000000000aa';

function role(permissions: PermissionKey[], overrides: Record<string, unknown> = {}) {
  return {
    id: ROLE_ID,
    name: 'Karani',
    description: null,
    systemKey: null,
    isSystem: false,
    userCount: 0,
    permissions,
    ...overrides,
  };
}

function renderEditor(
  props: Partial<Parameters<typeof RoleEditor>[0]>,
  routes: Record<string, (body: unknown) => Response> = {},
) {
  const stub = routeFetch({
    'POST /v1/roles': (body) =>
      jsonResponse(201, role((body as { permissions: PermissionKey[] }).permissions)),
    [`PATCH /v1/roles/${ROLE_ID}`]: (body) =>
      jsonResponse(200, role((body as { permissions?: PermissionKey[] }).permissions ?? [])),
    ...routes,
  });
  vi.stubGlobal('fetch', stub.fetch);
  const view = renderWithProviders(
    <App>
      <RoleEditor roleId={undefined} initial={undefined} catalogue={CATALOGUE} {...props} />
    </App>,
    { path: '/roles/new', routes: [{ path: '/roles', element: <p>roles list</p> }] },
  );
  return { ...view, calls: stub.calls };
}

const box = (key: string) =>
  document.querySelector<HTMLInputElement>(
    `[data-permission="${key}"] input, input[data-permission="${key}"]`,
  ) ??
  (document
    .querySelector(`[data-permission="${key}"]`)
    ?.closest('label')
    ?.querySelector('input') as HTMLInputElement);
const group = (module: string) => document.querySelector<HTMLElement>(`[data-module="${module}"]`);
const groupBox = (module: string) =>
  within(group(module) ?? document.body).getByRole('checkbox', {
    name: /Chagua zote katika kundi/,
  });

describe('USR-05 role editor', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('groups permissions by module in the App Flow order', async () => {
    renderEditor({});
    await screen.findByRole('heading', { level: 1, name: 'Jukumu jipya' });
    const modules = [...document.querySelectorAll('[data-module]')].map((el) =>
      el.getAttribute('data-module'),
    );
    expect(modules).toEqual([
      'Events',
      'Setup',
      'Voters',
      'Messages',
      'Kiosk',
      'Results',
      'Users',
      'Settings',
      'Audit',
    ]);
    // Platform permissions are never offered.
    expect(screen.queryByText(/platform\./)).toBeNull();
    // Swahili descriptions in Swahili.
    expect(screen.getByText('voter.view (sw)')).toBeInTheDocument();
  });

  it('"select all in group" ticks the whole group and shows a partial group as mixed', async () => {
    renderEditor({});
    await screen.findByText('voter.view (sw)');
    await userEvent.click(screen.getByText('voter.view (sw)'));
    // The native indeterminate state is what assistive technology reports as "mixed".
    expect((groupBox('Voters') as HTMLInputElement).indeterminate).toBe(true);
    await userEvent.click(groupBox('Voters'));
    expect(groupBox('Voters')).toBeChecked();
    expect(box('voter.manage')).toBeChecked();
    await userEvent.click(groupBox('Voters'));
    expect(box('voter.view')).not.toBeChecked();
    expect(box('voter.manage')).not.toBeChecked();
  });

  it('creates a role with its name and ticked permissions', async () => {
    const { calls, router } = renderEditor({});
    await userEvent.type(await screen.findByLabelText('Jina la jukumu'), 'Karani wa kura');
    await userEvent.click(groupBox('Voters'));
    await userEvent.click(screen.getByText('event.view (sw)'));
    await userEvent.click(screen.getByRole('button', { name: 'Hifadhi' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/roles'));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({
      name: 'Karani wa kura',
      description: null,
      permissions: expect.arrayContaining(['voter.view', 'voter.manage', 'event.view']) as unknown,
    });
    expect((post?.body as { permissions: string[] }).permissions).toHaveLength(3);
  });

  it('asks for a name and shows a taken name from the server on the field', async () => {
    const { calls } = renderEditor(
      {},
      {
        'POST /v1/roles': () =>
          jsonResponse(400, {
            code: 'VALIDATION_FAILED',
            message: 'x',
            details: { issues: [{ path: 'name', code: 'taken', message: 'x' }] },
          }),
      },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Hifadhi' }));
    expect(await screen.findByText('Andika jina lenye herufi 2 hadi 60')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    await userEvent.type(screen.getByLabelText('Jina la jukumu'), 'Admin');
    await userEvent.click(screen.getByRole('button', { name: 'Hifadhi' }));
    expect(await screen.findByText('Jukumu lenye jina hili tayari lipo.')).toBeInTheDocument();
  });

  it('keeps the name of a default role and roles.manage on Org Super Admin', async () => {
    const all = CATALOGUE.map((p) => p.key);
    const { calls } = renderEditor({
      roleId: ROLE_ID,
      initial: role(all, { name: 'Org Super Admin', systemKey: 'org_super_admin', isSystem: true }),
    });
    expect(
      await screen.findByText('Majukumu ya chaguo-msingi hayabadilishwi jina wala kufutwa.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Jina la jukumu')).toBeDisabled();
    expect(box('roles.manage')).toBeChecked();
    expect(box('roles.manage')).toBeDisabled();
    // Unticking the whole Users group leaves the fixed permission ticked.
    await userEvent.click(groupBox('Users'));
    expect(box('roles.manage')).toBeChecked();
    expect(box('staff.manage')).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Hifadhi' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH');
    // Default roles send permissions only, never a name.
    expect(Object.keys(patch?.body as object)).toEqual(['permissions']);
    expect((patch?.body as { permissions: string[] }).permissions).toContain('roles.manage');
    expect((patch?.body as { permissions: string[] }).permissions).not.toContain('staff.manage');
  });

  it('duplicates a role as "Copy of …" with its permissions', async () => {
    const { calls } = renderEditor({
      initial: role(['event.view', 'turnout.view'], { name: 'Mwangalizi' }),
    });
    expect(await screen.findByLabelText('Jina la jukumu')).toHaveValue('Nakala ya Mwangalizi');
    expect(box('event.view')).toBeChecked();
    expect(box('turnout.view')).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Hifadhi' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      name: 'Nakala ya Mwangalizi',
      permissions: ['event.view', 'turnout.view'],
    });
  });
});
