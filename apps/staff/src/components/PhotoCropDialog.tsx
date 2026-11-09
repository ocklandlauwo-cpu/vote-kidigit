// Crop dialog (Design System 7.6): 640 px dialog, crop area fixed at 5:7, zoom 1–3×, Save and
// Cancel. The crop area moves with the mouse, touch or the arrow keys.
import { PHOTO_ASPECT } from '@vote-kidigit/shared';
import { Button, Flex, Modal, Slider, Typography } from 'antd';
import { useState } from 'react';
import Cropper from 'react-easy-crop';
import { useTranslation } from 'react-i18next';
import type { PixelArea } from './photo';

export function PhotoCropDialog({
  source,
  saving = false,
  onSave,
  onCancel,
}: {
  /** Object URL of the chosen image; the dialog is open while set. */
  source: string | null;
  saving?: boolean;
  onSave: (area: PixelArea) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<PixelArea | null>(null);

  function reset() {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
  }

  return (
    <Modal
      open={source !== null}
      title={t('files.cropTitle')}
      width={640}
      mask={{ closable: !saving }}
      closable={!saving}
      keyboard={!saving}
      onCancel={onCancel}
      afterClose={reset}
      destroyOnHidden
      footer={
        <Flex gap="small" justify="end">
          <Button onClick={onCancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button
            type="primary"
            loading={saving}
            disabled={!area}
            onClick={() => area && onSave(area)}
          >
            {t('common.save')}
          </Button>
        </Flex>
      }
    >
      <Flex vertical gap="middle">
        <Typography.Text type="secondary">{t('files.cropHelp')}</Typography.Text>
        <div className="vk-crop-area">
          {source && (
            <Cropper
              image={source}
              crop={crop}
              zoom={zoom}
              minZoom={1}
              maxZoom={3}
              aspect={PHOTO_ASPECT}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => setArea(pixels)}
            />
          )}
        </div>
        <Flex align="center" gap="middle">
          <Typography.Text id="vk-crop-zoom">{t('files.zoom')}</Typography.Text>
          <Slider
            style={{ flex: 1 }}
            min={1}
            max={3}
            step={0.1}
            value={zoom}
            onChange={setZoom}
            aria-labelledby="vk-crop-zoom"
            disabled={saving}
          />
        </Flex>
      </Flex>
    </Modal>
  );
}
