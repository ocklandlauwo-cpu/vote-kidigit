// EVT-04 Categories tab (App Flow 6.4): category cards in display order, reordered by dragging
// the handle (mouse, touch or keyboard: Space, arrows, Space) or with up/down arrows on narrow
// screens; panels for the category, its contesters, rules and voters; bulk photos as a ZIP.
// After publish the setup is read-only (the API refuses changes with EVENT_LOCKED).
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { Category, EventDetail } from '@vote-kidigit/shared';
import { App, Button, Flex, Grid, Skeleton } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router';
import { errorMessage } from '../../../api/errorMessage';
import { hasPermission, useMe } from '../../../auth/useAuth';
import { Banner } from '../../../components/Banner';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { CategoryCard, type CategoryAction } from './CategoryCard';
import { CategoryDrawer } from './CategoryDrawer';
import {
  useCategories,
  useDeleteCategory,
  useReorderCategories,
  useSetCategoryOpen,
  useUpdateCategory,
} from './categoriesApi';
import { ContesterDrawer, type ContesterTarget } from './ContesterDrawer';
import { EligibilityDrawer } from './EligibilityDrawer';
import { PhotoZipDialog } from './PhotoZipDialog';
import { RulesDrawer } from './RulesDrawer';

type Panel =
  | { kind: 'category'; category: Category | null }
  | { kind: 'rules' | 'voters'; category: Category }
  | null;

type Confirm = { kind: 'delete' | 'close'; category: Category } | null;

export function CategoriesTab() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const event = useOutletContext<EventDetail>();
  const me = useMe().data;
  const screens = Grid.useBreakpoint();
  const categories = useCategories(event.id);
  const reorder = useReorderCategories(event.id);
  const update = useUpdateCategory(event.id);
  const remove = useDeleteCategory(event.id);
  const setOpen = useSetCategoryOpen(event.id);
  const [panel, setPanel] = useState<Panel>(null);
  const [contester, setContester] = useState<ContesterTarget | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [zipOpen, setZipOpen] = useState(false);

  const draft = event.status === 'draft';
  const canCategories = hasPermission(me, 'category.manage');
  const canContesters = hasPermission(me, 'contester.manage');
  const editable = draft && canCategories;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (categories.isPending) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (categories.isError) {
    return <Banner tone="danger" message={errorMessage(t, categories.error)} inline />;
  }
  const items = categories.data.items;
  const ids = items.map((c) => c.id);
  // Panels stay open across saves (a photo upload refetches the list): show the latest version.
  const latest = (c: Category | null) => (c ? (items.find((x) => x.id === c.id) ?? c) : null);
  const contesterTarget: ContesterTarget | null = contester && {
    categoryId: contester.categoryId,
    contester:
      contester.contester &&
      (items
        .find((c) => c.id === contester.categoryId)
        ?.contesters.find((k) => k.id === contester.contester?.id) ??
        contester.contester),
  };

  const failed = (error: unknown) => void message.error(errorMessage(t, error));

  function save(order: string[]) {
    reorder.mutate(order, {
      onSuccess: () => void message.success(t('categories.reordered')),
      onError: failed,
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    save(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  }

  function onAction(category: Category, action: CategoryAction) {
    if (action === 'edit') setPanel({ kind: 'category', category });
    else if (action === 'rules') setPanel({ kind: 'rules', category });
    else if (action === 'voters') setPanel({ kind: 'voters', category });
    else if (action === 'delete') setConfirm({ kind: 'delete', category });
    else {
      update.mutate(
        { id: category.id, body: { isActive: !category.isActive } },
        { onSuccess: () => void message.success(t('categories.panel.saved')), onError: failed },
      );
    }
  }

  function onSetOpen(category: Category, open: boolean) {
    if (!open) {
      setConfirm({ kind: 'close', category });
      return;
    }
    setOpen.mutate(
      { id: category.id, open: true },
      { onSuccess: () => void message.success(t('categories.opened')), onError: failed },
    );
  }

  function confirmed() {
    if (!confirm) return;
    const { category } = confirm;
    const done = (text: string) => ({
      onSuccess: () => {
        void message.success(text);
        setConfirm(null);
      },
      onError: failed,
    });
    if (confirm.kind === 'delete') remove.mutate(category.id, done(t('categories.deleted')));
    else setOpen.mutate({ id: category.id, open: false }, done(t('categories.closed')));
  }

  return (
    <Flex vertical gap="middle">
      {!draft && <Banner tone="info" message={t('categories.locked')} inline />}
      {(editable || (draft && canContesters)) && items.length > 0 && (
        <Flex gap="small" justify="end" wrap>
          {draft && canContesters && (
            <Button icon={<UploadOutlined />} onClick={() => setZipOpen(true)}>
              {t('categories.uploadZip')}
            </Button>
          )}
          {editable && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setPanel({ kind: 'category', category: null })}
            >
              {t('categories.addCategory')}
            </Button>
          )}
        </Flex>
      )}

      {items.length === 0 ? (
        <EmptyState
          kind="list"
          title={t('categories.empty')}
          action={
            editable
              ? {
                  label: t('categories.addCategory'),
                  icon: <PlusOutlined />,
                  onClick: () => setPanel({ kind: 'category', category: null }),
                }
              : undefined
          }
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <Flex vertical gap="middle">
              {items.map((category, index) => (
                <CategoryCard
                  key={category.id}
                  category={category}
                  event={event}
                  editable={editable}
                  canContesters={draft && canContesters}
                  canOpenClose={event.status === 'open' && hasPermission(me, 'event.close')}
                  reorderable={editable && items.length > 1}
                  showArrows={!screens.md}
                  isFirst={index === 0}
                  isLast={index === items.length - 1}
                  onAction={(action) => onAction(category, action)}
                  onMove={(direction) => save(arrayMove(ids, index, index + direction))}
                  onContester={(c) => setContester({ categoryId: category.id, contester: c })}
                  onSetOpen={(open) => onSetOpen(category, open)}
                />
              ))}
            </Flex>
          </SortableContext>
        </DndContext>
      )}

      <CategoryDrawer
        event={event}
        open={panel?.kind === 'category'}
        category={panel?.kind === 'category' ? latest(panel.category) : null}
        readOnly={!editable}
        onClose={() => setPanel(null)}
      />
      <RulesDrawer
        eventId={event.id}
        category={panel?.kind === 'rules' ? latest(panel.category) : null}
        readOnly={!editable}
        onClose={() => setPanel(null)}
      />
      <EligibilityDrawer
        eventId={event.id}
        category={panel?.kind === 'voters' ? latest(panel.category) : null}
        readOnly={!editable}
        onClose={() => setPanel(null)}
      />
      <ContesterDrawer
        event={event}
        target={contesterTarget}
        canManage={canContesters}
        onClose={() => setContester(null)}
      />
      <PhotoZipDialog eventId={event.id} open={zipOpen} onClose={() => setZipOpen(false)} />
      {confirm && (
        <ConfirmDialog
          open
          tone="danger"
          title={t(confirm.kind === 'delete' ? 'categories.deleteTitle' : 'categories.closeTitle', {
            name: confirm.category.name,
          })}
          body={t(confirm.kind === 'delete' ? 'categories.deleteBody' : 'categories.closeBody')}
          confirmLabel={t(
            confirm.kind === 'delete' ? 'categories.delete' : 'categories.closeCategory',
          )}
          loading={remove.isPending || setOpen.isPending}
          onConfirm={confirmed}
          onCancel={() => setConfirm(null)}
        />
      )}
    </Flex>
  );
}
