// Category card (Design System 8.6, App Flow 6.4): drag handle, 40 × 56 picture, name, status
// badge and "More"; the rule summary, voting window and eligible voters; the contesters with
// 48 × 67 photos and "+ Add contester"; the Open / Close switch while the event is Open.
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  HolderOutlined,
  MoreOutlined,
  PictureOutlined,
  PlusOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Category, Contester, EventDetail } from '@vote-kidigit/shared';
import { Button, Dropdown, Flex, type MenuProps, Switch, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { StatusBadge } from '../../../components/StatusBadge';
import { useFormat } from '../../../hooks/useFormat';
import { ruleSummary, windowText } from './ruleText';

export type CategoryAction = 'edit' | 'rules' | 'voters' | 'toggleActive' | 'delete';

export interface CategoryCardProps {
  category: Category;
  event: EventDetail;
  /** category.manage on a Draft event. */
  editable: boolean;
  /** contester.manage on a Draft event: "+ Add contester". */
  canContesters: boolean;
  /** event.close while the event is Open. */
  canOpenClose: boolean;
  /** Drag and the arrows; false while locked or for a single card. */
  reorderable: boolean;
  /** Up/down buttons instead of only the drag handle (narrow screens). */
  showArrows: boolean;
  isFirst: boolean;
  isLast: boolean;
  onAction: (action: CategoryAction) => void;
  onMove: (direction: -1 | 1) => void;
  onContester: (contester: Contester | null) => void;
  onSetOpen: (open: boolean) => void;
}

export function CategoryCard({
  category,
  event,
  editable,
  canContesters,
  canOpenClose,
  reorderable,
  showArrows,
  isFirst,
  isLast,
  onAction,
  onMove,
  onContester,
  onSetOpen,
}: CategoryCardProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
    disabled: !reorderable,
  });

  const items: MenuProps['items'] = [
    { key: 'edit', label: t(editable ? 'categories.edit' : 'common.view') },
    { key: 'rules', label: t('categories.rulesAction') },
    { key: 'voters', label: t('categories.votersAction') },
    ...(editable
      ? [
          {
            key: 'toggleActive',
            label: t(category.isActive ? 'categories.deactivate' : 'categories.activate'),
          },
          { type: 'divider' as const },
          { key: 'delete', label: t('categories.delete'), danger: true },
        ]
      : []),
  ];

  // An Open category can be closed; a not yet open one opened by hand. A closed one stays closed.
  const switchable = canOpenClose && category.isActive && category.closedAt === null;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className="vk-category-card"
      data-dragging={isDragging || undefined}
      data-testid={`category-${category.id}`}
    >
      {/* Two groups that wrap as units, so a narrow card never squeezes the name. */}
      <Flex align="center" gap="middle" wrap>
        <Flex align="center" gap="middle" style={{ flex: '1 1 14rem', minWidth: 0 }}>
          {reorderable && (
            <Button
              type="text"
              size="small"
              className="vk-drag-handle"
              icon={<HolderOutlined />}
              aria-label={t('categories.dragHandle', { name: category.name })}
              {...attributes}
              {...listeners}
            />
          )}
          <div className="vk-photo-category">
            {category.pictureUrl ? (
              <img src={category.pictureUrl} alt="" />
            ) : (
              <PictureOutlined aria-hidden />
            )}
          </div>
          <Typography.Title
            level={3}
            style={{ margin: 0, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}
          >
            {category.name}
          </Typography.Title>
        </Flex>
        <Flex align="center" gap="small" wrap>
          <StatusBadge domain="category" value={category.status} />
          {category.yesNo && <Tag color="processing">{t('categories.yesNo')}</Tag>}
          {reorderable && showArrows && (
            <Flex gap="small">
              <Button
                size="small"
                icon={<ArrowUpOutlined />}
                aria-label={t('categories.moveUp')}
                disabled={isFirst}
                onClick={() => onMove(-1)}
              />
              <Button
                size="small"
                icon={<ArrowDownOutlined />}
                aria-label={t('categories.moveDown')}
                disabled={isLast}
                onClick={() => onMove(1)}
              />
            </Flex>
          )}
          <Dropdown
            trigger={['click']}
            menu={{ items, onClick: ({ key }) => onAction(key as CategoryAction) }}
          >
            <Button type="text" icon={<MoreOutlined />} aria-label={t('categories.more')} />
          </Dropdown>
        </Flex>
      </Flex>

      <Flex vertical gap="small" className="vk-category-meta">
        <Typography.Text type="secondary" className="vk-text-sm">
          {ruleSummary(t, category.rules)}
        </Typography.Text>
        <Typography.Text type="secondary" className="vk-text-sm">
          {windowText(t, category, format.dateTime)} ·{' '}
          {t('categories.eligibleVoters', { count: category.eligibleVoters })}
        </Typography.Text>
        {switchable && (
          <Flex align="center" gap="small">
            <Switch
              checked={category.status === 'open'}
              onChange={onSetOpen}
              aria-label={t(
                category.status === 'open' ? 'categories.closeCategory' : 'categories.openCategory',
              )}
            />
            <Typography.Text>
              {t(
                category.status === 'open' ? 'categories.closeCategory' : 'categories.openCategory',
              )}
            </Typography.Text>
          </Flex>
        )}
      </Flex>

      <Flex gap="middle" wrap align="end" className="vk-contester-row">
        {category.contesters.length === 0 && (
          <Typography.Text type="secondary">{t('categories.noContesters')}</Typography.Text>
        )}
        {category.contesters.map((contester) => (
          <button
            key={contester.id}
            type="button"
            className="vk-contester"
            data-withdrawn={contester.status === 'withdrawn' || undefined}
            onClick={() => onContester(contester)}
          >
            <span className="vk-photo-contester">
              {contester.photoUrl ? (
                <img src={contester.photoUrl} alt="" />
              ) : (
                <UserOutlined aria-hidden />
              )}
            </span>
            <span className="vk-text-sm">{contester.fullName}</span>
            {event.showParty && contester.party && (
              <span className="vk-text-sm vk-text-secondary">{contester.party}</span>
            )}
            {contester.status === 'withdrawn' && <Tag>{t('categories.withdrawn')}</Tag>}
          </button>
        ))}
        {canContesters && (
          <Button
            color="primary"
            variant="text"
            icon={<PlusOutlined />}
            onClick={() => onContester(null)}
          >
            {t('categories.addContester')}
          </Button>
        )}
      </Flex>
    </div>
  );
}
