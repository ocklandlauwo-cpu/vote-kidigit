import type { LoggerService, LogLevel } from '@nestjs/common';
import { currentRequestContext } from '../context/request-context.js';
import { maskVotingCodes, redact } from '../common/redaction.js';

type Level = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'verbose';

const RANK: Record<Level, number> = { fatal: 0, error: 1, warn: 2, info: 3, debug: 4, verbose: 5 };

/**
 * Structured logging (Tech Stack 11.2): one JSON object per line on stdout, with the request ID
 * of the current request or job. Object messages are merged into the line after redaction;
 * string messages have voting codes masked. Request bodies are never passed to the logger.
 */
export class JsonLogger implements LoggerService {
  private maxRank: number;

  constructor(
    level: Level = process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    private readonly write: (line: string) => void = (line) => process.stdout.write(line),
  ) {
    this.maxRank = RANK[level];
  }

  setLogLevels(levels: LogLevel[]): void {
    const ranks = levels.map((l) => RANK[l === 'log' ? 'info' : l]);
    this.maxRank = Math.max(...ranks, 0);
  }

  log(message: unknown, ...params: unknown[]): void {
    this.emit('info', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    // Nest calls error(message, stack?, context?)
    this.emit('error', message, params, true);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.emit('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.emit('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.emit('verbose', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.emit('fatal', message, params, true);
  }

  private emit(level: Level, message: unknown, params: unknown[], withStack = false): void {
    if (RANK[level] > this.maxRank) return;

    const rest = [...params];
    const context = typeof rest.at(-1) === 'string' ? (rest.pop() as string) : undefined;
    const stack = withStack && typeof rest[0] === 'string' ? (rest.shift() as string) : undefined;

    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      ...(context ? { context } : {}),
      requestId: currentRequestContext()?.requestId,
    };
    if (message instanceof Error) {
      entry.msg = maskVotingCodes(message.message);
      entry.stack = message.stack ? maskVotingCodes(message.stack) : undefined;
    } else if (message !== null && typeof message === 'object') {
      Object.assign(entry, redact(message));
    } else {
      entry.msg = maskVotingCodes(String(message));
    }
    if (stack) entry.stack = maskVotingCodes(stack);
    if (rest.length > 0) entry.extra = redact(rest);

    this.write(`${JSON.stringify(entry)}\n`);
  }
}
