// EVT-07 template editor (App Flow 6.7): placeholder chips, a live preview with sample data and
// the character counter ("162 / 160 — sent as 2 SMS"). SMS and email texts of one message type.
import {
  MESSAGE_PLACEHOLDERS,
  type MessageChannel,
  type MessagePlaceholder,
  type MessageTemplate,
  type MessageType,
  unknownPlaceholders,
} from '@vote-kidigit/shared';
import { App, Button, Drawer, Flex, Input, Segmented, Skeleton, Typography } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../../api/errorMessage';
import { useDebounced } from '../../../hooks/useDebounced';
import { usePreviewTemplate, usePutTemplates } from './messagesApi';
import { counterLimit } from './messageText';

interface Draft {
  body: string;
  subject: string;
}

const PREVIEW_DELAY_MS = 300;

export function TemplateDrawer({
  eventId,
  type,
  templates,
  readOnly,
  open,
  onClose,
}: {
  eventId: string;
  type: MessageType | null;
  templates: MessageTemplate[];
  readOnly: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const save = usePutTemplates(eventId);
  const [channel, setChannel] = useState<MessageChannel>('sms');
  const [drafts, setDrafts] = useState<Partial<Record<MessageChannel, Draft>>>({});
  const textArea = useRef<TextAreaRef>(null);

  const stored = templates.find((tpl) => tpl.type === type && tpl.channel === channel);
  const draft = drafts[channel] ?? { body: stored?.body ?? '', subject: stored?.subject ?? '' };
  const unknown = unknownPlaceholders(draft.body);
  const dirty = Object.keys(drafts).length > 0;

  // Strings, not an object: an object would be new on every render and never settle.
  const settledBody = useDebounced(draft.body, PREVIEW_DELAY_MS);
  const settledSubject = useDebounced(draft.subject, PREVIEW_DELAY_MS);
  const preview = usePreviewTemplate(
    eventId,
    type
      ? {
          type,
          channel,
          body: settledBody,
          subject: channel === 'email' ? settledSubject : null,
        }
      : null,
  );

  function edit(change: Partial<Draft>) {
    setDrafts((all) => ({ ...all, [channel]: { ...draft, ...change } }));
  }

  /** Puts the placeholder where the cursor is (or at the end). */
  function insert(name: MessagePlaceholder) {
    const element = textArea.current?.resizableTextArea?.textArea;
    const token = `{${name}}`;
    const start = element?.selectionStart ?? draft.body.length;
    const end = element?.selectionEnd ?? draft.body.length;
    edit({ body: draft.body.slice(0, start) + token + draft.body.slice(end) });
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function close() {
    setDrafts({});
    setChannel('sms');
    save.reset();
    onClose();
  }

  function submit(reset: boolean) {
    if (!type) return;
    const changed = reset
      ? [{ type, channel, body: null }]
      : (Object.entries(drafts) as [MessageChannel, Draft][]).map(([ch, d]) => ({
          type,
          channel: ch,
          body: d.body,
          ...(ch === 'email' && { subject: d.subject.trim() || null }),
        }));
    save.mutate(
      { templates: changed },
      {
        onSuccess: () => {
          void message.success(t(reset ? 'messages.editor.resetDone' : 'messages.editor.saved'));
          close();
        },
      },
    );
  }

  const limit = preview.data ? counterLimit(preview.data.encoding) : 160;

  return (
    <Drawer
      open={open}
      onClose={close}
      size={560}
      destroyOnHidden
      title={type ? t('messages.editor.title', { type: t(`messages.types.${type}`) }) : ''}
      footer={
        <Flex justify="space-between" gap="middle" wrap>
          <Flex>
            {!readOnly && stored?.source === 'event' && !dirty && (
              <Button type="text" onClick={() => submit(true)} loading={save.isPending}>
                {t('messages.editor.reset')}
              </Button>
            )}
          </Flex>
          <Flex gap="middle">
            <Button onClick={close}>{readOnly ? t('common.close') : t('common.cancel')}</Button>
            {!readOnly && (
              <Button
                type="primary"
                disabled={!dirty || unknown.length > 0 || draft.body.trim() === ''}
                loading={save.isPending}
                onClick={() => submit(false)}
                data-testid="template-save"
              >
                {t('common.save')}
              </Button>
            )}
          </Flex>
        </Flex>
      }
    >
      {!stored ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <Flex vertical gap="middle">
          <Segmented<MessageChannel>
            value={channel}
            onChange={setChannel}
            options={[
              { value: 'sms', label: t('messages.channel.sms') },
              { value: 'email', label: t('messages.channel.email') },
            ]}
          />
          <Typography.Text type="secondary">
            {t(`messages.source.${stored.source}`)}
          </Typography.Text>
          {channel === 'email' && (
            <Flex vertical gap="small">
              <Typography.Text strong>{t('messages.editor.subject')}</Typography.Text>
              <Input
                value={draft.subject}
                onChange={(e) => edit({ subject: e.target.value })}
                maxLength={200}
                disabled={readOnly}
                aria-label={t('messages.editor.subject')}
              />
            </Flex>
          )}
          <Flex vertical gap="small">
            <Typography.Text strong id="template-body-label">
              {t('messages.editor.body')}
            </Typography.Text>
            <Input.TextArea
              ref={textArea}
              value={draft.body}
              onChange={(e) => edit({ body: e.target.value })}
              autoSize={{ minRows: 4, maxRows: 10 }}
              maxLength={2000}
              disabled={readOnly}
              status={unknown.length > 0 ? 'error' : undefined}
              aria-labelledby="template-body-label"
              data-testid="template-body"
            />
            {unknown.length > 0 && (
              <Typography.Text type="danger" role="alert">
                {t('messages.editor.unknown', { names: unknown.map((n) => `{${n}}`).join(', ') })}
              </Typography.Text>
            )}
          </Flex>
          {!readOnly && (
            <Flex vertical gap="small">
              <Typography.Text type="secondary">{t('messages.editor.insert')}</Typography.Text>
              <Flex gap="small" wrap data-testid="placeholder-chips">
                {MESSAGE_PLACEHOLDERS.map((name) => (
                  <Button key={name} size="small" onClick={() => insert(name)}>
                    {`{${name}}`}
                  </Button>
                ))}
              </Flex>
            </Flex>
          )}
          <Flex vertical gap="small" data-testid="template-preview">
            <Typography.Text strong>{t('messages.editor.preview')}</Typography.Text>
            {preview.isError ? (
              <Typography.Text type="danger">{errorMessage(t, preview.error)}</Typography.Text>
            ) : preview.data ? (
              <>
                {channel === 'email' && preview.data.subject && (
                  <Typography.Text strong>{preview.data.subject}</Typography.Text>
                )}
                <div className="vk-message-preview">{preview.data.text}</div>
                {channel === 'sms' && (
                  <Typography.Text
                    type={preview.data.segments > 1 ? 'warning' : 'secondary'}
                    data-testid="template-counter"
                  >
                    {t('messages.editor.counter', {
                      count: preview.data.segments,
                      characters: preview.data.characters,
                      limit,
                    })}
                  </Typography.Text>
                )}
              </>
            ) : (
              <Skeleton active paragraph={{ rows: 2 }} title={false} />
            )}
          </Flex>
          {save.isError && (
            <Typography.Text type="danger" role="alert">
              {errorMessage(t, save.error)}
            </Typography.Text>
          )}
        </Flex>
      )}
    </Drawer>
  );
}
