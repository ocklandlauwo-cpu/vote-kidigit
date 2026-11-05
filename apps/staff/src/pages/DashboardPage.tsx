// DSH-01 to DSH-04 Dashboard (App Flow 5.1, 5.2). Organization admins see the setup checklist
// (App Flow 7.4); the cards for each role arrive in step 29.
import { useTranslation } from 'react-i18next';
import { hasPermission, useMe } from '../auth/useAuth';
import { EmptyState } from '../components/EmptyState';
import { OnboardingChecklist } from '../components/OnboardingChecklist';
import { PageHeader } from '../components/PageHeader';
import { useOrganization, useUpdateOrganization } from './settings/organizationApi';

export function DashboardPage() {
  const { t } = useTranslation();
  const me = useMe().data;
  const manages = hasPermission(me, 'org.settings.manage');
  const org = useOrganization(manages);
  const update = useUpdateOrganization();
  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        meta={[me ? t('dashboard.welcome', { name: me.fullName }) : null, me?.organization?.name]}
      />
      {manages && org.data && (
        <OnboardingChecklist
          settings={org.data}
          canDismiss
          dismissing={update.isPending}
          onDismiss={() => update.mutate({ onboardingDismissed: true })}
        />
      )}
      <EmptyState kind="list" title={t('dashboard.title')} description={t('dashboard.cardsSoon')} />
    </>
  );
}
