// SYS-03 logo (App Flow 7.3, Design System 7.6): the current logo with "Remove", and a dropzone
// for a JPG or PNG up to 2 MB that shows progress while uploading and an error under it.
import { DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import { App, Button, Flex, Progress, Typography, Upload } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { errorMessage } from '../../api/errorMessage';
import { ACCEPTED_IMAGE_TYPES, isAcceptedImage } from '../../components/photo';
import { useRemoveLogo, useUploadLogo } from './organizationApi';

export function LogoField({
  url,
  organizationName,
  disabled = false,
}: {
  url: string | null;
  organizationName: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const uploadLogo = useUploadLogo();
  const removeLogo = useRemoveLogo();
  const [progress, setProgress] = useState<{ name: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null || removeLogo.isPending;

  function failed(e: unknown) {
    setError(
      isApiError(e, 'FILE_TYPE') || isApiError(e, 'FILE_TOO_LARGE')
        ? t('files.imageInvalid')
        : errorMessage(t, e),
    );
  }

  function send(file: File) {
    if (!isAcceptedImage(file)) {
      setError(t('files.imageInvalid'));
      return;
    }
    setError(null);
    setProgress({ name: file.name, percent: 0 });
    uploadLogo.mutate(
      { file, onProgress: (percent) => setProgress({ name: file.name, percent }) },
      {
        onSuccess: () => void message.success(t('files.logoSaved')),
        onError: failed,
        onSettled: () => setProgress(null),
      },
    );
  }

  return (
    <Flex vertical gap="small">
      {url && (
        <Flex align="center" gap="middle" wrap>
          <img
            className="vk-logo-preview"
            src={url}
            alt={t('files.logoOf', { name: organizationName })}
          />
          <Button
            size="small"
            color="primary"
            variant="text"
            icon={<DeleteOutlined />}
            loading={removeLogo.isPending}
            disabled={disabled || busy}
            onClick={() => {
              setError(null);
              removeLogo.mutate(undefined, {
                onSuccess: () => void message.success(t('files.logoRemoved')),
                onError: failed,
              });
            }}
          >
            {t('files.remove')}
          </Button>
        </Flex>
      )}
      <div className="vk-dropzone" data-error={error ? true : undefined}>
        <Upload.Dragger
          accept={ACCEPTED_IMAGE_TYPES}
          showUploadList={false}
          maxCount={1}
          disabled={disabled || busy}
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
              <Typography.Text type="secondary" className="vk-text-sm">
                {t('files.imageHelp')}
              </Typography.Text>
            </Flex>
          )}
        </Upload.Dragger>
      </div>
      {error && (
        <Typography.Text type="danger" role="alert" className="vk-text-sm">
          {error}
        </Typography.Text>
      )}
    </Flex>
  );
}
