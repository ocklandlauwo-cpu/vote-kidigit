// USSD menu engine (App Flow 9, Backend Schema 8.5, PRD VOT-04, VOT-05): a state machine over
// VTR-USSD-01 to -10 with the state in Redis (ussd:{sessionId}, 180 s, the operator's session).
// It drives the same voter service as the web and kiosk (sign-in with its lockouts, identity,
// ballot, app.cast_ballot with channel ussd), so the rules are checked in one place. Nothing is
// saved until the voter confirms the review; a dropped session saves nothing. The voting code is
// never stored: if a membership ID matches several events, the voter picks one and types the
// code again.
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BallotCategory, SubmitBallotRequest } from '@vote-kidigit/shared';
import { AppError } from '../../common/app-error.js';
import type { Env } from '../../config/env.schema.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService } from '../../database/prisma.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { ResultsService } from '../results/results.service.js';
import { BallotAuthorizer } from '../vote/ballot-authorizer.js';
import { VoteService } from '../vote/vote.service.js';
import {
  alreadyVotedScreen,
  cancelledScreen,
  categoryScreen,
  chooseEventScreen,
  closedScreen,
  codeScreen,
  contesterLabel,
  cut,
  helpScreen,
  identityScreen,
  invalidScreen,
  lockedScreen,
  maxChoices,
  membershipScreen,
  menuScreen,
  minChoices,
  MORE,
  noResultsScreen,
  notMeScreen,
  notOpenScreen,
  pageLines,
  parseChoices,
  receivedScreen,
  REVIEW_FOOTER,
  type Screen,
  screen,
  sessionEndedScreen,
  SKIP,
  unavailableScreen,
} from './ussd-screens.js';

export const USSD_PREFIX = 'ussd:';
const USSD_TTL_SECONDS = 180;
const DEFAULT_TIME_ZONE = 'Africa/Dar_es_Salaam';

type Choice =
  { kind: 'contesters'; ids: string[] } | { kind: 'yes' } | { kind: 'no' } | { kind: 'skipped' };

interface UssdState {
  step:
    'menu' | 'membership' | 'code' | 'chooseEvent' | 'identity' | 'category' | 'review' | 'results';
  mode: 'vote' | 'results';
  membershipId?: string;
  eventId?: string;
  events?: { id: string; name: string; organizationName: string }[];
  token?: string;
  timeZone?: string;
  categories?: BallotCategory[];
  index?: number;
  /** First contester of the page on screen. */
  start?: number;
  choices?: Record<string, Choice>;
  pages?: string[];
  page?: number;
}

/** One callback, as an adapter normalized it. */
export interface UssdTurn {
  sessionId: string;
  phoneNumber: string;
  /** What the caller typed on this screen; null when the session starts. */
  input: string | null;
}

@Injectable()
export class UssdEngine {
  private readonly logger = new Logger(UssdEngine.name);
  private readonly shortCodeFallback: string;

  constructor(
    private readonly redis: RedisService,
    private readonly vote: VoteService,
    private readonly results: ResultsService,
    private readonly authorizer: BallotAuthorizer,
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
    config: ConfigService<Env, true>,
  ) {
    this.shortCodeFallback = config.get('USSD_SHORT_CODE', { infer: true });
  }

  /** Answers one callback with the next screen. */
  async handle(turn: UssdTurn): Promise<Screen> {
    const key = `${USSD_PREFIX}${turn.sessionId}`;
    const stored = turn.input === null ? null : await this.redis.get(key);
    const state: UssdState = stored
      ? (JSON.parse(stored) as UssdState)
      : { step: 'menu', mode: 'vote' };
    let reply: Screen;
    try {
      reply = stored ? await this.step(state, turn) : menuScreen();
    } catch (error) {
      reply = this.failure(error, state);
    }
    if (reply.end) {
      await this.redis.del(key);
      if (state.token) await this.vote.finish(state.token).catch(() => undefined);
    } else {
      await this.redis.set(key, JSON.stringify(state), 'EX', USSD_TTL_SECONDS);
    }
    return reply;
  }

