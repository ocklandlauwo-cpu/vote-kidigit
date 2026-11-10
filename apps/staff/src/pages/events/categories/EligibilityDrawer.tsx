// EVT-04d Voters (App Flow 6.4, PRD RUL-07, VTR-08): all event voters, or selected voters with
// a searchable list (VoterPicker) once the category is in "selected" mode. The count follows the
// choices.
import type { Category, EligibilityMode } from '@vote-kidigit/shared';
import { App, Button, Drawer, Flex, Radio, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../../api/errorMessage';
import { useChangeEligibility, useSetEligibility } from './categoriesApi';
import { VoterPicker } from './VoterPicker';

export function EligibilityDrawer({
  eventId,
  category,
  readOnly,
  onClose,
}: {
  eventId: string;
  category: Category | null;
  readOnly: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [mode, setMode] = useState<EligibilityMode | null>(null);
  const setAll = useSetEligibility(eventId);
  // Switching to "selected" keeps any voters already selected (PATCH with nothing to change).
  const toSelected = useChangeEligibility(eventId);
  const chosen = mode ?? category?.eligibility ?? 'all';
  const pending = setAll.isPending || toSelected.isPending;
  const failure = setAll.error ?? toSelected.error;

  function close() {
    setMode(null);
    setAll.reset();
    toSelected.reset();
    onClose();
  }

  function save() {
    if (!category) return;
    const onSuccess = () => {
      void message.success(t('categories.eligibility.saved'));
      close();
    };
    if (chosen === 'all') {
      setAll.mutate({ id: category.id, body: { mode: 'all' } }, { onSuccess });
    } else {
      // Stay open: the voter list appears once the category is in "selected" mode.
      toSelected.mutate(
        { id: category.id, body: {} },
        {
          onSuccess: () => {
            void message.success(t('categories.eligibility.saved'));
            setMode(null);
          },
        },
      );
    }
  }

  return (
    <Drawer
      open={category !== null}
      onClose={close}
      title={category ? t('categories.eligibility.title', { name: category.name }) : ''}
      size={480}
      destroyOnHidden
      footer={
        <Flex justify="end" gap="middle">
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button
            type="primary"
            loading={pending}
            disabled={readOnly || chosen === category?.eligibility}
            onClick={save}
          >
            {t('common.save')}
          </Button>
        </Flex>
      }
    >
      {category && (
        <Flex vertical gap="middle">
          <Radio.Group
            value={chosen}
            disabled={readOnly}
            onChange={(e) => setMode(e.target.value as EligibilityMode)}
            options={[
              { value: 'all', label: t('categories.eligibility.all') },
              { value: 'selected', label: t('categories.eligibility.selected') },
            ]}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--vk-space-2)' }}
          />
          {chosen === category.eligibility && (
            <Typography.Text strong>
              {t('categories.eligibility.count', { count: category.eligibleVoters })}
            </Typography.Text>
          )}
          {chosen === 'selected' && category.eligibility === 'selected' && (
            <VoterPicker eventId={eventId} categoryId={category.id} readOnly={readOnly} />
          )}
          {failure && (
            <Typography.Text type="danger" role="alert">
              {errorMessage(t, failure)}
            </Typography.Text>
          )}
        </Flex>
      )}
    </Drawer>
  );
}
