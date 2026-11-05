import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CreateRoleRequestSchema,
  DeleteRoleQuerySchema,
  type Role,
  type RoleListResponse,
  UpdateRoleRequestSchema,
} from '@vote-kidigit/shared';
import type { AuthState } from '../../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../auth/decorators.js';
import { IdParamPipe } from '../../common/id-param.pipe.js';
import { zodDto } from '../../common/zod-validation.pipe.js';
import { RolesService } from './roles.service.js';

class CreateRoleBody extends zodDto(CreateRoleRequestSchema) {}
class UpdateRoleBody extends zodDto(UpdateRoleRequestSchema) {}
class DeleteRoleQuery extends zodDto(DeleteRoleQuerySchema) {}

/** Roles and their permissions (Backend Schema 12.4, USR-04, USR-05). */
@Controller('v1/roles')
@RequirePermission('roles.manage')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** GET /api/v1/roles */
  @Get()
  list(): Promise<RoleListResponse> {
    return this.roles.list();
  }

  /** POST /api/v1/roles */
  @Post()
  create(@CurrentAuth() auth: AuthState, @Body() body: CreateRoleBody): Promise<Role> {
    return this.roles.create(auth, body);
  }

  /** GET /api/v1/roles/:roleId */
  @Get(':roleId')
  detail(@Param('roleId', IdParamPipe) roleId: string): Promise<Role> {
    return this.roles.detail(roleId);
  }

  /** PATCH /api/v1/roles/:roleId */
  @Patch(':roleId')
  update(
    @CurrentAuth() auth: AuthState,
    @Param('roleId', IdParamPipe) roleId: string,
    @Body() body: UpdateRoleBody,
  ): Promise<Role> {
    return this.roles.update(auth, roleId, body);
  }

  /** DELETE /api/v1/roles/:roleId?moveToRoleId= */
  @Delete(':roleId')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthState,
    @Param('roleId', IdParamPipe) roleId: string,
    @Query() query: DeleteRoleQuery,
  ): Promise<void> {
    return this.roles.remove(auth, roleId, query.moveToRoleId);
  }
}