  /** Ends a session the operator closed (hang-up, timeout): nothing is saved. */
  async drop(sessionId: string): Promise<void> {
    const key = `${USSD_PREFIX}${sessionId}`;
    const stored = await this.redis.get(key);
    await this.redis.del(key);
    const token = stored ? (JSON.parse(stored) as UssdState).token : undefined;
    if (token) await this.vote.finish(token).catch(() => undefined);
  }

  private async step(state: UssdState, turn: UssdTurn): Promise<Screen> {
    const input = (turn.input ?? '').trim();
    switch (state.step) {
      case 'menu':
        if (input === '1' || input === '2') {
          state.mode = input === '1' ? 'vote' : 'results';
          state.step = 'membership';
          return membershipScreen();
        }
        if (input === '3') return helpScreen(await this.supportPhone());
        return menuScreen();

      case 'membership':
        if (!input) return membershipScreen(true);
        state.membershipId = input;
        state.step = 'code';
        return codeScreen();

      case 'code':
        return this.signIn(state, turn, input);

      case 'chooseEvent': {
        const chosen = state.events?.[Number(input) - 1];
        if (!chosen || !/^\d+$/.test(input)) return chooseEventScreen(state.events ?? []);
        state.eventId = chosen.id;
        state.events = undefined;
        state.step = 'code';
        return codeScreen();
      }

      case 'identity':
        if (input === '1') return this.confirmIdentity(state);
        if (input === '2') {
          const session = await this.authorizer.authorize(state.token);
          const { contactPhone } = await this.vote.notMe(state.token ?? '', session);
          state.token = undefined; // ended by notMe
          return notMeScreen(contactPhone);
        }
        return this.identity(state);

      case 'category':
        return this.categoryInput(state, input);

      case 'review':
        return this.reviewInput(state, input);

      case 'results': {
        const pages = state.pages ?? [];
        const page = state.page ?? 0;
        if (input === MORE && page + 1 < pages.length) {
          state.page = page + 1;
          return screen(pages[page + 1] ?? '', page + 2 >= pages.length);
        }
        return screen(pages[page] ?? '', page + 1 >= pages.length);
      }
    }
  }

  // --- Sign-in ---------------------------------------------------------------------------------

  private async signIn(state: UssdState, turn: UssdTurn, code: string): Promise<Screen> {
    try {
      const signedIn = await this.vote.signIn(
        {
          membershipId: state.membershipId ?? '',
          code,
          ...(state.eventId && { eventId: state.eventId }),
        },
        // The caller's phone keys the failure counter, as an address does on the web.
        { ip: `ussd:${turn.phoneNumber}`, channel: 'ussd' },
      );
      state.token = signedIn.token;
      state.eventId = signedIn.event.id;
      state.timeZone = signedIn.event.timeZone;
      if (state.mode === 'results') return this.showResults(state);
      switch (signedIn.event.state) {
        case 'scheduled':
          return notOpenScreen(signedIn.event.startAt, signedIn.event.timeZone);
        case 'closed':
          return closedScreen();
        case 'cancelled':
          return cancelledScreen();
        default:
          state.step = 'identity';
          return identityScreen(
            signedIn.event.organizationName,
            signedIn.event.name,
            signedIn.voter.fullName,
          );
      }
    } catch (error) {
      if (error instanceof AppError && error.code === 'INVALID_CREDENTIALS') {
        const left = Number(error.details?.attemptsLeft ?? 0);
        return invalidScreen(left);
      }
      if (error instanceof AppError && error.code === 'VOTER_LOCKED') {
        return lockedScreen(String(error.details?.lockedUntil), DEFAULT_TIME_ZONE);
      }
      if (error instanceof AppError && error.code === 'CHOOSE_EVENT') {
        state.events = (error.details?.events ?? []) as UssdState['events'];
        state.step = 'chooseEvent';
        return chooseEventScreen(state.events ?? []);
      }
      throw error;
    }
  }

