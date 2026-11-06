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
  type AssignableRoleListResponse,
  ReplaceUserAssignmentsRequestSchema,
  type UserAssignmentsResponse,
  InviteUserRequestSchema,
  type InviteUserResponse,
  UpdateUserRequestSchema,
  type UserDetail,
  UserListQuerySchema,
  type UserPage,
} from '@vote-kidigit/shared';
import type { AuthState } from '../../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../auth/decorators.js';
import { IdParamPipe } from '../../common/id-param.pipe.js';
import { zodDto } from '../../common/zod-validation.pipe.js';
import { AssignmentsService } from '../events/assignments.service.js';
import { UsersService } from './users.service.js';

class UserListQuery extends zodDto(UserListQuerySchema) {}
class InviteUserBody extends zodDto(InviteUserRequestSchema) {}
class UpdateUserBody extends zodDto(UpdateUserRequestSchema) {}
class ReplaceUserAssignmentsBody extends zodDto(ReplaceUserAssignmentsRequestSchema) {}

/** Staff accounts (Backend Schema 12.4). admins.manage is checked per user by the service. */
@Controller('v1/users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly assignments: AssignmentsService,
  ) {}

  /** GET /api/v1/users */
  @Get()
  @RequirePermission('staff.manage')
  list(@Query() query: UserListQuery): Promise<UserPage> {
    return this.users.list(query);
  }

  /** POST /api/v1/users */
  @Post()
  @RequirePermission('staff.manage')
  invite(
    @CurrentAuth() auth: AuthState,
    @Body() body: InviteUserBody,
  ): Promise<InviteUserResponse> {
    return this.users.invite(auth, body);
  }

  /** GET /api/v1/users/roles — declared before :userId so "roles" is not taken for an ID. */
  @Get('roles')
  @RequirePermission('staff.manage')
  roles(@CurrentAuth() auth: AuthState): Promise<AssignableRoleListResponse> {
    return this.users.assignableRoles(auth);
  }

  /** GET /api/v1/users/:userId */
  @Get(':userId')
  @RequirePermission('staff.manage')
  detail(@Param('userId', IdParamPipe) userId: string): Promise<UserDetail> {
    return this.users.detail(userId);
  }

  /** PATCH /api/v1/users/:userId */
  @Patch(':userId')
  @RequirePermission('staff.manage')
  update(
    @CurrentAuth() auth: AuthState,
    @Param('userId', IdParamPipe) userId: string,
    @Body() body: UpdateUserBody,
  ): Promise<UserDetail> {
    return this.users.update(auth, userId, body);
  }

  /** DELETE /api/v1/users/:userId */
  @Delete(':userId')
  @HttpCode(204)
  @RequirePermission('staff.manage')
  remove(
    @CurrentAuth() auth: AuthState,
    @Param('userId', IdParamPipe) userId: string,
  ): Promise<void> {
    return this.users.remove(auth, userId);
  }

  /** GET /api/v1/users/:userId/assignments — the events the user is mapped to (USR-03). */
  @Get(':userId/assignments')
  @RequirePermission('assignments.manage')
  getAssignments(@Param('userId', IdParamPipe) userId: string): Promise<UserAssignmentsResponse> {
    return this.assignments.forUser(userId);
  }

  /** PUT /api/v1/users/:userId/assignments — replaces the user's event mappings. */
  @Put(':userId/assignments')
  @RequirePermission('assignments.manage')
  replaceAssignments(
    @CurrentAuth() auth: AuthState,
    @Param('userId', IdParamPipe) userId: string,
    @Body() body: ReplaceUserAssignmentsBody,
  ): Promise<UserAssignmentsResponse> {
    return this.assignments.replaceForUser(auth, userId, body);
  }

  /** POST /api/v1/users/:userId/deactivate */
  @Post(':userId/deactivate')
  @HttpCode(200)
  @RequirePermission('staff.manage')
  deactivate(
    @CurrentAuth() auth: AuthState,
    @Param('userId', IdParamPipe) userId: string,
  ): Promise<UserDetail> {
    return this.users.deactivate(auth, userId);
  }

  /** POST /api/v1/users/:userId/reactivate */
  @Post(':userId/reactivate')
  @HttpCode(200)
  @RequirePermission('staff.manage')
  reactivate(
    @CurrentAuth() auth: AuthState,
    @Param('userId', IdParamPipe) userId: string,
  ): Promise<UserDetail> {
    return this.users.reactivate(auth, userId);
  }

  /** POST /api/v1/users/:userId/resend-invite */
  @Post(':userId/resend-invite')
  @HttpCode(200)
  @RequirePermission('staff.manage')
  resendInvite(
    @CurrentAuth() auth: AuthState,
    @Param('userId', IdParamPipe) userId: string,
  ): Promise<{ invitationSent: boolean }> {
    return this.users.resendInvite(auth, userId);
  }
}
