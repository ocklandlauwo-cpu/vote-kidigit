import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { VotersModule } from '../voters/voters.module.js';
import { BallotTokenGuard } from './ballot-token.guard.js';
import { VoteController } from './vote.controller.js';
import { VoteSessions } from './vote-session.js';
import { VoteService } from './vote.service.js';

/** Voter API (Backend Schema 12.11): sign-in, identity, status, ballot and submission. */
@Module({
  imports: [FilesModule, MessagesModule, VotersModule],
  controllers: [VoteController],
  providers: [VoteService, VoteSessions, BallotTokenGuard],
  exports: [VoteService, VoteSessions],
})
export class VoteModule {}
