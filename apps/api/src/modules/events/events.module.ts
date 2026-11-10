import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { AssignmentsService } from './assignments.service.js';
import { EventsController } from './events.controller.js';
import { EventsService } from './events.service.js';
import { LifecycleService } from './lifecycle.service.js';

/** Events and the staff mapped to them (EVT-01 to EVT-03, EVT-09, App Flow 7.2). */
@Module({
  imports: [AuthModule, MessagesModule],
  controllers: [EventsController],
  providers: [EventsService, AssignmentsService, LifecycleService],
  exports: [AssignmentsService],
})
export class EventsModule {}
