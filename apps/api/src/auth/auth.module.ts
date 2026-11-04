import { Module } from '@nestjs/common';
import { AuthController, MeController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthStateService } from './auth-state.service.js';
import { AuthService } from './auth.service.js';
import { CsrfGuard } from './csrf.guard.js';
import { SessionService } from './session.service.js';
import { SessionThrottlerGuard } from './session-throttler.guard.js';

/** Staff authentication (Backend Schema 8.1). Guards are registered globally by ApiModule. */
@Module({
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    AuthStateService,
    SessionService,
    AuthGuard,
    CsrfGuard,
    SessionThrottlerGuard,
  ],
  exports: [AuthStateService, SessionService, AuthGuard, CsrfGuard, SessionThrottlerGuard],
})
export class AuthModule {}
