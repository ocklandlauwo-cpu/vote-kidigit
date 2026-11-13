import { Controller, Get, Module } from '@nestjs/common';
import type {
  AuditEntry,
  DashboardEvents,
  DashboardEventStaff,
  DashboardMyEvents,
  DashboardOrganizations,
  DashboardTies,
  DashboardTurnout,
} from '@vote-kidigit/shared';
import { AuthModule } from '../../auth/auth.module.js';
import type { AuthState } from '../../auth/auth.types.js';
import { CurrentAuth, SignedIn } from '../../auth/decorators.js';
import { DashboardService } from './dashboard.service.js';

/**
 * Dashboard cards (App Flow 5.2), one route each so they load and fail independently. Every
 * signed-in user may ask; each card checks the permission it needs (403 otherwise).
 */
@Controller('v1/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** GET /api/v1/dashboard/events */
  @Get('events')
  @SignedIn()
  events(@CurrentAuth() auth: AuthState): Promise<DashboardEvents> {
    return this.dashboard.events(auth);
  }

  /** GET /api/v1/dashboard/turnout */
  @Get('turnout')
  @SignedIn()
  turnout(@CurrentAuth() auth: AuthState): Promise<DashboardTurnout> {
    return this.dashboard.turnout(auth);
  }

  /** GET /api/v1/dashboard/ties */
  @Get('ties')
  @SignedIn()
  ties(@CurrentAuth() auth: AuthState): Promise<DashboardTies> {
    return this.dashboard.ties(auth);
  }

  /** GET /api/v1/dashboard/activity */
  @Get('activity')
  @SignedIn()
  activity(@CurrentAuth() auth: AuthState): Promise<AuditEntry[]> {
    return this.dashboard.activity(auth);
  }

  /** GET /api/v1/dashboard/event-staff */
  @Get('event-staff')
  @SignedIn()
  eventStaff(@CurrentAuth() auth: AuthState): Promise<DashboardEventStaff> {
    return this.dashboard.eventStaff(auth);
  }

  /** GET /api/v1/dashboard/my-events */
  @Get('my-events')
  @SignedIn()
  myEvents(@CurrentAuth() auth: AuthState): Promise<DashboardMyEvents> {
    return this.dashboard.myEvents(auth);
  }

  /** GET /api/v1/dashboard/organizations */
  @Get('organizations')
  @SignedIn()
  organizations(@CurrentAuth() auth: AuthState): Promise<DashboardOrganizations> {
    return this.dashboard.organizations(auth);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
