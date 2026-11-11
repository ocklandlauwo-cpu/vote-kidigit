import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { VoteModule } from '../vote/vote.module.js';
import { KioskDeviceService } from './kiosk-device.service.js';
import { KioskTokenGuard } from './kiosk-token.guard.js';
import { KioskController, KioskDeviceController } from './kiosk.controller.js';
import { KioskService } from './kiosk.service.js';

/** Kiosk mode (Backend Schema 12.9, App Flow 10): staff sessions and the device API. */
@Module({
  imports: [AuthModule, MessagesModule, VoteModule],
  controllers: [KioskController, KioskDeviceController],
  providers: [KioskService, KioskDeviceService, KioskTokenGuard],
  exports: [KioskService],
})
export class KioskModule {}
