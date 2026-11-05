// Route error boundary: an unexpected failure while rendering shows ERR-05 (or ERR-01 when the
// connection is gone, ERR-03 for an unknown route) instead of a blank page.
import { useTranslation } from 'react-i18next';
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router';
import { isApiError } from '../api/client';
import { ErrorPage } from '../components/ErrorPage';

export function RouteErrorPage() {
  const { t } = useTranslation();
  const error = useRouteError();
  const navigate = useNavigate();
  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <ErrorPage
        kind="notFound"
        action={{ label: t('errorPage.backToDashboard'), onClick: () => void navigate('/') }}
      />
    );
  }
  return (
    <ErrorPage
      kind={isApiError(error, 'NETWORK') ? 'offline' : 'server'}
      onRetry={() => window.location.reload()}
    />
  );
}
