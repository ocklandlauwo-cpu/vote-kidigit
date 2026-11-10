// EVT-06 CSV import (App Flow 6.6): choose a .csv (template link) → the worker checks it →
// preview with Ready / Warnings / Errors and the reasons per row → "Import {n} voters" (errors
// are skipped) → done. Error rows download as CSV to fix and upload again. Leaving before the
// import asks first. Column mapping for other headers is a follow-up: headers are matched loosely.
import { ArrowLeftOutlined, DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { type EventDetail, type ImportProblem, type VoterImport } from '@vote-kidigit/shared';
import { Button, Flex, Progress, Result, Spin, Steps, Table, Tabs, Typography, Upload } from 'antd';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useOutletContext } from 'react-router';
import { isApiError } from '../../../api/client';
import { errorMessage } from '../../../api/errorMessage';
import { Banner } from '../../../components/Banner';
import { UnsavedChangesPrompt } from '../../../hooks/useUnsavedChanges';
import {
  errorRowsUrl,
  templateUrl,
  useConfirmImport,
  useCreateImport,
  useImport,
} from './votersApi';

/** EVT-06 accepts .csv up to 10 MB (App Flow 6.6; the API checks MAX_CSV_MB). */
const CSV_MAX_BYTES = 10 * 1024 * 1024;

type Severity = ImportProblem['severity'];

