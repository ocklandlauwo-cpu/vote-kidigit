// EVT-04c Rules (App Flow 6.4, PRD RUL-01–RUL-05): selection mode, seats, skipping, winner
// rule and quorum, with a live sentence that says what the rules mean for voters.
import { type Category, type CategoryRules, CategoryRulesSchema } from '@vote-kidigit/shared';
import {
  Alert,
  App,
  Button,
  Drawer,
  Flex,
  Form,
  InputNumber,
  Radio,
  Switch,
  Typography,
} from 'antd';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../../api/errorMessage';
import { ruleSentence } from './ruleText';
import { useUpdateCategory } from './categoriesApi';

type Values = Omit<
  CategoryRules,
  'thresholdPct' | 'quorumPct' | 'exactCount' | 'minCount' | 'maxCount'
> & {
  exactCount?: number | null;
  minCount?: number | null;
  maxCount?: number | null;
  thresholdPct?: number | null;
  quorumPct?: number | null;
};

/** The form values as a rules object; fields of the other mode are dropped. */
function toRules(values: Values): CategoryRules {
  const range = values.selectionMode === 'range';
  return {
    selectionMode: values.selectionMode,
    exactCount: range ? null : (values.exactCount ?? null),
    minCount: range ? (values.minCount ?? null) : null,
    maxCount: range ? (values.maxCount ?? null) : null,
    seats: values.seats,
    allowSkip: values.allowSkip,
    winnerRule: values.winnerRule,
    thresholdPct: values.winnerRule === 'threshold' ? (values.thresholdPct ?? null) : null,
    quorumPct: values.quorumPct ?? null,
  };
}

export function RulesDrawer({
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
  const [form] = Form.useForm<Values>();
  const update = useUpdateCategory(eventId);
  const values = Form.useWatch([], form) as Values | undefined;
  const mode = Form.useWatch('selectionMode', form) as Values['selectionMode'] | undefined;
  const winnerRule = Form.useWatch('winnerRule', form) as Values['winnerRule'] | undefined;
  const preview = values && CategoryRulesSchema.safeParse(toRules(values));

  const count = (label: string) => ({
    rules: [{ required: true, type: 'integer' as const, min: 1, max: 100, message: label }],
  });
  const percent = (required: boolean) => [
    { required, message: t('categories.rules.pctInvalid') },
    {
      validator: (_: unknown, value: unknown) =>
        value === null ||
        value === undefined ||
        (typeof value === 'number' && value > 0 && value <= 100)
          ? Promise.resolve()
          : Promise.reject(new Error(t('categories.rules.pctInvalid'))),
    },
  ];

  function submit(form: Values) {
    if (!category) return;
    update.mutate(
      { id: category.id, body: { rules: toRules(form) } },
      {
        onSuccess: () => {
          void message.success(t('categories.rules.saved'));
          onClose();
        },
      },
    );
  }

  return (
    <Drawer
      open={category !== null}
      onClose={onClose}
      title={category ? t('categories.rules.title', { name: category.name }) : ''}
      size={480}
      destroyOnHidden
      footer={
        <Flex justify="end" gap="middle">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            type="primary"
            loading={update.isPending}
            disabled={readOnly}
            onClick={() => form.submit()}
          >
            {t('common.save')}
          </Button>
        </Flex>
      }
    >
      {category && (
        <Form<Values>
          form={form}
          layout="vertical"
          requiredMark={false}
          disabled={readOnly}
          initialValues={category.rules}
          onFinish={submit}
        >
          <Form.Item name="selectionMode" label={t('categories.rules.selection')}>
            <Radio.Group
              options={[
                { value: 'exact', label: t('categories.rules.exact') },
                { value: 'range', label: t('categories.rules.range') },
              ]}
            />
          </Form.Item>
          {mode === 'range' ? (
            <Flex gap="middle" wrap>
              <Form.Item
                name="minCount"
                label={t('categories.rules.minCount')}
                {...count(t('categories.rules.countInvalid'))}
              >
                <InputNumber min={1} max={100} precision={0} />
              </Form.Item>
              <Form.Item
                name="maxCount"
                label={t('categories.rules.maxCount')}
                dependencies={['minCount']}
                rules={[
                  ...count(t('categories.rules.countInvalid')).rules,
                  ({ getFieldValue }) => ({
                    validator: (_, value: unknown) => {
                      const min = getFieldValue('minCount') as unknown;
                      return typeof value === 'number' && typeof min === 'number' && value < min
                        ? Promise.reject(new Error(t('categories.rules.maxBelowMin')))
                        : Promise.resolve();
                    },
                  }),
                ]}
              >
                <InputNumber min={1} max={100} precision={0} />
              </Form.Item>
            </Flex>
          ) : (
            <Form.Item
              name="exactCount"
              label={t('categories.rules.exactCount')}
              {...count(t('categories.rules.countInvalid'))}
            >
              <InputNumber min={1} max={100} precision={0} />
            </Form.Item>
          )}
          <Form.Item
            name="seats"
            label={t('categories.rules.seats')}
            {...count(t('categories.rules.countInvalid'))}
          >
            <InputNumber min={1} max={100} precision={0} />
          </Form.Item>
          <Form.Item
            name="allowSkip"
            label={t('categories.rules.allowSkip')}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item name="winnerRule" label={t('categories.rules.winnerRule')}>
            <Radio.Group
              options={[
                { value: 'plurality', label: t('categories.rules.plurality') },
                { value: 'threshold', label: t('categories.rules.threshold') },
              ]}
            />
          </Form.Item>
          {winnerRule === 'threshold' && (
            <Form.Item
              name="thresholdPct"
              label={t('categories.rules.thresholdPct')}
              rules={percent(true)}
            >
              <InputNumber min={0.01} max={100} step={1} precision={2} suffix="%" />
            </Form.Item>
          )}
          <Form.Item
            name="quorumPct"
            label={t('categories.rules.quorumPct')}
            extra={t('categories.rules.quorumHelp')}
            rules={percent(false)}
          >
            <InputNumber min={0.01} max={100} step={1} precision={2} suffix="%" />
          </Form.Item>
          {preview?.success && (
            <Alert
              type="info"
              showIcon
              title={<span data-testid="rule-sentence">{ruleSentence(t, preview.data)}</span>}
            />
          )}
          {update.isError && (
            <Typography.Text type="danger" role="alert">
              {errorMessage(t, update.error)}
            </Typography.Text>
          )}
        </Form>
      )}
    </Drawer>
  );
}
