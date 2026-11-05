// Page header (Design System 8.4): h1 + status badge, a meta line joined with " · ", and the
// page actions (secondary first, primary last). Below md the actions move under the title and
// the primary one is full width; a "← Back" link replaces the breadcrumbs when `back` is given.
import { ArrowLeftOutlined } from '@ant-design/icons';
import { Button, Grid, Typography } from 'antd';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

export interface PageHeaderProps {
  title: string;
  /** A StatusBadge. */
  status?: ReactNode;
  meta?: ReactNode[];
  actions?: ReactNode;
  /** Parent page for the "← Back" link (shown below md, where breadcrumbs are hidden). */
  back?: { to: string; label: string };
}

export function PageHeader({ title, status, meta, actions, back }: PageHeaderProps) {
  const screens = Grid.useBreakpoint();
  const items = (meta ?? []).filter((item) => item !== null && item !== undefined && item !== '');
  return (
    <header className="vk-page-header">
      <div>
        {back && !screens.md && (
          <Link to={back.to}>
            <Button type="text" size="small" icon={<ArrowLeftOutlined />}>
              {back.label}
            </Button>
          </Link>
        )}
        <div className="vk-page-header__title-row">
          <Typography.Title level={1} className="vk-page-header__title">
            {title}
          </Typography.Title>
          {status}
        </div>
        {items.length > 0 && (
          <div className="vk-page-header__meta">
            {items.map((item, index) => (
              <span key={index}>
                {index > 0 && ' · '}
                {item}
              </span>
            ))}
          </div>
        )}
      </div>
      {actions && <div className="vk-page-header__actions">{actions}</div>}
    </header>
  );
}
