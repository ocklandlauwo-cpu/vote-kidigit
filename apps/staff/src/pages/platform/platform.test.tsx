// PLT-01 to PLT-05 (App Flow 5.3): list and filters, create with the first Org Super Admin,
// suspend with typed name and reason (refused while an event is Open), platform settings, and
// the platform audit log with its Organization filter.
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OrganizationDetail, OrganizationSummary } from '@vote-kidigit/shared';
import { App } from 'antd';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME_KEY } from '../../auth/useAuth';
import { i18n } from '../../i18n';
import { jsonResponse, routeFetch, testQueryClient } from '../../test/render';
import { me } from '../events/fixtures.test-utils';
import { OrganizationDetailPage } from './OrganizationDetailPage';
import { OrganizationsPage } from './OrganizationsPage';
import { PlatformAuditPage } from './PlatformAuditPage';
import { PlatformSettingsPage } from './PlatformSettingsPage';

const ORG_ID = '0190f0a1-2b3c-7d4e-8f90-0000000000e1';
const CREATED = '2026-11-01T08:00:00.000Z';

const summary: OrganizationSummary = {
  id: ORG_ID,
  name: 'SACCO ya Walimu',
  slug: 'sacco-ya-walimu',
  status: 'active',
  superAdmin: {
    id: '0190f0a1-2b3c-7d4e-8f90-0000000000e2',
    fullName: 'Asha Mwinyi',
    email: 'asha@example.test',
    status: 'invited',
  },
  staffCount: 3,
  createdAt: CREATED,
};

const detail: OrganizationDetail = {
  ...summary,
  timeZone: 'Africa/Dar_es_Salaam',
  contactEmail: 'ofisi@example.test',
  contactPhone: '+255754000111',
  smsSenderId: 'WALIMU',
  helpPhone: null,
  sessionTimeoutMinutes: 15,
  staff: [
    {
      id: '0190f0a1-2b3c-7d4e-8f90-0000000000e2',
      fullName: 'Asha Mwinyi',
      email: 'asha@example.test',
      status: 'invited',
      isOrgSuperAdmin: true,
      roleName: null,
      lastLoginAt: null,
    },
  ],
};

const page = (items: OrganizationSummary[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 50,
});

