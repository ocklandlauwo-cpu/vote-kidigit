import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module.js';
import { AuthController, MeController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthStateService } from './auth-state.service.js';
import { AuthService } from './auth.service.js';
import { CsrfGuard } from './csrf.guard.js';
import { SessionService } from './session.service.js';
import { SessionThrottlerGuard } from './session-throttler.guard.js';
import { TokensController } from './tokens.controller.js';
import { TokensService } from './tokens.service.js';
import { UserTokensService } from './user-tokens.service.js';

/** Staff authentication, invitations and password reset (Backend Schema 8.1, 8.2). Guards are registered globally by ApiModule. */
@Module({
  imports: [QueueModule],
  controllers: [AuthController, MeController, TokensController],
  providers: [
    AuthService,
    TokensService,
    UserTokensService,
    AuthStateService,
    SessionService,
    AuthGuard,
    CsrfGuard,
    SessionThrottlerGuard,
  ],
  exports: [
    TokensService,
    AuthStateService,
    SessionService,
    AuthGuard,
    CsrfGuard,
    SessionThrottlerGuard,
  ],
})
export class AuthModule {}
