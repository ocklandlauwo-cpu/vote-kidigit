import type { PermissionKey } from '@vote-kidigit/shared';
import type { ParseKeys } from 'i18next';
import { createBrowserRouter, type RouteObject, type UIMatch } from 'react-router';
import {
  FullPageLoading,
  GuestOnly,
  NotFoundPage,
  RequireAuth,
  RequirePermission,
} from './auth/guards';
import type { RouteHandle } from './layout/Breadcrumbs';
import { AuthLayout } from './layout/AuthLayout';
import { AcceptInvitePage } from './pages/auth/AcceptInvitePage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { SignInPage } from './pages/auth/SignInPage';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { AuditPage } from './pages/audit/AuditPage';
import { DashboardPage } from './pages/DashboardPage';
import { EventCrumb } from './pages/events/EventCrumb';
import { EventOverview } from './pages/events/EventOverview';
import { EventSettings } from './pages/events/EventSettings';
import { EventsPage } from './pages/events/EventsPage';
import { EventActivity, EventTabSoon } from './pages/events/EventTabs';
import { EventWorkspace } from './pages/events/EventWorkspace';
import { ProfilePage } from './pages/profile/ProfilePage';
import { RoleEditorPage } from './pages/roles/RoleEditorPage';
import { RolesPage } from './pages/roles/RolesPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { UsersPage } from './pages/users/UsersPage';
import { WelcomePage } from './pages/WelcomePage';
import { RouteErrorPage } from './pages/RouteErrorPage';

/** A menu section whose screens arrive later, behind its permissions (App Flow 2.1, 3.3). */
function section(path: string, title: ParseKeys, anyOf: PermissionKey[]): RouteObject {
  const handle: RouteHandle = { crumb: title };
  return {
    path,
    handle,
    element: anyOf.length ? <RequirePermission anyOf={anyOf} /> : undefined,
    children: [{ index: true, element: <ComingSoonPage title={title} /> }],
  };
}

// React Router 7 in data mode (Tech Stack 7), basename /app (App Flow 2.1). The component gallery
// exists only in development: import.meta.env.DEV is false in production builds, so the route
// and its lazy chunk are removed entirely.
export const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorPage />,
    // Shown while a lazy route (the gallery) loads on first visit.
    hydrateFallbackElement: <FullPageLoading />,
    children: [
      {
        element: <AuthLayout />,
        children: [
          {
            element: <GuestOnly />,
            children: [
              { path: 'login', element: <SignInPage /> },
              { path: 'forgot', element: <ForgotPasswordPage /> },
            ],
          },
          { path: 'invite/:token', element: <AcceptInvitePage /> },
          { path: 'reset/:token', element: <ResetPasswordPage /> },
        ],
      },
      // Developer tool, no sign-in needed.
      ...(import.meta.env.DEV
        ? [
            {
              path: 'dev/components',
              lazy: async () => ({
                Component: (await import('./dev/ComponentGallery')).default,
              }),
            },
          ]
        : []),
      {
        element: <RequireAuth />,
        children: [
          { index: true, element: <DashboardPage />, handle: { crumb: 'nav.dashboard' } },
          { path: 'welcome', element: <WelcomePage /> },
          { path: 'profile', element: <ProfilePage />, handle: { crumb: 'nav.profile' } },
          section('platform/orgs', 'nav.organizations', ['platform.orgs.manage']),
          section('platform/audit', 'nav.audit', ['platform.audit.view']),
          section('platform/settings', 'nav.settings', ['platform.settings.manage']),
          {
            path: 'events',
            handle: { crumb: 'nav.events' },
            element: <RequirePermission anyOf={['event.view', 'event.create']} />,
            children: [
              { index: true, element: <EventsPage /> },
              {
                path: ':eventId',
                element: <EventWorkspace />,
                handle: {
                  crumb: (match: UIMatch) => <EventCrumb eventId={match.params.eventId} />,
                } satisfies RouteHandle,
                children: [
                  { index: true, element: <EventOverview /> },
                  {
                    path: 'settings',
                    element: <EventSettings />,
                    handle: { crumb: 'events.tabs.settings' },
                  },
                  {
                    path: 'audit',
                    element: <EventActivity />,
                    handle: { crumb: 'events.tabs.activity' },
                  },
                  ...(['live', 'categories', 'voters', 'messages', 'results'] as const).map(
                    (tab) => ({
                      path: tab,
                      element: <EventTabSoon />,
                      handle: { crumb: `events.tabs.${tab}` as const },
                    }),
                  ),
                ],
              },
            ],
          },
          {
            path: 'users',
            handle: { crumb: 'nav.users' },
            element: <RequirePermission anyOf={['staff.manage']} />,
            children: [{ index: true, element: <UsersPage /> }],
          },
          {
            path: 'roles',
            handle: { crumb: 'nav.roles' },
            element: <RequirePermission anyOf={['roles.manage']} />,
            children: [
              { index: true, element: <RolesPage /> },
              { path: 'new', element: <RoleEditorPage />, handle: { crumb: 'roles.editorNew' } },
              { path: ':roleId', element: <RoleEditorPage /> },
            ],
          },
          {
            path: 'audit',
            handle: { crumb: 'nav.audit' },
            element: <RequirePermission anyOf={['audit.view.org']} />,
            children: [{ index: true, element: <AuditPage /> }],
          },
          {
            path: 'settings',
            handle: { crumb: 'nav.settings' },
            element: <RequirePermission anyOf={['org.settings.manage']} />,
            children: [{ index: true, element: <SettingsPage /> }],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes, { basename: '/app' });
