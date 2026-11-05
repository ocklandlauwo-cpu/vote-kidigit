// Confirmation dialog (Design System 8.10): a question as title, the consequence as body, Cancel
// and a confirm button named by its verb. Variants: destructive (danger button, overlay click
// does not close), type-to-confirm (the button stays disabled until the text matches exactly,
// trimmed, case-sensitive) and reason-required (textarea, at least 10 characters).
import { InfoCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { Button, Flex, Form, Input, Modal } from 'antd';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: 'info' | 'warning' | 'danger';
  /** Text to type, e.g. the event name. */
  typeToConfirm?: string;
  /** Asks for a reason, passed to onConfirm. */
  requireReason?: boolean;
  /** While the action runs: the button spins and the dialog cannot be dismissed. */
  loading?: boolean;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}

/** Design System 8.10: "Reason required … min 10 characters". */
const REASON_MIN_LENGTH = 10;

export function ConfirmDialog(props: ConfirmDialogProps) {
  const { open, title, tone = 'warning', loading = false, onCancel } = props;
  const Icon = tone === 'info' ? InfoCircleOutlined : WarningOutlined;
  return (
    <Modal
      open={open}
      width={480}
      title={
        <Flex gap="small" align="center">
          <Icon className={`vk-tone-${tone}`} style={{ color: 'var(--vk-tone-fg)' }} aria-hidden />
          <span>{title}</span>
        </Flex>
      }
      onCancel={loading ? undefined : onCancel}
      closable={!loading}
      keyboard={!loading}
      mask={{ closable: tone !== 'danger' && !loading }}
      // Unmounted when closed, so typed text and the reason start empty every time.
      destroyOnHidden
      footer={null}
    >
      <ConfirmContent {...props} tone={tone} loading={loading} />
    </Modal>
  );
}

function ConfirmContent({
  body,
  confirmLabel,
  tone,
  typeToConfirm,
  requireReason = false,
  loading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState({ typed: false, reason: false });
  const typedId = useId();
  const reasonId = useId();

  const typedOk = typeToConfirm === undefined || typed.trim() === typeToConfirm.trim();
  const reasonOk = !requireReason || reason.trim().length >= REASON_MIN_LENGTH;
  const hasInput = typeToConfirm !== undefined || requireReason;

  return (
    <>
      <div style={{ color: 'var(--vk-text-secondary)' }}>{body}</div>
      {hasInput && (
        <Form layout="vertical" style={{ marginTop: 'var(--vk-space-4)' }} component="div">
          {typeToConfirm !== undefined && (
            <Form.Item
              label={t('confirm.typeToConfirm', { text: typeToConfirm })}
              htmlFor={typedId}
              validateStatus={touched.typed && !typedOk ? 'error' : undefined}
              help={touched.typed && !typedOk ? t('confirm.typeMismatch') : undefined}
            >
              <Input
                id={typedId}
                value={typed}
                autoFocus
                autoComplete="off"
                disabled={loading}
                onChange={(e) => setTyped(e.target.value)}
                onBlur={() => setTouched((s) => ({ ...s, typed: true }))}
              />
            </Form.Item>
          )}
          {requireReason && (
            <Form.Item
              label={t('confirm.reason')}
              htmlFor={reasonId}
              required
              validateStatus={touched.reason && !reasonOk ? 'error' : undefined}
              help={touched.reason && !reasonOk ? t('confirm.reasonTooShort') : undefined}
            >
              <Input.TextArea
                id={reasonId}
                value={reason}
                autoFocus={typeToConfirm === undefined}
                rows={3}
                maxLength={500}
                placeholder={t('confirm.reasonPlaceholder')}
                disabled={loading}
                onChange={(e) => setReason(e.target.value)}
                onBlur={() => setTouched((s) => ({ ...s, reason: true }))}
              />
            </Form.Item>
          )}
        </Form>
      )}
      <Flex justify="end" gap="middle" style={{ marginTop: 'var(--vk-space-6)' }}>
        {/* Focus starts on the input, or on the safest button (Cancel). */}
        <Button onClick={onCancel} disabled={loading} autoFocus={!hasInput}>
          {t('common.cancel')}
        </Button>
        <Button
          type="primary"
          danger={tone === 'danger'}
          loading={loading}
          disabled={!typedOk || !reasonOk}
          onClick={() => onConfirm(requireReason ? reason.trim() : undefined)}
        >
          {confirmLabel}
        </Button>
      </Flex>
    </>
  );
}
