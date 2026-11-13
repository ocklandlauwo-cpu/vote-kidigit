// CTL-01 Control room (App Flow 6.10): turnout and the countdown to close, alerts, one row per
// category with its own countdown, turnout and Open / Close switch (a close is permanent), ballots
// by channel, the last message batch with "send reminder to voters who haven't voted", and the
// running kiosks. Refreshes every 30 s and says when it was updated. No numbers per contester.
import type { EventDetail, Live, LiveAlert, LiveCategory } from '@vote-kidigit/shared';
import { App, Button, Card, Flex, Skeleton, Switch, Table, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router';
import { errorMessage } from '../../../api/errorMessage';
import { hasPermission, useMe } from '../../../auth/useAuth';
import { Banner } from '../../../components/Banner';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { StatusBadge } from '../../../components/StatusBadge';
import { useFormat } from '../../../hooks/useFormat';
import { useNow } from '../../../hooks/useNow';
import { durationText } from '../countdown';
import { KioskLaunchDialog } from '../KioskLaunchDialog';
import { SendDialog } from '../messages/SendDialog';
import { useCategorySwitch, useEndKiosk, useLive } from './liveApi';

const count = (n: number) => n.toLocaleString('en');

function AlertBanner({ alert, live }: { alert: LiveAlert; live: Live }) {
  const { t } = useTranslation();
  const format = useFormat();
  if (alert.kind === 'lockouts') {
    return (
      <Banner tone="warning" message={t('live.alerts.lockouts', { count: alert.count ?? 0 })} />
    );
  }
  if (alert.kind === 'sms_failures') {
    return (
      <Banner tone="danger" message={t('live.alerts.smsFailures', { count: alert.count ?? 0 })} />
    );
  }
  const name = alert.name ?? t('live.alerts.theEvent');
  return (
    <Banner
      tone="warning"
      message={t('live.alerts.closingSoon', {
        name,
        time: format.dateTime(alert.at ?? live.endAt),
      })}
    />
  );
}

export function LiveTab() {
  const event = useOutletContext<EventDetail>();
  const { t } = useTranslation();
  const { message } = App.useApp();
  const me = useMe().data;
  const now = useNow(1000);
  const live = useLive(event.id);
  const switchCategory = useCategorySwitch(event.id);
  const endKiosk = useEndKiosk(event.id);
  const [closing, setClosing] = useState<LiveCategory | null>(null);
  const [reminder, setReminder] = useState(false);
  const [launch, setLaunch] = useState(false);
  const mayClose = hasPermission(me, 'event.close');
  const maySend = hasPermission(me, 'messages.send');

  if (live.isError) {
    return (
      <Typography.Text type="danger" role="alert">
        {errorMessage(t, live.error)}
      </Typography.Text>
    );
  }
  if (!live.data) return <Skeleton active paragraph={{ rows: 6 }} />;
  const data = live.data;
  const updatedSeconds = Math.max(0, Math.round((now - live.dataUpdatedAt) / 1000));

  function setOpen(category: LiveCategory, open: boolean) {
    switchCategory.mutate(
      { categoryId: category.id, open },
      {
        onSuccess: () => {
          void message.success(t(open ? 'live.categoryOpened' : 'live.categoryClosed'));
          setClosing(null);
        },
        onError: (error) => void message.error(errorMessage(t, error)),
      },
    );
  }

  return (
    <Flex vertical gap="large" data-testid="control-room">
      <Typography.Text type="secondary" aria-live="off">
        {t('live.updated', { count: updatedSeconds })}
      </Typography.Text>

      {data.alerts.map((alert) => (
        <AlertBanner key={`${alert.kind}-${alert.categoryId ?? ''}`} alert={alert} live={data} />
      ))}

      {data.turnout.voted === 0 && (
        <Banner
          tone="info"
          message={t('live.noVotes', { count: event.codeCounts.delivered })}
          action={
            maySend && data.notVoted > 0 ? (
              <Button size="small" onClick={() => setReminder(true)}>
                {t('live.sendReminder', { count: data.notVoted })}
              </Button>
            ) : undefined
          }
        />
      )}

      <Card>
        <Flex justify="space-between" align="center" wrap gap="middle">
          <Flex vertical>
            <span className="vk-stat-value" data-testid="turnout" aria-live="polite">
              {t('live.turnout', {
                voted: count(data.turnout.voted),
                registered: count(data.turnout.registered),
                percent: data.turnout.percent,
              })}
            </span>
            <Typography.Text type="secondary">
              {t('live.closesIn', { time: durationText(t, new Date(data.endAt).getTime() - now) })}
            </Typography.Text>
          </Flex>
        </Flex>
      </Card>

      <Card title={t('live.categoriesTitle')}>
        <Table<LiveCategory>
          rowKey="id"
          dataSource={data.categories}
          pagination={false}
          scroll={{ x: 'max-content' }}
          columns={[
            { key: 'name', title: t('live.col.category'), render: (_, c) => c.name },
            {
              key: 'status',
              title: t('live.col.status'),
              render: (_, c) => <StatusBadge domain="category" value={c.status} />,
            },
            {
              key: 'countdown',
              title: t('live.col.countdown'),
              render: (_, c) =>
                c.status === 'open' && c.closesAt
                  ? t('live.closesIn', {
                      time: durationText(t, new Date(c.closesAt).getTime() - now),
                    })
                  : c.status === 'not_open' && c.opensAt
                    ? t('live.opensIn', {
                        time: durationText(t, new Date(c.opensAt).getTime() - now),
                      })
                    : '—',
            },
            {
              key: 'turnout',
              title: t('live.col.turnout'),
              render: (_, c) => `${count(c.voted)} / ${count(c.eligible)}`,
            },
            {
              key: 'switch',
              title: t('live.col.switch'),
              render: (_, c) => (
                <Switch
                  checked={c.status === 'open'}
                  // A closed category stays closed; an inactive one cannot open.
                  disabled={!mayClose || c.status === 'closed' || c.status === 'inactive'}
                  loading={
                    switchCategory.isPending && switchCategory.variables?.categoryId === c.id
                  }
                  onChange={(open) => (open ? setOpen(c, true) : setClosing(c))}
                  aria-label={t('live.switchLabel', { name: c.name })}
                />
              ),
            },
          ]}
        />
      </Card>

      <Flex gap="large" wrap>
        <Card title={t('live.channelsTitle')} style={{ flex: '1 1 18rem' }}>
          <Flex gap="large" wrap>
            {(['web', 'ussd', 'kiosk'] as const).map((channel) => (
              <Flex vertical key={channel}>
                <span className="vk-stat-value">{count(data.channels[channel])}</span>
                <Typography.Text type="secondary">{t(`live.channel.${channel}`)}</Typography.Text>
              </Flex>
            ))}
          </Flex>
        </Card>
        <Card title={t('live.messagesTitle')} style={{ flex: '1 1 18rem' }}>
          <Flex vertical gap="small">
            <Typography.Text>
              {data.lastBatch
                ? t('live.lastBatch', {
                    type: t(`messages.types.${data.lastBatch.type}`),
                    status: t(`messages.batchStatus.${data.lastBatch.status}`),
                    sent: count(data.lastBatch.sentCount),
                    failed: count(data.lastBatch.failedCount),
                  })
                : t('live.noBatch')}
            </Typography.Text>
            <Button
              disabled={!maySend || data.notVoted === 0}
              onClick={() => setReminder(true)}
              data-testid="live-reminder"
            >
              {t('live.sendReminder', { count: data.notVoted })}
            </Button>
          </Flex>
        </Card>
      </Flex>

      {data.kiosks !== null && (
        <Card
          title={t('live.kiosksTitle')}
          extra={<Button onClick={() => setLaunch(true)}>{t('events.actions.launchKiosk')}</Button>}
        >
          {data.kiosks.length === 0 ? (
            <Typography.Text type="secondary">{t('live.noKiosks')}</Typography.Text>
          ) : (
            <ul className="vk-plain-list">
              {data.kiosks.map((kiosk) => (
                <li key={kiosk.id}>
                  <Flex justify="space-between" align="center" gap="middle" wrap>
                    <Flex vertical>
                      <Typography.Text strong>{kiosk.deviceLabel}</Typography.Text>
                      <Typography.Text type="secondary">
                        {t('live.kioskSeen', {
                          by: kiosk.launchedBy,
                          seen: kiosk.lastSeenAt
                            ? durationText(t, now - new Date(kiosk.lastSeenAt).getTime())
                            : '—',
                        })}
                      </Typography.Text>
                    </Flex>
                    <Button
                      danger
                      loading={endKiosk.isPending && endKiosk.variables === kiosk.id}
                      onClick={() => endKiosk.mutate(kiosk.id)}
                    >
                      {t('live.endKiosk')}
                    </Button>
                  </Flex>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={closing !== null}
        tone="danger"
        title={t('live.closeTitle', { name: closing?.name ?? '' })}
        body={t('live.closeBody')}
        confirmLabel={t('live.closeConfirm')}
        loading={switchCategory.isPending}
        onConfirm={() => closing && setOpen(closing, false)}
        onCancel={() => setClosing(null)}
      />
      <SendDialog
        eventId={event.id}
        kind={reminder ? 'reminder' : null}
        onClose={() => setReminder(false)}
      />
      <KioskLaunchDialog event={event} open={launch} onClose={() => setLaunch(false)} />
    </Flex>
  );
}