function renderPage(
  ui: ReactElement,
  path: string,
  routes: Record<string, (b: unknown) => Response>,
) {
  const stub = routeFetch(routes);
  vi.stubGlobal('fetch', stub.fetch);
  const queryClient = testQueryClient();
  queryClient.setQueryData(
    ME_KEY,
    me(['platform.orgs.manage', 'platform.audit.view', 'platform.settings.manage'], {
      isPlatformAdmin: true,
      organization: null,
    }),
  );
  const pattern = path.startsWith('/platform/orgs/') ? '/platform/orgs/:orgId' : path.split('?')[0];
  const router = createMemoryRouter(
    [
      { path: pattern, element: <App>{ui}</App> },
      ...(pattern === '/platform/orgs/:orgId'
        ? []
        : [{ path: '/platform/orgs/:orgId', element: <p>detail page</p> }]),
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { router, calls: stub.calls };
}

afterEach(() => vi.unstubAllGlobals());

describe('PLT-01 and PLT-02 organizations', () => {
  it('lists organizations and filters by status through the API', async () => {
    const user = userEvent.setup();
    const { calls } = renderPage(<OrganizationsPage />, '/platform/orgs', {
      'GET /v1/platform/organizations?page=1&pageSize=50': () => jsonResponse(200, page([summary])),
      'GET /v1/platform/organizations?status=suspended&page=1&pageSize=50': () =>
        jsonResponse(200, page([])),
    });
    expect(await screen.findByRole('button', { name: 'SACCO ya Walimu' })).toBeInTheDocument();
    expect(screen.getByText('Asha Mwinyi')).toBeInTheDocument();
    expect(screen.getByText('Amealikwa')).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Hali' }));
    await user.click(await screen.findByTitle('Imesimamishwa'));
    expect(await screen.findByText('Hakuna mashirika yanayolingana')).toBeInTheDocument();
    expect(calls.map((c) => c.path)).toContain(
      '/v1/platform/organizations?status=suspended&page=1&pageSize=50',
    );
  });

  it('creates an organization with its first Org Super Admin and opens it', async () => {
    const user = userEvent.setup();
    const { calls, router } = renderPage(<OrganizationsPage />, '/platform/orgs?create=1', {
      'GET /v1/platform/organizations?page=1&pageSize=50': () => jsonResponse(200, page([])),
      'POST /v1/platform/organizations': () =>
        jsonResponse(201, { organization: detail, invitationSent: true }),
    });
    const drawer = await screen.findByRole('dialog');
    await user.type(within(drawer).getByLabelText('Jina la shirika'), 'SACCO ya Walimu');
    await user.type(within(drawer).getByLabelText('Jina kamili'), 'Asha Mwinyi');
    await user.type(within(drawer).getByLabelText('Barua pepe'), 'asha@example.test');
    await user.click(within(drawer).getByRole('button', { name: 'Unda na tuma mwaliko' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/platform/orgs/${ORG_ID}`));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'SACCO ya Walimu',
      timeZone: 'Africa/Dar_es_Salaam',
      contactEmail: null,
      contactPhone: null,
      smsSenderId: null,
      superAdmin: { fullName: 'Asha Mwinyi', email: 'asha@example.test' },
    });
  });

  it('marks an email that already has an account', async () => {
    const user = userEvent.setup();
    renderPage(<OrganizationsPage />, '/platform/orgs?create=1', {
      'GET /v1/platform/organizations?page=1&pageSize=50': () => jsonResponse(200, page([])),
      'POST /v1/platform/organizations': () =>
        jsonResponse(400, {
          code: 'VALIDATION_FAILED',
          message: 'x',
          details: { issues: [{ path: 'superAdmin.email', code: 'taken', message: 'x' }] },
        }),
    });
    const drawer = await screen.findByRole('dialog');
    await user.type(within(drawer).getByLabelText('Jina la shirika'), 'Chama');
    await user.type(within(drawer).getByLabelText('Jina kamili'), 'Asha Mwinyi');
    await user.type(within(drawer).getByLabelText('Barua pepe'), 'asha@example.test');
    await user.click(within(drawer).getByRole('button', { name: 'Unda na tuma mwaliko' }));
    expect(await screen.findByText('Barua pepe hii tayari ina akaunti')).toBeInTheDocument();
  });
});

describe('PLT-03 organization detail', () => {
  const routes = (suspend: () => Response) => ({
    [`GET /v1/platform/organizations/${ORG_ID}`]: () => jsonResponse(200, detail),
    [`POST /v1/platform/organizations/${ORG_ID}/suspend`]: suspend,
  });

  it('suspends after the name is typed and a reason given', async () => {
    const user = userEvent.setup();
    const { calls } = renderPage(
      <OrganizationDetailPage />,
      `/platform/orgs/${ORG_ID}`,
      routes(() => jsonResponse(200, { ...detail, status: 'suspended' })),
    );
    expect(await screen.findByRole('heading', { name: 'SACCO ya Walimu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tuma mwaliko tena' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Simamisha' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Simamisha' });
    expect(confirm).toBeDisabled();
    for (const box of within(dialog).getAllByRole('textbox')) {
      await user.type(box, box.tagName === 'TEXTAREA' ? 'Ada haijalipwa' : 'SACCO ya Walimu');
    }
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/suspend'))?.body).toEqual({
        reason: 'Ada haijalipwa',
      }),
    );
  });

  it('explains that an organization with an Open event cannot be suspended', async () => {
    const user = userEvent.setup();
    renderPage(
      <OrganizationDetailPage />,
      `/platform/orgs/${ORG_ID}`,
      routes(() =>
        jsonResponse(409, {
          code: 'INVALID_TRANSITION',
          message: 'x',
          details: { reason: 'EVENT_OPEN' },
        }),
      ),
    );
    await user.click(await screen.findByRole('button', { name: 'Simamisha' }));
    const dialog = await screen.findByRole('dialog');
    for (const box of within(dialog).getAllByRole('textbox')) {
      await user.type(box, box.tagName === 'TEXTAREA' ? 'Ada haijalipwa' : 'SACCO ya Walimu');
    }
    await user.click(within(dialog).getByRole('button', { name: 'Simamisha' }));
    expect(
      await within(dialog).findByText(
        'Haiwezekani kusimamisha wakati uchaguzi wa shirika hili uko wazi.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the staff read-only', async () => {
    const user = userEvent.setup();
    renderPage(
      <OrganizationDetailPage />,
      `/platform/orgs/${ORG_ID}`,
      routes(() => jsonResponse(200, detail)),
    );
    await user.click(await screen.findByRole('tab', { name: 'Wafanyakazi' }));
    const table = await screen.findByRole('table');
    expect(within(table).getByText('asha@example.test')).toBeInTheDocument();
    expect(within(table).queryByRole('button')).toBeNull();
  });
});

describe('PLT-04 and PLT-05', () => {
  it('saves platform settings and refuses a malformed USSD code', async () => {
    const user = userEvent.setup();
    const settings = {
      defaultSessionTimeoutMinutes: 15,
      ussdShortCode: null,
      supportPhone: null,
      supportEmail: null,
      updatedAt: CREATED,
    };
    const { calls } = renderPage(<PlatformSettingsPage />, '/platform/settings', {
      'GET /v1/platform/settings': () => jsonResponse(200, settings),
      'PATCH /v1/platform/settings': () =>
        jsonResponse(200, { ...settings, ussdShortCode: '*150*12#' }),
    });
    const code = await screen.findByLabelText('Namba fupi ya USSD');
    await user.type(code, '150');
    await user.click(screen.getByRole('button', { name: 'Hifadhi' }));
    expect(await screen.findByText('Weka namba kama *150*12#')).toBeInTheDocument();
    await user.clear(code);
    await user.type(code, '*150*12#');
    await user.click(screen.getByRole('button', { name: 'Hifadhi' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
        ussdShortCode: '*150*12#',
        defaultSessionTimeoutMinutes: 15,
      }),
    );
  });

  it('reads the platform audit log with an Organization column and filter', async () => {
    const entry = {
      id: '0190f0a1-2b3c-7d4e-8f90-0000000000f1',
      organizationId: ORG_ID,
      organizationName: 'SACCO ya Walimu',
      actorType: 'user',
      actorUserId: null,
      actorLabel: 'Juma Admin',
      action: 'platform.org.suspend',
      entityType: 'organizations',
      entityId: ORG_ID,
      eventId: null,
      before: null,
      after: null,
      reason: null,
      ip: null,
      createdAt: CREATED,
    };
    renderPage(<PlatformAuditPage />, '/platform/audit', {
      'GET /v1/platform/organizations?pageSize=100&sort=name': () =>
        jsonResponse(200, page([summary])),
      'GET /v1/platform/audit?page=1&pageSize=50': () =>
        jsonResponse(200, { items: [entry], total: 1, page: 1, pageSize: 50 }),
    });
    expect(
      await screen.findByRole('heading', { name: 'Kumbukumbu za jukwaa' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('platform.org.suspend')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Shirika' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Shirika' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hamisha|Pakua/ })).toBeNull();
  });
});
