// DSH-01 to DSH-04 Dashboard (App Flow 5.1, 5.2): the cards of the user's dashboard, each loading
// and failing on its own. Organization admins also see the setup checklist (App Flow 7.4). Right
// after sign-in a moderator mapped to exactly one active event lands in that event instead.
import { PlusOutlined } from '@ant-design/icons';
import { ACTIVE_EVENT_STATUSES, dashboardKind, type PermissionKey } from '@vote-kidigit/shared';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { hasPermission, useMe } from '../auth/useAuth';
import { EmptyState } from '../components/EmptyState';
import { OnboardingChecklist } from '../components/OnboardingChecklist';
import { PageHeader } from '../components/PageHeader';
import {
  ActivityCard,
  EventsCard,
  EventStaffCard,
  MyEventsCard,
  OrganizationsCard,
  TiesCard,
  TurnoutCard,
} from './dashboard/DashboardCards';
import { useDashboardEvents, useDashboardMyEvents } from './dashboard/dashboardApi';
import { useOrganization, useUpdateOrganization } from './settings/organizationApi';

export function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const me = useMe().data;
  const kind = me ? dashboardKind(me) : 'observer';
  const platform = kind === 'platform';
  const may = (permission: PermissionKey) => platform || hasPermission(me, permission);
  const manages = hasPermission(me, 'org.settings.manage');
  const org = useOrganization(manages);
  const update = useUpdateOrganization();
  const events = useDashboardEvents(kind === 'organization');
  const mine = useDashboardMyEvents(kind === 'moderator' || kind === 'observer');
  const landing = (location.state as { landing?: boolean } | null)?.landing === true;

  // App Flow 5.1: a moderator with exactly one active event goes straight to it after sign-in.
  if (landing && kind === 'moderator' && mine.data) {
    const active = mine.data.filter((e) =>
      (ACTIVE_EVENT_STATUSES as readonly string[]).includes(e.status),
    );
    if (active.length === 1 && active[0]) {
      return <Navigate to={`/events/${active[0].eventId}`} replace />;
    }
  }

  const canCreate = !platform && hasPermission(me, 'event.create');
  const create = () => void navigate('/events?create=1');
  const createButton = canCreate ? (
    <Button type="primary" icon={<PlusOutlined />} onClick={create}>
      {t('events.create')}
    </Button>
  ) : null;
  const createLink = canCreate ? (
    <Button size="small" type="link" onClick={create}>
      {t('events.create')}
    </Button>
  ) : null;
  const noEvents =
    kind === 'organization' &&
    events.data !== undefined &&
    Object.values(events.data.byStatus).every((n) => n === 0);

  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        meta={[me ? t('dashboard.welcome', { name: me.fullName }) : null, me?.organization?.name]}
        actions={kind === 'organization' || kind === 'moderator' ? createButton : undefined}
      />
      {manages && org.data && (
        <OnboardingChecklist
          settings={org.data}
          canDismiss
          dismissing={update.isPending}
          onDismiss={() => update.mutate({ onboardingDismissed: true })}
        />
      )}
      {noEvents && (
        <EmptyState
          kind="events"
          title={t('dashboard.noEvents')}
          action={canCreate ? { label: t('events.create'), onClick: create } : undefined}
        />
      )}
      <div className="vk-dashboard-grid">
        {(kind === 'moderator' || kind === 'observer') && (
          <div className="vk-dashboard-wide">
            <MyEventsCard
              empty={
                <>
                  {t('dashboard.notAssigned')} {kind === 'moderator' ? createLink : null}
                </>
              }
            />
          </div>
        )}
        <EventsCard createAction={createLink} links={!platform} />
        {may('turnout.view') && <TurnoutCard links={!platform} />}
        {may('results.view') && (
          <TiesCard mayResolve={!platform && hasPermission(me, 'results.resolve_tie')} />
        )}
        {(platform || may(kind === 'organization' ? 'audit.view.org' : 'audit.view.event')) && (
          <ActivityCard />
        )}
        {kind === 'organization' && (
          <div className="vk-dashboard-wide">
            <EventStaffCard />
          </div>
        )}
        {platform && (
          <div className="vk-dashboard-wide">
            <OrganizationsCard
              createAction={
                <Button size="small" type="link" onClick={() => void navigate('/platform/orgs')}>
                  {t('dashboard.createOrg')}
                </Button>
              }
            />
          </div>
        )}
      </div>
    </>
  );
}
