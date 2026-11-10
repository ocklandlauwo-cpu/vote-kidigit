// "Unsaved changes" warning (App Flow 7.3, SYS-03): leaving the page inside the portal asks
// first; closing or reloading the tab gets the browser's own prompt.
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker } from 'react-router';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function UnsavedChangesPrompt({
  dirty,
  title,
  body,
}: {
  dirty: boolean;
  /** Wording for a screen that says more than "unsaved changes" (e.g. EVT-06). */
  title?: string;
  body?: string;
}) {
  const { t } = useTranslation();
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      tone="warning"
      title={title ?? t('common.unsavedTitle')}
      body={body ?? t('common.unsavedBody')}
      confirmLabel={t('common.leave')}
      onConfirm={() => blocker.proceed?.()}
      onCancel={() => blocker.reset?.()}
    />
  );
}
