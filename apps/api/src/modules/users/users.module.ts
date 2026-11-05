import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/** Staff accounts of an organization (USR-01 to USR-03). */
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
