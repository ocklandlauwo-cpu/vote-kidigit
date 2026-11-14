// RES-01 Results tab (App Flow 11): before close, the time results will be available and a way
// to the control room; after close, the turnout summary, a banner while ties remain, one card per
// category (winners, votes, %, skipped, threshold / quorum), the category detail (RES-02), tie
// resolution (RES-03), publication with the typed event name, and the public link (copy, on/off).
import { FilePdfOutlined } from '@ant-design/icons';
import { type EventDetail, isSmallGroup, type ResultCategory } from '@vote-kidigit/shared';
import {
  App,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Drawer,
  Flex,
  Input,
  Modal,
  Radio,
  Skeleton,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router';
import { errorMessage } from '../../../api/errorMessage';
import { hasPermission, useMe } from '../../../auth/useAuth';
import { Banner } from '../../../components/Banner';
import { SmallGroupTag } from '../../../components/SmallGroupTag';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { useFormat } from '../../../hooks/useFormat';
import { RecentDownloads, ReportProgress } from '../../reports/ReportParts';
import { useEventReport } from '../../reports/reportsApi';
import { usePublicLink, usePublishResults, useResolveTie, useResults } from './resultsApi';

const count = (n: number) => n.toLocaleString('en');

function ruleLine(t: TFunction, category: ResultCategory): string {
  const parts = [t('results.seats', { count: category.seats })];
  const threshold = category.thresholdPct;
  if (threshold !== null) {
    parts.push(
      category.thresholdMet
        ? t('results.thresholdMet', { pct: threshold })
        : t('results.thresholdNotMet', { pct: threshold }),
    );
  }
  const quorum = category.quorumPct;
  if (quorum !== null) {
    parts.push(
      category.quorumMet
        ? t('results.quorumMet', { pct: quorum })
        : t('results.quorumNotMet', { pct: quorum }),
    );
  }
  return parts.join(' · ');
}

/** RES-03: choose who takes the last seat, or no winner, with a reason. */
function TieDialog({
  eventId,
  category,
  onClose,
}: {
  eventId: string;
  category: ResultCategory | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const resolve = useResolveTie(eventId);
  const [outcome, setOutcome] = useState<'contester' | 'no_winner'>('contester');
  const [chosen, setChosen] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  if (!category) return null;
  const winners = category.rows.filter((r) => r.isWinner).length;
  const remaining = category.seats - winners;
  const top = Math.max(0, ...category.rows.filter((r) => !r.isWinner).map((r) => r.votes));
  const tied = category.rows.filter((r) => !r.isWinner && r.votes === top && top > 0);
  const valid =
    reason.trim().length >= 10 &&
    (outcome === 'no_winner' || (chosen.length > 0 && chosen.length <= remaining));

  function close() {
    setOutcome('contester');
    setChosen([]);
    setReason('');
    resolve.reset();
    onClose();
  }

  return (
    <Modal
      open
      title={t('results.tie.title', { name: category.name })}
      okText={t('results.tie.save')}
      cancelText={t('common.cancel')}
      okButtonProps={{ disabled: !valid }}
      confirmLoading={resolve.isPending}
      onOk={() =>
        resolve.mutate(
          {
            categoryId: category.id,
            outcome,
            winnerIds: outcome === 'contester' ? chosen : [],
            reason: reason.trim(),
          },
          {
            onSuccess: () => {
              void message.success(t('results.tie.saved'));
              close();
            },
          },
        )
      }
      onCancel={close}
    >
      <Flex vertical gap="middle">
        <Typography.Text>
          {t('results.tie.body', { count: remaining, votes: count(top) })}
        </Typography.Text>
        <Radio.Group value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
          <Radio value="contester">{t('results.tie.takesSeat')}</Radio>
          <Radio value="no_winner">{t('results.tie.noWinner')}</Radio>
        </Radio.Group>
        {outcome === 'contester' && (
          <Checkbox.Group
            value={chosen}
            onChange={(values) => setChosen(values)}
            options={tied.map((row) => ({
              value: row.contesterId,
              label: row.name,
              disabled: !chosen.includes(row.contesterId) && chosen.length >= remaining,
            }))}
          />
        )}
        <label>
          <Typography.Text strong>{t('results.tie.reason')}</Typography.Text>
          <Input.TextArea
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label={t('results.tie.reason')}
          />
        </label>
        {resolve.isError && (
          <Typography.Text type="danger" role="alert">
            {errorMessage(t, resolve.error)}
          </Typography.Text>
        )}
      </Flex>
    </Modal>
  );
}

function CategoryCard({
  category,
  onOpen,
  onResolve,
  mayResolve,
}: {
  category: ResultCategory;
  onOpen: () => void;
  onResolve: () => void;
  mayResolve: boolean;
}) {
  const { t } = useTranslation();
  const winners = category.rows.filter((r) => r.isWinner);
  const unresolved = category.hasTie && !category.tie;
  return (
    <Card
      size="small"
      title={category.name}
      data-testid={`result-${category.id}`}
      extra={
        <Flex gap="small">
          {unresolved && mayResolve && (
            <Button size="small" type="primary" onClick={onResolve}>
              {t('results.resolveTie')}
            </Button>
          )}
          <Button size="small" type="link" onClick={onOpen}>
            {t('results.open')}
          </Button>
        </Flex>
      }
    >
      <Flex vertical gap="small">
        {(unresolved || isSmallGroup(category.votersVoted)) && (
          <Flex wrap gap="small">
            {unresolved && <Tag color="warning">{t('results.tieOpen')}</Tag>}
            <SmallGroupTag voted={category.votersVoted} />
          </Flex>
        )}
        {winners.length === 0 ? (
          <Typography.Text type="secondary">{t('results.noWinner')}</Typography.Text>
        ) : (
          winners.map((row) => (
            <Typography.Text key={`${row.contesterId}-${row.choice}`} strong>
              {row.choice === 'yes' ? t('results.yesWins', { name: row.name }) : row.name} ·{' '}
              {t('results.votes', { votes: count(row.votes), percent: row.percent })}
            </Typography.Text>
          ))
        )}
        <Typography.Text type="secondary">{ruleLine(t, category)}</Typography.Text>
        <Typography.Text type="secondary">
          {t('results.categoryTurnout', {
            voted: count(category.votersVoted),
            eligible: count(category.eligibleVoters),
            skipped: count(category.skipped),
          })}
        </Typography.Text>
      </Flex>
    </Card>
  );
}

export function ResultsTab() {
  const event = useOutletContext<EventDetail>();
  const { t } = useTranslation();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const format = useFormat();
  const me = useMe().data;
  const results = useResults(event.id);
  const publish = usePublishResults(event.id);
  const publicLink = usePublicLink(event.id);
  const pdf = useEventReport(event.id);
  const [detail, setDetail] = useState<ResultCategory | null>(null);
  const [tie, setTie] = useState<ResultCategory | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const mayPublish = hasPermission(me, 'results.publish');
  const mayResolve = hasPermission(me, 'results.resolve_tie');
  const mayDownload = hasPermission(me, 'reports.download');
  const [params, setParams] = useSearchParams();
  const ready = results.data?.snapshot != null;

  // "Download PDF" in the event header opens this tab with ?download=pdf.
  useEffect(() => {
    if (params.get('download') !== 'pdf' || !ready) return;
    setParams({}, { replace: true });
    if (mayDownload) void pdf.start('results_pdf');
    // pdf.start is recreated each render; the parameter is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, ready, mayDownload]);

  if (results.isError) {
    return (
      <Typography.Text type="danger" role="alert">
        {errorMessage(t, results.error)}
      </Typography.Text>
    );
  }
  if (!results.data) return <Skeleton active paragraph={{ rows: 6 }} />;
  const data = results.data;

  if (data.state === 'not_closed' || !data.snapshot) {
    return (
      <EmptyState
        kind="list"
        title={t('results.beforeCloseTitle')}
        description={t('results.beforeClose', { time: format.dateTime(event.endAt) })}
        action={
          event.status === 'open'
            ? {
                label: t('live.openLink'),
                onClick: () => void navigate(`/events/${event.id}/live`),
              }
            : undefined
        }
      />
    );
  }
  const snapshot = data.snapshot;
  const published = data.state === 'published';

  return (
    <Flex vertical gap="large" data-testid="results">
      {data.unresolvedTies > 0 && (
        <Banner tone="warning" message={t('results.tiesBanner', { count: data.unresolvedTies })} />
      )}

      <Card>
        <Flex justify="space-between" align="center" wrap gap="middle">
          <Flex vertical>
            <span className="vk-stat-value">
              {t('live.turnout', {
                voted: count(snapshot.votersVoted),
                registered: count(snapshot.registeredVoters),
                percent:
                  snapshot.registeredVoters > 0
                    ? Math.round((snapshot.votersVoted / snapshot.registeredVoters) * 1000) / 10
                    : 0,
              })}
            </span>
            <Typography.Text type="secondary">
              {t('results.generated', {
                version: snapshot.version,
                time: format.dateTime(snapshot.generatedAt),
              })}
            </Typography.Text>
            <Typography.Text type="secondary" copyable={{ text: snapshot.contentHash }}>
              {t('results.hash', { hash: snapshot.contentHash.slice(0, 16) })}
            </Typography.Text>
          </Flex>
          <Flex gap="small" wrap>
            <Tooltip title={mayDownload ? undefined : t('common.noPermission')}>
              <Button
                icon={<FilePdfOutlined />}
                disabled={!mayDownload}
                loading={pdf.preparing}
                onClick={() => void pdf.start('results_pdf')}
                data-testid="download-pdf"
              >
                {t('reports.downloadPdf')}
              </Button>
            </Tooltip>
            {!published && (
              <Tooltip
                title={
                  !mayPublish
                    ? t('common.noPermission')
                    : data.unresolvedTies > 0
                      ? t('results.tiesBanner', { count: data.unresolvedTies })
                      : undefined
                }
              >
                <Button
                  type="primary"
                  disabled={!mayPublish || data.unresolvedTies > 0}
                  onClick={() => setConfirmPublish(true)}
                  data-testid="publish-results"
                >
                  {t('events.actions.publishResults')}
                </Button>
              </Tooltip>
            )}
          </Flex>
        </Flex>
        <div style={{ marginTop: 'var(--vk-space-3)' }}>
          <ReportProgress report={pdf} kind="pdf" onRetry={() => void pdf.start('results_pdf')} />
        </div>
      </Card>

      {published && data.publicUrl && (
        <Card title={t('results.publicTitle')}>
          <Flex justify="space-between" align="center" gap="middle" wrap>
            <Typography.Text copyable={{ text: data.publicUrl }} data-testid="public-url">
              {data.publicUrl}
            </Typography.Text>
            <Flex gap="small" align="center">
              <Switch
                checked={data.publicEnabled}
                disabled={!mayPublish}
                loading={publicLink.isPending}
                onChange={(enabled) =>
                  publicLink.mutate(enabled, {
                    onSuccess: () =>
                      void message.success(t(enabled ? 'results.linkOn' : 'results.linkOff')),
                    onError: (error) => void message.error(errorMessage(t, error)),
                  })
                }
                aria-label={t('results.publicSwitch')}
              />
              <Typography.Text>{t('results.publicSwitch')}</Typography.Text>
            </Flex>
          </Flex>
        </Card>
      )}

      {snapshot.votersVoted === 0 && (
        <EmptyState
          kind="list"
          title={t('results.noBallots')}
          action={
            mayDownload
              ? { label: t('reports.downloadPdf'), onClick: () => void pdf.start('results_pdf') }
              : undefined
          }
        />
      )}

      <div className="vk-template-grid">
        {snapshot.categories.map((category) => (
          <CategoryCard
            key={category.id}
            category={category}
            mayResolve={mayResolve && !published}
            onOpen={() => setDetail(category)}
            onResolve={() => setTie(category)}
          />
        ))}
      </div>

      {mayDownload && <RecentDownloads eventId={event.id} />}

      {/* RES-02 */}
      <Drawer
        open={detail !== null}
        onClose={() => setDetail(null)}
        size={640}
        title={detail?.name}
        destroyOnHidden
      >
        {detail && (
          <Flex vertical gap="middle">
            <Descriptions
              column={1}
              size="small"
              items={[
                { key: 'rule', label: t('results.rule'), children: ruleLine(t, detail) },
                {
                  key: 'eligible',
                  label: t('results.eligible'),
                  children: count(detail.eligibleVoters),
                },
                { key: 'voted', label: t('results.voted'), children: count(detail.votersVoted) },
                { key: 'valid', label: t('results.valid'), children: count(detail.validVotes) },
                { key: 'skipped', label: t('results.skipped'), children: count(detail.skipped) },
              ]}
            />
            <Table
              rowKey={(row) => `${row.contesterId}-${row.choice}`}
              size="small"
              pagination={false}
              dataSource={detail.rows}
              columns={[
                {
                  key: 'name',
                  title: t('results.col.contester'),
                  render: (_, row) =>
                    row.choice === 'contester'
                      ? row.name
                      : `${row.name} · ${t(row.choice === 'yes' ? 'results.yes' : 'results.no')}`,
                },
                {
                  key: 'votes',
                  title: t('results.col.votes'),
                  align: 'end',
                  render: (_, row) => count(row.votes),
                },
                { key: 'percent', title: '%', align: 'end', render: (_, row) => `${row.percent}%` },
                {
                  key: 'rank',
                  title: t('results.col.rank'),
                  align: 'end',
                  render: (_, row) => row.rank,
                },
                {
                  key: 'winner',
                  title: t('results.col.winner'),
                  render: (_, row) =>
                    row.isWinner ? <Tag color="success">{t('status.result.winner')}</Tag> : null,
                },
              ]}
            />
            {detail.tie && (
              <Banner
                tone="info"
                message={t('results.tieNote', {
                  reason: detail.tie.reason,
                  by: detail.tie.resolvedBy,
                  time: format.dateTime(detail.tie.resolvedAt),
                })}
              />
            )}
          </Flex>
        )}
      </Drawer>

      <TieDialog eventId={event.id} category={tie} onClose={() => setTie(null)} />

      <ConfirmDialog
        open={confirmPublish}
        tone="warning"
        typeToConfirm={event.name}
        title={t('results.publishTitle', { name: event.name })}
        body={t('results.publishBody')}
        confirmLabel={t('events.actions.publishResults')}
        loading={publish.isPending}
        onConfirm={() =>
          publish.mutate(event.name, {
            onSuccess: () => {
              void message.success(t('results.publishedDone'));
              setConfirmPublish(false);
            },
            onError: (error) => void message.error(errorMessage(t, error)),
          })
        }
        onCancel={() => setConfirmPublish(false)}
      />
    </Flex>
  );
}
