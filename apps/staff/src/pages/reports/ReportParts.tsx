// Report pieces shared by the Results, Voters and audit screens (App Flow 11.3): the "Tunaandaa
// PDF…" line with progress, the failure banner with Retry (App Flow 13), and the Recent downloads
// list of an event.
import { DownloadOutlined, FileExcelOutlined, FilePdfOutlined } from '@ant-design/icons';
import type { ReportJob } from '@vote-kidigit/shared';
import { Button, Card, Flex, Skeleton, Spin, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { errorMessage } from '../../api/errorMessage';
import { Banner } from '../../components/Banner';
import { useFormat } from '../../hooks/useFormat';
import { useRecentReports } from './reportsApi';

interface ReportState {
  preparing: boolean;
  failed: boolean;
  job: ReportJob | null;
  requestError: unknown;
}

/** Progress while a report is prepared, or why it failed with a way to try again. */
export function ReportProgress({
  report,
  kind,
  onRetry,
}: {
  report: ReportState;
  kind: 'pdf' | 'excel';
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (report.preparing) {
    return (
      <Flex gap="small" align="center" role="status" data-testid="report-preparing">
        <Spin size="small" />
        <Typography.Text>
          {t(kind === 'pdf' ? 'reports.preparingPdf' : 'reports.preparingFile')}
          {report.job && report.job.progress > 0 ? ` ${report.job.progress}%` : ''}
        </Typography.Text>
      </Flex>
    );
  }
  if (!report.failed) return null;
  const error = report.requestError;
  const message =
    error === null
      ? t(kind === 'pdf' ? 'reports.failedPdf' : 'reports.failedFile')
      : isApiError(error, 'INVALID_TRANSITION')
        ? t('reports.notReady')
        : errorMessage(t, error);
  return (
    <Banner
      tone="danger"
      message={message}
      action={
        <Button size="small" type="text" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      }
    />
  );
}

/** "Recent downloads" of an event (App Flow 11.3): the last ten reports, each downloadable again. */
export function RecentDownloads({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const format = useFormat();
  const recent = useRecentReports(eventId);
  if (recent.isPending) return <Skeleton active paragraph={{ rows: 2 }} />;
  if (recent.isError) {
    return <Banner tone="danger" message={errorMessage(t, recent.error)} />;
  }
  return (
    <Card title={t('reports.recentTitle')} size="small">
      {recent.data.length === 0 ? (
        <Typography.Text type="secondary">{t('reports.recentEmpty')}</Typography.Text>
      ) : (
        <ul className="vk-plain-list" data-testid="recent-downloads">
          {recent.data.map((job) => (
            <li key={job.id}>
              <Flex justify="space-between" align="center" gap="middle" wrap>
                <Flex gap="small" align="center">
                  {job.type === 'voters_xlsx' ? (
                    <FileExcelOutlined aria-hidden />
                  ) : (
                    <FilePdfOutlined aria-hidden />
                  )}
                  <Flex vertical>
                    <Typography.Text>{t(`reports.types.${job.type}`)}</Typography.Text>
                    <Typography.Text type="secondary">
                      {t('reports.requested', {
                        name: job.requestedBy ?? t('reports.system'),
                        time: format.dateTime(job.createdAt),
                      })}
                    </Typography.Text>
                  </Flex>
                </Flex>
                {job.downloadUrl ? (
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    href={job.downloadUrl}
                    aria-label={`${t('reports.download')} ${t(`reports.types.${job.type}`)}`}
                  >
                    {t('reports.download')}
                  </Button>
                ) : (
                  <Typography.Text type={job.status === 'failed' ? 'danger' : 'secondary'}>
                    {t(`reports.status.${job.status}`)}
                  </Typography.Text>
                )}
              </Flex>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
