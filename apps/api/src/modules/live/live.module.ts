import { Controller, Get, Module, Param } from '@nestjs/common';
import type { Live } from '@vote-kidigit/shared';
import { AuthModule } from '../../auth/auth.module.js';
import type { AuthState } from '../../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../auth/decorators.js';
import { IdParamPipe } from '../../common/id-param.pipe.js';
import { CategoriesModule } from '../categories/categories.module.js';
import { KioskModule } from '../kiosk/kiosk.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { LiveService } from './live.service.js';

@Controller('v1/events/:eventId/live')
export class LiveController {
  constructor(private readonly live: LiveService) {}

  /** GET /api/v1/events/:eventId/live (CTL-01) */
  @Get()
  @RequirePermission('turnout.view')
  get(
    @CurrentAuth() auth: AuthState,
    @Param('eventId', IdParamPipe) eventId: string,
  ): Promise<Live> {
    return this.live.live(auth, eventId);
  }
}

/** Control room (App Flow 6.10, Backend Schema 12.5). */
@Module({
  imports: [AuthModule, CategoriesModule, MessagesModule, KioskModule],
  controllers: [LiveController],
  providers: [LiveService],
})
export class LiveModule {}