  private async identity(state: UssdState): Promise<Screen> {
    const session = await this.authorizer.authorize(state.token);
    const status = await this.vote.status(session);
    const voter = await this.prisma.withContext(this.requestContext.getOrThrow(), (tx) =>
      tx.voter.findUniqueOrThrow({ where: { id: session.voterId }, select: { fullName: true } }),
    );
    return identityScreen(status.event.organizationName, status.event.name, voter.fullName);
  }

  /** "1. Ndiyo, ni mimi": the ballot, or why there is none. */
  private async confirmIdentity(state: UssdState): Promise<Screen> {
    const session = await this.authorizer.authorize(state.token);
    await this.vote.confirmIdentity(state.token ?? '', session);
    const status = await this.vote.status(session);
    const timeZone = status.event.timeZone;
    if (!status.canVote) {
      if (status.votedAt)
        return alreadyVotedScreen(status.votedAt, timeZone, await this.shortCode());
      if (status.event.state === 'scheduled') return notOpenScreen(status.event.startAt, timeZone);
      if (status.event.state === 'cancelled') return cancelledScreen();
      if (status.event.state !== 'open') return closedScreen();
      return screen(
        status.categories.length === 0
          ? 'Hujapangiwa nafasi yoyote katika uchaguzi huu. Wasiliana na msimamizi.'
          : 'Hakuna nafasi iliyo wazi kwa sasa. Jaribu tena baadaye.',
        true,
      );
    }
    const ballot = await this.vote.ballot({ ...session, identityConfirmed: true });
    state.categories = ballot.categories;
    state.choices = {};
    state.index = 0;
    state.start = 0;
    state.step = 'category';
    return this.showCategory(state, false);
  }

  // --- Ballot ----------------------------------------------------------------------------------

  private showCategory(state: UssdState, retry: boolean): Screen {
    const categories = state.categories ?? [];
    const category = categories[state.index ?? 0];
    if (!category) return this.showReview(state);
    return categoryScreen(
      category,
      { index: (state.index ?? 0) + 1, total: categories.length },
      state.start ?? 0,
      retry,
    ).screen;
  }

  private categoryInput(state: UssdState, input: string): Screen {
    const category = state.categories?.[state.index ?? 0];
    if (!category) return this.showReview(state);
    let choice: Choice | null = null;
    if (input === SKIP && category.rules.allowSkip) choice = { kind: 'skipped' };
    else if (category.rules.yesNo) {
      if (input === '1') choice = { kind: 'yes' };
      if (input === '2') choice = { kind: 'no' };
    } else if (input === MORE) {
      const { next } = categoryScreen(category, { index: 1, total: 1 }, state.start ?? 0, false);
      state.start = next < category.contesters.length ? next : 0; // after the last page, the first
      return this.showCategory(state, false);
    } else {
      const numbers = parseChoices(input, category.contesters.length);
      if (
        numbers &&
        numbers.length >= minChoices(category) &&
        numbers.length <= maxChoices(category)
      ) {
        choice = {
          kind: 'contesters',
          ids: numbers.map((n) => category.contesters[n - 1]?.id ?? ''),
        };
      }
    }
    if (!choice) return this.showCategory(state, true);
    state.choices = { ...state.choices, [category.id]: choice };
    state.index = (state.index ?? 0) + 1;
    state.start = 0;
    return this.showCategory(state, false);
  }

  private showReview(state: UssdState): Screen {
    const lines = (state.categories ?? []).map((category) => {
      const choice = state.choices?.[category.id];
      const names =
        choice?.kind === 'contesters'
          ? choice.ids
              .map((id) => category.contesters.find((c) => c.id === id))
              .map((c) => (c ? contesterLabel(c) : ''))
              .join(', ')
          : choice?.kind === 'yes'
            ? 'Ndiyo'
            : choice?.kind === 'no'
              ? 'Hapana'
              : 'Umeruka';
      return `${cut(category.name, 30)}: ${names}`;
    });
    state.pages = pageLines('Hakiki:', lines, REVIEW_FOOTER);
    state.page = 0;
    state.step = 'review';
    return screen(state.pages[0] ?? '');
  }

