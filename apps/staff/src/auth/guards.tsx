// Route guards (App Flow 3.7): signed-in staff only, a permission behind a section, and sign-in
// screens for signed-out users only. A section the user cannot use answers ERR-03 like a missing
// page, so its existence is not revealed.
import { useQueryClient } from '@tanstack/react-query';
import type { PermissionKey } from '@vote-kidigit/shared';
import { Flex, Spin } from 'antd';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { isApiError } from '../api/client';
import { session } from '../api/session';
import { ErrorPage } from '../components/ErrorPage';
import { AppLayout } from '../layout/AppLayout';
import { landingState, safeReturnTo } from './returnTo';
import { hasAnyPermission, ME_KEY, useMe } from './useAuth';

export function FullPageLoading() {
  const { t } = useTranslation();
  return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh' }}>
      <Spin size="large" aria-label={t('common.loading')} />
    </Flex>
  );
}

/** Signed-in staff only; everything inside gets the portal frame. */
export function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  const queryClient = useQueryClient();

  // Any 401 later on (session ended elsewhere, deactivated, idle) returns to sign-in.
  useEffect(
    () =>
      session.onSignedOut(() => {
        session.clear();
        queryClient.setQueryData(ME_KEY, null);
      }),
    [queryClient],
  );

  if (me.isPending) return <FullPageLoading />;
  if (me.isError) {
    return (
      <ErrorPage
        kind={isApiError(me.error, 'NETWORK') ? 'offline' : 'server'}
        onRetry={() => void me.refetch()}
      />
    );
  }
  if (!me.data) {
    const returnTo = `${location.pathname}${location.search}`;
    const query = returnTo === '/' ? '' : `?returnTo=${encodeURIComponent(returnTo)}`;
    return <Navigate to={`/login${query}`} replace />;
  }
  return <AppLayout me={me.data} />;
}

/** A section behind permissions (App Flow 3.3); ERR-03 when the user holds none of them. */
export function RequirePermission({ anyOf }: { anyOf: readonly PermissionKey[] }) {
  const me = useMe();
  if (!hasAnyPermission(me.data, anyOf)) return <NotFoundPage />;
  return <Outlet />;
}

/** Sign-in and forgot-password: a signed-in user goes straight on. */
export function GuestOnly() {
  const me = useMe();
  const [params] = useSearchParams();
  if (me.isPending) return <FullPageLoading />;
  if (me.data) {
    const to = safeReturnTo(params.get('returnTo'));
    return <Navigate to={to} replace state={landingState(to)} />;
  }
  return <Outlet />;
}

/** ERR-03, inside the portal frame or on its own. */
export function NotFoundPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <ErrorPage
      kind="notFound"
      action={{ label: t('errorPage.backToDashboard'), onClick: () => void navigate('/') }}
    />
  );
}
