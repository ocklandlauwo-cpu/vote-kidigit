// Bulk photos (App Flow 6.4, 6.5; PRD CAT-08, VTR-06): a ZIP of JPG/PNG files named after the
// contesters (full name) or the voters (membership ID); the result lists matched and unmatched files.
import { CheckCircleOutlined, UploadOutlined } from '@ant-design/icons';
import {
  PHOTO_ZIP_MAX_BYTES,
  type PhotoZipResult,
  type PhotoZipTarget,
} from '@vote-kidigit/shared';
import { Button, Flex, Modal, Progress, Table, Typography, Upload } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../../api/client';
import { errorMessage } from '../../../api/errorMessage';
import { usePhotoZip } from './categoriesApi';

const isZip = (file: File) =>
  file.name.toLowerCase().endsWith('.zip') && file.size <= PHOTO_ZIP_MAX_BYTES;

export function PhotoZipDialog({
  eventId,
  target = 'contesters',
  open,
  onClose,
}: {
  eventId: string;
  target?: PhotoZipTarget;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const zip = usePhotoZip(eventId);
  const [progress, setProgress] = useState<{ name: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PhotoZipResult | null>(null);

  function close() {
    setProgress(null);
    setError(null);
    setResult(null);
    zip.reset();
    onClose();
  }

  function send(file: File) {
    if (!isZip(file)) {
      setError(t('categories.zip.invalid'));
      return;
    }
    setError(null);
    setProgress({ name: file.name, percent: 0 });
    zip.mutate(
      { file, target, onProgress: (percent) => setProgress({ name: file.name, percent }) },
      {
        onSuccess: setResult,
        onError: (e) =>
          setError(
            isApiError(e, 'FILE_TYPE') || isApiError(e, 'FILE_TOO_LARGE')
              ? t('categories.zip.invalid')
              : errorMessage(t, e),
          ),
        onSettled: () => setProgress(null),
      },
    );
  }

  return (
    <Modal
      open={open}
      title={t(target === 'voters' ? 'voters.zip.title' : 'categories.zip.title')}
      width={640}
      onCancel={progress ? undefined : close}
      closable={!progress}
      mask={{ closable: !progress }}
      destroyOnHidden
      footer={
        <Button type="primary" disabled={progress !== null} onClick={close}>
          {t('common.close')}
        </Button>
      }
    >
      <Flex vertical gap="middle">
        {!result && (
          <>
            <Typography.Text type="secondary">
              {t(target === 'voters' ? 'voters.zip.help' : 'categories.zip.help')}
            </Typography.Text>
            <div className="vk-dropzone" data-error={error ? true : undefined}>
              <Upload.Dragger
                accept=".zip,application/zip"
                showUploadList={false}
                maxCount={1}
                disabled={progress !== null}
                beforeUpload={(file) => {
                  send(file);
                  return false;
                }}
              >
                {progress ? (
                  <Flex vertical gap="small" aria-live="polite">
                    <Typography.Text>
                      {t('files.uploading', { name: progress.name })}
                    </Typography.Text>
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
            {error && (
              <Typography.Text type="danger" role="alert" className="vk-text-sm">
                {error}
              </Typography.Text>
            )}
          </>
        )}
        {result && (
          <>
            <Typography.Text strong>
              <CheckCircleOutlined style={{ color: 'var(--vk-success-fg)' }} />{' '}
              {t('categories.zip.matched', { count: result.matched.length })}
            </Typography.Text>
            {result.matched.length > 0 && (
              <Table
                size="small"
                rowKey="fileName"
                pagination={false}
                dataSource={result.matched}
                columns={[
                  { title: t('categories.zip.file'), dataIndex: 'fileName' },
                  {
                    title: t(
                      target === 'voters' ? 'voters.zip.person' : 'categories.zip.contester',
                    ),
                    dataIndex: 'name',
                  },
                ]}
              />
            )}
            {result.unmatched.length > 0 && (
              <>
                <Typography.Text strong>
                  {t('categories.zip.unmatched', { count: result.unmatched.length })}
                </Typography.Text>
                <Table
                  size="small"
                  rowKey="fileName"
                  pagination={false}
                  dataSource={result.unmatched}
                  columns={[
                    { title: t('categories.zip.file'), dataIndex: 'fileName' },
                    {
                      title: t('categories.zip.reason'),
                      dataIndex: 'problem',
                      render: (problem: PhotoZipResult['unmatched'][number]['problem']) =>
                        t(`categories.zip.problem.${problem}`),
                    },
                  ]}
                />
              </>
            )}
          </>
        )}
      </Flex>
    </Modal>
  );
}
