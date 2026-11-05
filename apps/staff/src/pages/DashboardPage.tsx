// DSH-01 to DSH-04 Dashboard (App Flow 5.1, 5.2). The cards for each role arrive in step 29.
import { useTranslation } from 'react-i18next';
import { useMe } from '../auth/useAuth';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

export function DashboardPage() {
  const { t } = useTranslation();
  const me = useMe().data;
  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        meta={[me ? t('dashboard.welcome', { name: me.fullName }) : null, me?.organization?.name]}
      />
      <EmptyState kind="list" title={t('dashboard.title')} description={t('dashboard.cardsSoon')} />
    </>
  );
}
