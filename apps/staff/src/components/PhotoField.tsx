// Photo field (Design System 7.6, PRD CAT-07): a 70 × 98 (5:7) preview, "Upload photo" and
// "Remove". A chosen JPG or PNG under 2 MB opens the crop dialog; the cropped 350 × 490 JPEG is
// handed to onUpload. Used for categories, contesters and voters.
import { DeleteOutlined, PictureOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Flex, Typography, Upload } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../api/client';
import { errorMessage } from '../api/errorMessage';
import { PhotoCropDialog } from './PhotoCropDialog';
import { ACCEPTED_IMAGE_TYPES, cropToPhoto, isAcceptedImage, type PixelArea } from './photo';

export function PhotoField({
  url,
  name,
  onUpload,
  onRemove,
  disabled = false,
}: {
  /** GET /api/v1/files/:id of the current photo, or null. */
  url: string | null;
  /** Whose photo it is, for the image's alternative text. */
  name: string;
  onUpload: (photo: Blob) => Promise<unknown>;
  onRemove?: () => Promise<unknown>;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState<string | null>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The chosen image lives in an object URL until the dialog closes.
  useEffect(() => {
    if (!source) return undefined;
    return () => URL.revokeObjectURL(source);
  }, [source]);

  function choose(file: Blob) {
    if (!isAcceptedImage(file)) {
      setError(t('files.imageInvalid'));
      return;
    }
    setError(null);
    setSource(URL.createObjectURL(file));
  }

  function failed(e: unknown) {
    setError(
      isApiError(e, 'FILE_TYPE') || isApiError(e, 'FILE_TOO_LARGE')
        ? t('files.imageInvalid')
        : errorMessage(t, e),
    );
  }

  async function save(area: PixelArea) {
    if (!source) return;
    setBusy('upload');
    try {
      await onUpload(await cropToPhoto(source, area));
      setSource(null);
    } catch (e: unknown) {
      setSource(null);
      failed(e);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!onRemove) return;
    setBusy('remove');
    setError(null);
    try {
      await onRemove();
    } catch (e: unknown) {
      failed(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Flex
      gap="middle"
      align="start"
      className="vk-photo-field"
      data-error={error ? true : undefined}
    >
      <div className="vk-photo-preview">
        {url ? (
          <img src={url} alt={t('files.photoOf', { name })} />
        ) : (
          <PictureOutlined role="img" aria-label={t('files.noPhoto')} />
        )}
      </div>
      <Flex vertical gap="small">
        <Flex gap="small" wrap>
          <Upload
            accept={ACCEPTED_IMAGE_TYPES}
            showUploadList={false}
            maxCount={1}
            disabled={disabled || busy !== null}
            beforeUpload={(file) => {
              choose(file);
              return false;
            }}
          >
            <Button
              size="small"
              icon={<UploadOutlined />}
              loading={busy === 'upload'}
              disabled={disabled || busy !== null}
            >
              {t('files.uploadPhoto')}
            </Button>
          </Upload>
          {url && onRemove && (
            <Button
              size="small"
              color="primary"
              variant="text"
              icon={<DeleteOutlined />}
              loading={busy === 'remove'}
              disabled={disabled || busy !== null}
              onClick={() => void remove()}
            >
              {t('files.remove')}
            </Button>
          )}
        </Flex>
        <Typography.Text type="secondary" className="vk-text-sm">
          {t('files.imageHelp')}
        </Typography.Text>
        {error && (
          <Typography.Text type="danger" role="alert" className="vk-text-sm">
            {error}
          </Typography.Text>
        )}
      </Flex>
      <PhotoCropDialog
        source={source}
        saving={busy === 'upload'}
        onSave={(area) => void save(area)}
        onCancel={() => setSource(null)}
      />
    </Flex>
  );
}
