import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  type AuditPage,
  type ChecklistResponse,
  CreateEventRequestSchema,
  type EventAssignmentsResponse,
  type EventDetail,
  EventListQuerySchema,
  type EventPage,
  OrgAuditQuerySchema,
  ReplaceEventAssignmentsRequestSchema,
  UpdateEventRequestSchema,
} from '@vote-kidigit/shared';
import type { AuthState } from '../../auth/auth.types.js';
import { CurrentAuth, RequirePermission, SignedIn } from '../../auth/decorators.js';
import { IdParamPipe } from '../../common/id-param.pipe.js';
import { zodDto } from '../../common/zod-validation.pipe.js';
import { AssignmentsService } from './assignments.service.js';
import { EventsService } from './events.service.js';

class EventListQuery extends zodDto(EventListQuerySchema) {}
class CreateEventBody extends zodDto(CreateEventRequestSchema) {}
class UpdateEventBody extends zodDto(UpdateEventRequestSchema) {}
class ReplaceAssignmentsBody extends zodDto(ReplaceEventAssignmentsRequestSchema) {}
class EventAuditQuery extends zodDto(OrgAuditQuerySchema) {}

/**
 * Events (Backend Schema 12.5). Event-scoped permissions also need the event to be assigned to
 * the caller or event.access_all (PermissionGuard). Publishing, cancelling and archiving
 * arrive in step 20.
 */
@Controller('v1/events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly assignments: AssignmentsService,
  ) {}

  /** GET /api/v1/events — every signed-in staff user; filtered to their assigned events. */
  @Get()
  @SignedIn()
  list(@CurrentAuth() auth: AuthState, @Query() query: EventListQuery): Promise<EventPage> {
    return this.events.list(auth, query);
  }

  /** POST /api/v1/events */
  @Post()
  @RequirePermission('event.create')
  create(@CurrentAuth() auth: AuthState, @Body() body: CreateEventBody): Promise<EventDetail> {
    return this.events.create(auth, body);
  }

  /** GET /api/v1/events/:eventId */
  @Get(':eventId')
  @RequirePermission('event.view')
  detail(@Param('eventId', IdParamPipe) eventId: string): Promise<EventDetail> {
    return this.events.detail(eventId);
  }

  /** PATCH /api/v1/events/:eventId */
  @Patch(':eventId')
  @RequirePermission('event.edit')
  update(
    @Param('eventId', IdParamPipe) eventId: string,
    @Body() body: UpdateEventBody,
  ): Promise<EventDetail> {
    return this.events.update(eventId, body);
  }

  /** DELETE /api/v1/events/:eventId */
  @Delete(':eventId')
  @HttpCode(204)
  @RequirePermission('event.edit')
  remove(@Param('eventId', IdParamPipe) eventId: string): Promise<void> {
    return this.events.remove(eventId);
  }

  /** GET /api/v1/events/:eventId/checklist */
  @Get(':eventId/checklist')
  @RequirePermission('event.view')
  checklist(@Param('eventId', IdParamPipe) eventId: string): Promise<ChecklistResponse> {
    return this.events.checklist(eventId);
  }

  /** GET /api/v1/events/:eventId/assignments */
  @Get(':eventId/assignments')
  @RequirePermission('event.view')
  getAssignments(
    @Param('eventId', IdParamPipe) eventId: string,
  ): Promise<EventAssignmentsResponse> {
    return this.assignments.forEvent(eventId);
  }

  /** PUT /api/v1/events/:eventId/assignments */
  @Put(':eventId/assignments')
  @RequirePermission('assignments.manage')
  replaceAssignments(
    @CurrentAuth() auth: AuthState,
    @Param('eventId', IdParamPipe) eventId: string,
    @Body() body: ReplaceAssignmentsBody,
  ): Promise<EventAssignmentsResponse> {
    return this.assignments.replaceForEvent(auth, eventId, body);
  }

  /** POST /api/v1/events/:eventId/activate */
  @Post(':eventId/activate')
  @HttpCode(200)
  @RequirePermission('event.activate')
  activate(@Param('eventId', IdParamPipe) eventId: string): Promise<EventDetail> {
    return this.events.setActive(eventId, true);
  }

  /** POST /api/v1/events/:eventId/deactivate */
  @Post(':eventId/deactivate')
  @HttpCode(200)
  @RequirePermission('event.activate')
  deactivate(@Param('eventId', IdParamPipe) eventId: string): Promise<EventDetail> {
    return this.events.setActive(eventId, false);
  }

  /** GET /api/v1/events/:eventId/audit — the Activity tab. */
  @Get(':eventId/audit')
  @RequirePermission('audit.view.event')
  audit(
    @Param('eventId', IdParamPipe) eventId: string,
    @Query() query: EventAuditQuery,
  ): Promise<AuditPage> {
    return this.events.auditLog(eventId, query);
  }
}