function ProblemTable({
  eventId,
  importId,
  severity,
}: {
  eventId: string;
  importId: string;
  severity: Severity;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const problems = useImport(eventId, importId, { severity, page, pageSize: 25 });
  const data = problems.data?.problems;
  return (
    <Table<ImportProblem>
      size="small"
      rowKey={(p) => `${p.row}-${p.field}-${p.code}`}
      loading={problems.isFetching && !data}
      dataSource={data?.items ?? []}
      locale={{ emptyText: t('voters.import.noProblems') }}
      pagination={{
        current: page,
        pageSize: 25,
        total: data?.total ?? 0,
        showSizeChanger: false,
        onChange: setPage,
      }}
      columns={[
        { key: 'row', title: t('voters.import.row'), dataIndex: 'row', width: 80 },
        {
          key: 'field',
          title: t('voters.import.field'),
          render: (_, p) =>
            t(`voters.import.fields.${p.field as 'phone'}`, { defaultValue: p.field }),
        },
        {
          key: 'reason',
          title: t('voters.import.reason'),
          render: (_, p) => t(`voters.import.problem.${p.code}`),
        },
      ]}
    />
  );
}

function failureText(t: TFunction, result: VoterImport): string {
  switch (result.failureReason) {
    case 'missing_columns':
      return t('voters.import.missingColumns', { columns: result.missingColumns.join(', ') });
    case 'empty':
      return t('voters.import.empty');
    case 'unreadable':
      return t('voters.import.unreadable');
    default:
      return t('voters.import.failed');
  }
}

export function ImportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const event = useOutletContext<EventDetail>();
  const [importId, setImportId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ name: string; percent: number } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const create = useCreateImport(event.id);
  const confirm = useConfirmImport(event.id);
  const current = useImport(event.id, importId, { page: 1, pageSize: 25 });
  const result = current.data;
  const back = () => void navigate('..', { relative: 'path' });

  function send(file: File) {
    if (!file.name.toLowerCase().endsWith('.csv') || file.size > CSV_MAX_BYTES) {
      setFileError(t('voters.import.invalidFile'));
      return;
    }
    setFileError(null);
    setProgress({ name: file.name, percent: 0 });
    create.mutate(
      { file, onProgress: (percent) => setProgress({ name: file.name, percent }) },
      {
        onSuccess: ({ id }) => setImportId(id),
        onError: (e) =>
          setFileError(
            isApiError(e, 'FILE_TYPE') || isApiError(e, 'FILE_TOO_LARGE')
              ? t('voters.import.invalidFile')
              : errorMessage(t, e),
          ),
        onSettled: () => setProgress(null),
      },
    );
  }

  function restart() {
    setImportId(null);
    create.reset();
    confirm.reset();
  }

  const status = importId ? (result?.status ?? 'uploaded') : null;
  const step =
    !status || status === 'uploaded' || status === 'failed' ? 0 : status === 'completed' ? 2 : 1;
  const importable = result ? result.validRows + result.warningRows : 0;

  return (
    <Flex vertical gap="large">
      {/* EVT-06 */}
      <UnsavedChangesPrompt
        dirty={status === 'validated'}
        title={t('voters.import.leaveTitle')}
        body={t('voters.import.leaveBody')}
      />
      <Flex justify="space-between" align="center" gap="middle" wrap>
        <Typography.Title level={2} style={{ margin: 0 }}>
          {t('voters.import.title')}
        </Typography.Title>
        <Button icon={<ArrowLeftOutlined />} onClick={back}>
          {t('voters.import.back')}
        </Button>
      </Flex>
      <Steps
        current={step}
        items={[
          { title: t('voters.import.stepChoose') },
          { title: t('voters.import.stepPreview') },
          { title: t('voters.import.stepDone') },
        ]}
      />

      {event.status !== 'draft' && <Banner tone="info" message={t('voters.locked')} inline />}

      {!importId && (
        <Flex vertical gap="small" style={{ maxWidth: '40rem' }}>
          <Typography.Text type="secondary">{t('voters.import.chooseHelp')}</Typography.Text>
          <div className="vk-dropzone" data-error={fileError ? true : undefined}>
            <Upload.Dragger
              accept=".csv,text/csv"
              showUploadList={false}
              maxCount={1}
              disabled={progress !== null || event.status !== 'draft'}
              beforeUpload={(file) => {
                send(file);
                return false;
              }}
            >
              {progress ? (
                <Flex vertical gap="small" aria-live="polite">
                  <Typography.Text>{t('files.uploading', { name: progress.name })}</Typography.Text>
                  <Progress percent={progress.percent} size="small" />
                </Flex>
              ) : (
                <Flex vertical align="center" gap="small">
                  <UploadOutlined className="vk-dropzone-icon" />
                  <Typography.Text>{t('files.dropTitle')}</Typography.Text>
                </Flex>
              )}
            </Upload.Dragger>
          </div>
          {fileError && (
            <Typography.Text type="danger" role="alert" className="vk-text-sm">
              {fileError}
            </Typography.Text>
          )}
          <Button
            icon={<DownloadOutlined />}
            href={templateUrl(event.id)}
            download
            style={{ alignSelf: 'start' }}
          >
            {t('voters.template')}
          </Button>
        </Flex>
      )}

      {(status === 'uploaded' || status === 'importing') && (
        <Flex align="center" gap="middle" aria-live="polite">
          <Spin />
          <Typography.Text>
            {status === 'importing'
              ? t('voters.import.importing')
              : t('voters.import.validating', { name: result?.fileName ?? '' })}
          </Typography.Text>
        </Flex>
      )}

      {status === 'failed' && result && (
        <Flex vertical gap="middle" align="start">
          <Banner tone="danger" message={failureText(t, result)} inline />
          <Button icon={<UploadOutlined />} onClick={restart}>
            {t('voters.import.another')}
          </Button>
        </Flex>
      )}

      {status === 'validated' && result && importId && (
        <Flex vertical gap="middle">
          <Flex gap="middle" wrap data-testid="import-counters">
            {(
              [
                ['ready', result.validRows, 'success'],
                ['warnings', result.warningRows, 'warning'],
                ['errors', result.errorRows, 'danger'],
              ] as const
            ).map(([key, value, tone]) => (
              <div key={key} className={`vk-stat vk-tone-${tone}`}>
                <Typography.Text type="secondary">{t(`voters.import.${key}`)}</Typography.Text>
                <span className="vk-stat-value">{value}</span>
              </div>
            ))}
          </Flex>
          <Tabs
            items={[
              {
                key: 'error',
                label: `${t('voters.import.errors')} (${result.errorRows})`,
                children: <ProblemTable eventId={event.id} importId={importId} severity="error" />,
              },
              {
                key: 'warning',
                label: `${t('voters.import.warnings')} (${result.warningRows})`,
                children: (
                  <ProblemTable eventId={event.id} importId={importId} severity="warning" />
                ),
              },
            ]}
          />
          <Flex gap="small" wrap align="center">
            <Button
              type="primary"
              disabled={importable === 0}
              loading={confirm.isPending}
              onClick={() => confirm.mutate(importId)}
            >
              {importable === 0
                ? t('voters.import.nothingToImport')
                : t('voters.import.confirm', { count: importable })}
            </Button>
            {result.errorRows > 0 && (
              <Button icon={<DownloadOutlined />} href={errorRowsUrl(event.id, importId)} download>
                {t('voters.import.downloadErrors')}
              </Button>
            )}
            <Button onClick={restart}>{t('voters.import.another')}</Button>
          </Flex>
          {confirm.isError && (
            <Typography.Text type="danger" role="alert">
              {errorMessage(t, confirm.error)}
            </Typography.Text>
          )}
        </Flex>
      )}

      {status === 'completed' && result && (
        <Result
          status="success"
          title={t('voters.import.done', { count: result.importedRows })}
          subTitle={
            result.errorRows > 0
              ? t('voters.import.skipped', { count: result.errorRows })
              : undefined
          }
          extra={
            <Button type="primary" onClick={back}>
              {t('voters.import.back')}
            </Button>
          }
        />
      )}
    </Flex>
  );
}
