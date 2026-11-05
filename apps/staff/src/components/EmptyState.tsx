// Empty state (Design System 9.7): icon, title, description and at most one primary action,
// shown only when the user may take it. "No matches" adds a Clear filters button. Messages come
// from App Flow section 12.
import { CalendarOutlined, InboxOutlined, SearchOutlined, TeamOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import type { ReactNode } from 'react';

const ICONS = {
  list: InboxOutlined,
  noMatch: SearchOutlined,
  events: CalendarOutlined,
  users: TeamOutlined,
} as const;

export type EmptyStateKind = keyof typeof ICONS;

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
}

export interface EmptyStateProps {
  kind?: EmptyStateKind;
  title: string;
  description?: string;
  /** Primary button; omit it when the user lacks the permission. */
  action?: EmptyStateAction;
  /** For kind "noMatch": the Clear filters button. */
  onClearFilters?: () => void;
  clearFiltersLabel?: string;
}

export function EmptyState({
  kind = 'list',
  title,
  description,
  action,
  onClearFilters,
  clearFiltersLabel,
}: EmptyStateProps) {
  const Icon = ICONS[kind];
  const clear = kind === 'noMatch' && onClearFilters && clearFiltersLabel;
  return (
    <div className="vk-empty-state" data-kind={kind}>
      <Icon className="vk-empty-state__icon" aria-hidden />
      <h3 className="vk-empty-state__title">{title}</h3>
      {description && <p className="vk-empty-state__description">{description}</p>}
      {(action || clear) && (
        <div className="vk-empty-state__actions">
          {clear && (
            <Button type="text" onClick={onClearFilters}>
              {clearFiltersLabel}
            </Button>
          )}
          {action && (
            <Button type="primary" icon={action.icon} onClick={action.onClick}>
              {action.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
