// A section of the menu whose screens arrive in a later step (Implementation Plan 14–29). The
// route, its permission guard and breadcrumb exist already; only the content is missing.
import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

export function ComingSoonPage({ title }: { title: ParseKeys }) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t(title)} />
      <EmptyState
        kind="list"
        title={t('common.comingSoonTitle')}
        description={t('common.comingSoonBody')}
      />
    </>
  );
}
