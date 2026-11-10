// Event workspace (App Flow 3.4): header with the status badge, voting window, the main action
// for the status and a "More" menu, then the tabs (Live first while Open). Actions the user may
// not take are greyed out with the reason (App Flow 3.7); lifecycle actions confirm as App Flow
// 6.11 says (cancel: type the name and a reason).
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
import { type EventActionKey, mainAction, moreActions } from './eventActions';
import {
  useArchiveEvent,
  useCancelEvent,
  useEvent,
  usePublishEvent,
  useSetEventActive,
  useUnpublishEvent,
} from './eventsApi';
import { PublishDialog } from './PublishDialog';

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
  const publish = usePublishEvent(event.id);
  const unpublish = useUnpublishEvent(event.id);
  const cancel = useCancelEvent(event.id);
  const archive = useArchiveEvent(event.id);
  const [dialog, setDialog] = useState<EventActionKey | null>(null);
  const closeDialog = () => setDialog(null);
  const failed = (error: unknown) => void message.error(errorMessage(t, error));
  /** Unpublishing is refused once a code SMS went out (App Flow 6.8). */
  const codesSent = event.firstCodeSentAt !== null;

  function run(key: EventActionKey) {
    if (key === 'activate') {
      setActive.mutate(true, {
        onSuccess: () => void message.success(t('events.settings.activated')),
      });
    } else {
      setDialog(key);
    }
  }

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
          <Button
            type="primary"
            disabled={reason !== null}
            data-main-action={main.key}
            onClick={() => run(main.key)}
          >
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
          const blockedByCodes = action.key === 'unpublish' && codesSent;
          return {
            key: action.key,
            label: t(`events.actions.${action.key}`),
            disabled: !allowed || !action.available || blockedByCodes,
            title: !allowed
              ? t('common.noPermission')
              : !action.available
                ? t('events.soon')
                : blockedByCodes
                  ? t('events.unpublishConfirm.codesSent')
                  : undefined,
            danger: action.key === 'cancel' || action.key === 'deactivate',
          };
        }),
        onClick: ({ key }) => run(key as EventActionKey),
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
        open={dialog === 'deactivate'}
        tone="danger"
        title={t('events.settings.deactivateTitle', { name: event.name })}
        body={t('events.settings.deactivateBody')}
        confirmLabel={t('events.actions.deactivate')}
        loading={setActive.isPending}
        onConfirm={() =>
          setActive.mutate(false, {
            onSuccess: () => void message.success(t('events.settings.deactivated')),
            onSettled: closeDialog,
          })
        }
        onCancel={closeDialog}
      />
      <PublishDialog event={event} open={dialog === 'publish'} onClose={closeDialog} />
      <ConfirmDialog
        open={dialog === 'openNow'}
        tone="warning"
        title={t('events.openNowConfirm.title', { name: event.name })}
        body={t('events.openNowConfirm.body')}
        confirmLabel={t('events.actions.openNow')}
        loading={publish.isPending}
        onConfirm={() =>
          publish.mutate(
            { mode: 'open_now', sendCodes: false },
            {
              onSuccess: () => {
                void message.success(t('events.publish.opened'));
                closeDialog();
              },
              onError: failed,
            },
          )
        }
        onCancel={closeDialog}
      />
      <ConfirmDialog
        open={dialog === 'unpublish'}
        tone="warning"
        title={t('events.unpublishConfirm.title')}
        body={t('events.unpublishConfirm.body')}
        confirmLabel={t('events.actions.unpublish')}
        loading={unpublish.isPending}
        onConfirm={() =>
          unpublish.mutate(undefined, {
            onSuccess: () => {
              void message.success(t('events.unpublishConfirm.done'));
              closeDialog();
            },
            onError: failed,
          })
        }
        onCancel={closeDialog}
      />
      <ConfirmDialog
        open={dialog === 'cancel'}
        tone="danger"
        typeToConfirm={event.name}
        requireReason
        title={t('events.cancelConfirm.title', { name: event.name })}
        body={t('events.cancelConfirm.body')}
        confirmLabel={t('events.actions.cancel')}
        loading={cancel.isPending}
        onConfirm={(reason) =>
          cancel.mutate(
            { confirmName: event.name, reason: reason ?? '' },
            {
              onSuccess: () => {
                void message.success(t('events.cancelConfirm.done'));
                closeDialog();
              },
              onError: failed,
            },
          )
        }
        onCancel={closeDialog}
      />
      <ConfirmDialog
        open={dialog === 'archive'}
        tone="warning"
        title={t('events.archiveConfirm.title', { name: event.name })}
        body={t('events.archiveConfirm.body')}
        confirmLabel={t('events.actions.archive')}
        loading={archive.isPending}
        onConfirm={() =>
          archive.mutate(undefined, {
            onSuccess: () => {
              void message.success(t('events.archiveConfirm.done'));
              closeDialog();
            },
            onError: failed,
          })
        }
        onCancel={closeDialog}
      />
    </>
  );
}
