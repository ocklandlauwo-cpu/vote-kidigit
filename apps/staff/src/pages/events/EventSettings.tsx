// EVT-09 Event settings (App Flow 6.9): name, start and end (Draft only); party display and
// results visibility; moderators and observers (Admins add and remove); danger zone with
// Deactivate / Activate and Delete (Cancel and Archive arrive in step 20).
import { DeleteOutlined } from '@ant-design/icons';
import { type AssignmentType, type EventDetail, EventNameSchema } from '@vote-kidigit/shared';
import {
  App,
  Button,
  Card,
  DatePicker,
  Flex,
  Form,
  Input,
  Radio,
  Select,
  Skeleton,
  Switch,
  Tooltip,
  Typography,
} from 'antd';
import type { Dayjs } from 'dayjs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useOutletContext } from 'react-router';
import { isApiError } from '../../api/client';
import { errorMessage } from '../../api/errorMessage';
import { hasPermission, useMe } from '../../auth/useAuth';
import { Banner } from '../../components/Banner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useFormat } from '../../hooks/useFormat';
import { fromPicker, toPicker } from '../../zonedTime';
import { useUsers } from '../users/usersApi';
import {
  useDeleteEvent,
  useEventAssignments,
  useReplaceAssignments,
  useSetEventActive,
  useUpdateEvent,
} from './eventsApi';

interface DetailValues {
  name: string;
  startAt: Dayjs;
  endAt: Dayjs;
}