  private async reviewInput(state: UssdState, input: string): Promise<Screen> {
    const pages = state.pages ?? [];
    const page = state.page ?? 0;
    const last = page + 1 >= pages.length;
    if (input === MORE && !last) {
      state.page = page + 1;
      return screen(pages[page + 1] ?? '');
    }
    if (input === '2' && last) {
      state.choices = {};
      state.index = 0;
      state.start = 0;
      state.step = 'category';
      return this.showCategory(state, false);
    }
    if (input !== '1' || !last) return screen(pages[page] ?? '');

    const session = await this.authorizer.authorize(state.token);
    const body: SubmitBallotRequest = {
      selections: (state.categories ?? []).map((category) => {
        const choice = state.choices?.[category.id] ?? { kind: 'skipped' as const };
        if (choice.kind === 'contesters') {
          return {
            categoryId: category.id,
            choice: 'contester' as const,
            contesterIds: choice.ids,
          };
        }
        if (choice.kind === 'skipped') {
          return { categoryId: category.id, choice: 'skipped' as const, contesterIds: [] };
        }
        return {
          categoryId: category.id,
          choice: choice.kind,
          contesterIds: category.contesters.slice(0, 1).map((c) => c.id),
        };
      }),
    };
    const result = await this.vote.submit(state.token ?? '', session, body);
    state.token = undefined; // submit ends the ballot session
    const timeZone = state.timeZone ?? DEFAULT_TIME_ZONE;
    if (result.recorded.length === 0) {
      return screen('Kura yako haikuhesabiwa: nafasi zimefungwa au umeshapiga kura.', true);
    }
    return receivedScreen(result.votedAt, timeZone);
  }

  // --- Results (VTR-USSD-09) and help ----------------------------------------------------------

  private async showResults(state: UssdState): Promise<Screen> {
    const session = await this.authorizer.authorize(state.token);
    let results;
    try {
      results = await this.results.voterResults(session.eventId, session.voterId);
    } catch (error) {
      if (error instanceof AppError && error.code === 'NOT_FOUND') return noResultsScreen();
      throw error;
    }
    const lines = results.categories.map((category) => {
      const winners = category.rows.filter((row) => row.isWinner);
      const text =
        winners.length === 0
          ? 'Hakuna mshindi'
          : winners
              .map((row) => {
                const name =
                  row.choice === 'contester'
                    ? cut(row.name, 20)
                    : row.choice === 'yes'
                      ? 'Ndiyo'
                      : 'Hapana';
                return row.votes === null ? name : `${name} (${row.votes})`;
              })
              .join(', ');
      return `${cut(category.name, 30)}: ${text}`;
    });
    state.pages = pageLines('Matokeo:', lines, []);
    state.page = 0;
    state.step = 'results';
    return screen(state.pages[0] ?? '', state.pages.length === 1);
  }

  private async platform() {
    return this.prisma.withContext(this.requestContext.getOrThrow(), (tx) =>
      tx.platformSetting.findFirst({ select: { supportPhone: true, ussdShortCode: true } }),
    );
  }

  private async supportPhone(): Promise<string | null> {
    return (await this.platform())?.supportPhone ?? null;
  }

  private async shortCode(): Promise<string> {
    return (await this.platform())?.ussdShortCode ?? this.shortCodeFallback;
  }

  /** Errors never reach the caller as technical text (App Flow 13.1). */
  private failure(error: unknown, state: UssdState): Screen {
    if (error instanceof AppError) {
      if (error.code === 'UNAUTHENTICATED') return sessionEndedScreen();
      if (error.code === 'VOTING_CLOSED') {
        return screen('Upigaji kura umefungwa. Kura yako haikuhesabiwa.', true);
      }
      if (error.code === 'NOT_FOUND') return closedScreen();
    }
    this.logger.error({ message: 'USSD step failed', step: state.step, error });
    return unavailableScreen();
  }
}
