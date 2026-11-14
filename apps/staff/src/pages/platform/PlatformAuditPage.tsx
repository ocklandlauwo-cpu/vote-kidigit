// PLT-05 Platform audit log (App Flow 5.3): the SYS-01 layout across all organizations, with an
// Organization filter (or "Platform" for actions outside any organization).
import { useTranslation } from 'react-i18next';
import { AuditView } from '../audit/AuditPage';
import { useOrganizations } from './platformApi';

export function PlatformAuditPage() {
  const { t } = useTranslation();
  const orgs = useOrganizations({ pageSize: 100, sort: 'name' });
  const organizations = [
    { value: 'platform', label: t('platform.audit.platformOnly') },
    ...(orgs.data?.items ?? []).map((org) => ({ value: org.id, label: org.name })),
  ];
  return (
    <AuditView
      endpoint="/v1/platform/audit"
      withHeader
      title={t('platform.audit.title')}
      organizations={organizations}
    />
  );
}
