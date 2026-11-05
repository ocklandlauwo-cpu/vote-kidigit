// Breadcrumbs (App Flow 3.5, Design System 8.3) from the `crumb` handle of each matched route:
// every part a link except the last; more than 4 levels collapse the middle into "…".
import { RightOutlined } from '@ant-design/icons';
import { Breadcrumb } from 'antd';
import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link, type UIMatch, useMatches } from 'react-router';

export interface RouteHandle {
  /** i18n key, or a function of the route data for dynamic names (event names). */
  crumb?: ParseKeys | ((match: UIMatch) => string);
}

export function Breadcrumbs() {
  const { t } = useTranslation();
  const matches = useMatches();
  const crumbs = matches.flatMap((match) => {
    const handle = match.handle as RouteHandle | undefined;
    if (!handle?.crumb) return [];
    const label = typeof handle.crumb === 'function' ? handle.crumb(match) : t(handle.crumb);
    return [{ path: match.pathname, label }];
  });
  if (crumbs.length === 0) return null;

  const items = crumbs.map((crumb, index) => ({
    key: crumb.path,
    title:
      index === crumbs.length - 1 ? (
        <span aria-current="page">{crumb.label}</span>
      ) : (
        <Link to={crumb.path}>{crumb.label}</Link>
      ),
  }));
  const collapsed =
    items.length > 4
      ? [
          items[0],
          {
            key: '…',
            title: '…',
            menu: {
              items: items.slice(1, -2).map((item) => ({ key: item.key, label: item.title })),
            },
          },
          ...items.slice(-2),
        ]
      : items;

  return (
    <nav aria-label={t('nav.breadcrumb')}>
      <Breadcrumb
        separator={<RightOutlined aria-hidden />}
        items={collapsed.filter((i) => i !== undefined)}
      />
    </nav>
  );
}