function Staff({ event }: { event: EventDetail }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const me = useMe().data;
  const canManage = hasPermission(me, 'assignments.manage');
  const assignments = useEventAssignments(event.id);
  const users = useUsers({ pageSize: 100 }, canManage);
  const replace = useReplaceAssignments(event.id);
  const [adding, setAdding] = useState<string | undefined>();

  if (assignments.isPending) return <Skeleton active paragraph={{ rows: 3 }} />;
  if (assignments.isError)
    return <Banner tone="danger" message={errorMessage(t, assignments.error)} inline />;
  const current = assignments.data.items;

  function save(next: { userId: string; type: AssignmentType }[]) {
    replace.mutate(
      { assignments: next },
      { onSuccess: () => void message.success(t('events.settings.staffSaved')) },
    );
  }
  const asPairs = current.map(({ userId, type }) => ({ userId, type }));
  const candidates = (users.data?.items ?? []).filter(
    (user) => user.status !== 'deactivated' && !current.some((a) => a.userId === user.id),
  );

  return (
    <Flex vertical gap="middle">
      {replace.isError && <Banner tone="danger" message={errorMessage(t, replace.error)} inline />}
      {current.length === 0 ? (
        <Typography.Text type="secondary">{t('events.settings.staffEmpty')}</Typography.Text>
      ) : (
        <ul className="vk-plain-list" data-testid="event-staff">
          {current.map((assignment) => (
            <li key={assignment.userId}>
              <Flex align="center" gap="middle" wrap>
                <span style={{ flex: 1 }}>
                  <Typography.Text strong>{assignment.fullName}</Typography.Text>
                  <Typography.Text type="secondary"> · {assignment.email}</Typography.Text>
                </span>
                <Select<AssignmentType>
                  value={assignment.type}
                  disabled={!canManage || replace.isPending}
                  aria-label={assignment.fullName}
                  style={{ minWidth: '12rem' }}
                  options={[
                    { value: 'moderator', label: t('events.settings.asModerator') },
                    { value: 'observer', label: t('events.settings.asObserver') },
                  ]}
                  onChange={(type) =>
                    save(asPairs.map((p) => (p.userId === assignment.userId ? { ...p, type } : p)))
                  }
                />
                {canManage && (
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={`${t('events.settings.remove')} ${assignment.fullName}`}
                    disabled={replace.isPending}
                    onClick={() => save(asPairs.filter((p) => p.userId !== assignment.userId))}
                  />
                )}
              </Flex>
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <Flex gap="small" wrap>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder={t('events.settings.addPerson')}
            aria-label={t('events.settings.addPerson')}
            value={adding}
            onChange={setAdding}
            loading={users.isPending}
            style={{ minWidth: '16rem' }}
            options={candidates.map((user) => ({ value: user.id, label: user.fullName }))}
          />
          <Button
            disabled={!adding}
            loading={replace.isPending}
            onClick={() => {
              if (!adding) return;
              const user = users.data?.items.find((u) => u.id === adding);
              const type: AssignmentType =
                user?.role?.systemKey === 'observer' ? 'observer' : 'moderator';
              save([...asPairs, { userId: adding, type }]);
              setAdding(undefined);
            }}
          >
            {t('events.settings.addPerson')}
          </Button>
        </Flex>
      )}
    </Flex>
  );
}

export function EventSettings() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const event = useOutletContext<EventDetail>();
  const me = useMe().data;
  const { timeZone } = useFormat();
  const update = useUpdateEvent(event.id);
  const setActive = useSetEventActive(event.id);
  const remove = useDeleteEvent(event.id);
  const [confirm, setConfirm] = useState<'deactivate' | 'delete' | null>(null);
  const [form] = Form.useForm<DetailValues>();
  const canEdit = hasPermission(me, 'event.edit');
  const draft = event.status === 'draft';

  const failure = update.error ?? setActive.error ?? remove.error;
  const failureText = failure
    ? isApiError(failure, 'INVALID_TRANSITION')
      ? t('events.settings.openCannotDeactivate')
      : errorMessage(t, failure)
    : null;

  return (
    <Flex vertical gap="large" style={{ maxWidth: '48rem' }}>
      {/* EVT-09 */}
      {failureText && <Banner tone="danger" message={failureText} />}

      <Card title={t('events.settings.details')}>
        {!draft && <Banner tone="locked" message={t('events.settings.detailsLocked')} inline />}
        <Form<DetailValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          disabled={!draft || !canEdit || update.isPending}
          initialValues={{
            name: event.name,
            startAt: toPicker(event.startAt, timeZone),
            endAt: toPicker(event.endAt, timeZone),
          }}
          onFinish={(values) =>
            update.mutate(
              {
                name: values.name,
                startAt: fromPicker(values.startAt, timeZone),
                endAt: fromPicker(values.endAt, timeZone),
              },
              { onSuccess: () => void message.success(t('events.settings.saved')) },
            )
          }
          style={{ marginTop: draft ? 0 : 'var(--vk-space-4)' }}
        >
          <Form.Item
            name="name"
            label={t('events.name')}
            rules={[
              {
                validator: (_, value: unknown) =>
                  EventNameSchema.safeParse(value ?? '').success
                    ? Promise.resolve()
                    : Promise.reject(new Error(t('events.nameInvalid'))),
              },
            ]}
          >
            <Input maxLength={150} />
          </Form.Item>
          <Flex gap="middle" wrap>
            <Form.Item
              name="startAt"
              label={t('events.start')}
              rules={[{ required: true, message: t('events.timeRequired') }]}
              style={{ flex: 1, minWidth: '12rem' }}
            >
              <DatePicker
                showTime={{ format: 'HH:mm' }}
                format="D MMM YYYY, HH:mm"
                style={{ width: '100%' }}
              />
            </Form.Item>
            <Form.Item
              name="endAt"
              label={t('events.end')}
              dependencies={['startAt']}
              rules={[
                { required: true, message: t('events.timeRequired') },
                ({ getFieldValue }) => ({
                  validator: (_, value: Dayjs | undefined) => {
                    const from = getFieldValue('startAt') as Dayjs | undefined;
                    return !value || !from || value.isAfter(from)
                      ? Promise.resolve()
                      : Promise.reject(new Error(t('events.endBeforeStart')));
                  },
                }),
              ]}
              style={{ flex: 1, minWidth: '12rem' }}
            >
              <DatePicker
                showTime={{ format: 'HH:mm' }}
                format="D MMM YYYY, HH:mm"
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Flex>
          <Typography.Text type="secondary">
            {t('events.timeZoneNote', { zone: timeZone })}
          </Typography.Text>
          {draft && canEdit && (
            <Flex justify="end">
              <Button type="primary" htmlType="submit" loading={update.isPending}>
                {t('common.save')}
              </Button>
            </Flex>
          )}
        </Form>
      </Card>

      <Card title={t('events.settings.display')}>
        <Flex vertical gap="middle">
          <Flex gap="small" align="center">
            <Switch
              checked={event.showParty}
              disabled={!draft || !canEdit || update.isPending}
              onChange={(showParty) => update.mutate({ showParty })}
              aria-label={t('events.settings.showParty')}
            />
            <Typography.Text>{t('events.settings.showParty')}</Typography.Text>
          </Flex>
          <div>
            <Typography.Text style={{ display: 'block', marginBottom: 'var(--vk-space-2)' }}>
              {t('events.settings.resultsVisibility')}
            </Typography.Text>
            <Radio.Group
              value={event.resultsVisibility}
              disabled={!canEdit || update.isPending}
              onChange={(e) =>
                update.mutate({
                  resultsVisibility: e.target.value as EventDetail['resultsVisibility'],
                })
              }
              options={[
                { value: 'full', label: t('events.settings.resultsFull') },
                { value: 'winners_only', label: t('events.settings.resultsWinners') },
              ]}
            />
          </div>
        </Flex>
      </Card>

      <Card title={t('events.settings.staff')}>
        <Staff event={event} />
      </Card>

      <Card title={t('events.settings.danger')} style={{ borderColor: 'var(--vk-danger-border)' }}>
        <Flex wrap gap="small">
          <Tooltip title={t('events.soon')}>
            <Button danger disabled>
              {t('events.actions.cancel')}
            </Button>
          </Tooltip>
          {event.status !== 'open' && (
            <Button
              danger={event.isActive}
              disabled={!hasPermission(me, 'event.activate') || setActive.isPending}
              onClick={() =>
                event.isActive
                  ? setConfirm('deactivate')
                  : setActive.mutate(true, {
                      onSuccess: () => void message.success(t('events.settings.activated')),
                    })
              }
            >
              {t(event.isActive ? 'events.actions.deactivate' : 'events.actions.activate')}
            </Button>
          )}
          <Tooltip title={t('events.soon')}>
            <Button disabled>{t('events.actions.archive')}</Button>
          </Tooltip>
          {(draft || event.status === 'cancelled') && (
            <Button danger type="text" disabled={!canEdit} onClick={() => setConfirm('delete')}>
              {t('events.actions.delete')}
            </Button>
          )}
        </Flex>
      </Card>

      <ConfirmDialog
        open={confirm === 'deactivate'}
        tone="danger"
        title={t('events.settings.deactivateTitle', { name: event.name })}
        body={t('events.settings.deactivateBody')}
        confirmLabel={t('events.actions.deactivate')}
        loading={setActive.isPending}
        onConfirm={() =>
          setActive.mutate(false, {
            onSuccess: () => void message.success(t('events.settings.deactivated')),
            onSettled: () => setConfirm(null),
          })
        }
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        tone="danger"
        title={t('events.settings.deleteTitle', { name: event.name })}
        body={t('events.settings.deleteBody')}
        confirmLabel={t('events.actions.delete')}
        typeToConfirm={event.name}
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => {
              void message.success(t('events.settings.deleted'));
              void navigate('/events', { replace: true });
            },
            onSettled: () => setConfirm(null),
          })
        }
        onCancel={() => setConfirm(null)}
      />
    </Flex>
  );
}
