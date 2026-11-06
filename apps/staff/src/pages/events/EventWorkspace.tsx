// Event workspace (App Flow 3.4): header with the status badge, voting window, the main action
// for the status and a "More" menu, then the tabs (Live first while Open). Actions the user may
// not take are greyed out with the reason (App Flow 3.7).
import { MoreOutlined } from '@ant-design/icons';
import type { EventDetail } from '@vote-kidigit/shared';
import { App, Button, Dropdown, Skeleton, Tabs, Tag, Tooltip } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { isApiError } from '../../api/client';
import { errorMessage } from '../../api/errorMessage';
import { hasPermission, useMe } from '../../auth/useAuth';
import { NotFoundPage } from '../../auth/guards';
import { Banner } from '../../components/Banner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorPage } from '../../components/ErrorPage';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { useFormat } from '../../hooks/useFormat';
import { mainAction, moreActions } from './eventActions';
import { useEvent, useSetEventActive } from './eventsApi';

const TABS = [
  'overview',
  'categories',
  'voters',
  'messages',
  'results',
  'settings',
  'activity',
] as const;

export function EventWorkspace() {
  const { eventId } = useParams();
  const event = useEvent(eventId);
  if (event.isPending) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (event.isError) {
    if (isApiError(event.error, 'NOT_FOUND')) return <NotFoundPage />;
    return (
      <ErrorPage
        kind={isApiError(event.error, 'NETWORK') ? 'offline' : 'server'}
        onRetry={() => void event.refetch()}
      />
    );
  }
  return <Workspace event={event.data} />;
}

function Workspace({ event }: { event: EventDetail }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const format = useFormat();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const me = useMe().data;
  const setActive = useSetEventActive(event.id);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const base = `/events/${event.id}`;
  const tabs = [...(event.status === 'open' ? (['live'] as const) : []), ...TABS].filter(
    (tab) => tab !== 'activity' || hasPermission(me, 'audit.view.event'),
  );
  const segment = pathname.slice(base.length).split('/')[1] ?? '';
  const activeTab = segment === '' ? 'overview' : segment === 'audit' ? 'activity' : segment;

  const main = mainAction(event.status);
  const mainButton = main
    ? (() => {
        const allowed = hasPermission(me, main.permission);
        const reason = !allowed
          ? t('common.noPermission')
          : !main.available
            ? t('events.soon')
            : null;
        const button = (
          <Button type="primary" disabled={reason !== null} data-main-action={main.key}>
            {t(`events.actions.${main.key}`)}
          </Button>
        );
        return reason ? (
          <Tooltip title={reason}>
            <span>{button}</span>
          </Tooltip>
        ) : (
          button
        );
      })()
    : null;

  const more = moreActions(event.status, event.isActive);
  const moreMenu = more.length ? (
    <Dropdown
      trigger={['click']}
      menu={{
        items: more.map((action) => {
          const allowed = hasPermission(me, action.permission);
          return {
            key: action.key,
            label: t(`events.actions.${action.key}`),
            disabled: !allowed || !action.available,
            title: !allowed
              ? t('common.noPermission')
              : !action.available
                ? t('events.soon')
                : undefined,
            danger: action.key === 'cancel' || action.key === 'deactivate',
          };
        }),
        onClick: ({ key }) => {
          if (key === 'deactivate') setConfirmDeactivate(true);
          if (key === 'activate') {
            setActive.mutate(true, {
              onSuccess: () => void message.success(t('events.settings.activated')),
            });
          }
        },
      }}
    >
      <Button icon={<MoreOutlined />} aria-label={t('events.more')} />
    </Dropdown>
  ) : null;

  return (
    <>
      <PageHeader
        title={event.name}
        status={
          <>
            <StatusBadge domain="event" value={event.status} />
            {!event.isActive && <Tag>{t('events.deactivated')}</Tag>}
          </>
        }
        meta={[
          t('events.windowMeta', {
            start: format.dateTime(event.startAt),
            end: format.dateTime(event.endAt),
          }),
        ]}
        actions={
          <>
            {moreMenu}
            {mainButton}
          </>
        }
        back={{ to: '/events', label: t('common.back') }}
      />
      {setActive.isError && (
        <Banner
          tone="danger"
          message={
            isApiError(setActive.error, 'INVALID_TRANSITION')
              ? t('events.settings.openCannotDeactivate')
              : errorMessage(t, setActive.error)
          }
        />
      )}
      <Tabs
        activeKey={activeTab}
        onChange={(key) =>
          void navigate(key === 'overview' ? base : `${base}/${key === 'activity' ? 'audit' : key}`)
        }
        items={tabs.map((tab) => ({ key: tab, label: t(`events.tabs.${tab}`) }))}
      />
      <Outlet context={event} />
      <ConfirmDialog
        open={confirmDeactivate}
        tone="danger"
        title={t('events.settings.deactivateTitle', { name: event.name })}
        body={t('events.settings.deactivateBody')}
        confirmLabel={t('events.actions.deactivate')}
        loading={setActive.isPending}
        onConfirm={() =>
          setActive.mutate(false, {
            onSuccess: () => void message.success(t('events.settings.deactivated')),
            onSettled: () => setConfirmDeactivate(false),
          })
        }
        onCancel={() => setConfirmDeactivate(false)}
      />
    </>
  );
}
