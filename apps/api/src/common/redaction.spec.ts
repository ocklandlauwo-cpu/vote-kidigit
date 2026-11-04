import { JsonLogger } from '../logging/json-logger.js';
import { RequestContextService, systemContext } from '../context/request-context.js';
import { maskVotingCodes, REDACTED, redact, redactPath } from './redaction.js';

describe('redaction', () => {
  it('masks voting codes with or without the dash, and leaves ordinary words alone', () => {
    expect(maskVotingCodes('code K7M4-Q9XR and K7M4Q9XR')).toBe(`code ${REDACTED} and ${REDACTED}`);
    expect(maskVotingCodes('VALIDATION_FAILED INTERNAL EVENT_LOCKED')).toBe(
      'VALIDATION_FAILED INTERNAL EVENT_LOCKED',
    );
    expect(maskVotingCodes('request 0b3c7e0a-9d1f-4c5e-8a2b-1f2e3d4c5b6a')).toContain('0b3c7e0a');
  });

  it('redacts sensitive keys at any depth and masks codes in strings', () => {
    expect(
      redact({
        name: 'Asha',
        password: 'p',
        nested: { tokenHash: 'h', codeHmac: 'x', note: 'use K7M4-Q9XR' },
        selections: [{ categoryId: 'c', contesterIds: ['a'] }],
        sessionTimeoutMinutes: 15,
      }),
    ).toEqual({
      name: 'Asha',
      password: REDACTED,
      nested: { tokenHash: REDACTED, codeHmac: REDACTED, note: `use ${REDACTED}` },
      selections: REDACTED,
      sessionTimeoutMinutes: 15,
    });
  });

  it('removes query strings and long opaque path segments but keeps UUIDs', () => {
    const uuid = '0b3c7e0a-9d1f-4c5e-8a2b-1f2e3d4c5b6a';
    expect(redactPath(`/api/v1/events/${uuid}/voters?q=Asha`)).toBe(
      `/api/v1/events/${uuid}/voters`,
    );
    expect(redactPath(`/api/v1/auth/tokens/${'a'.repeat(43)}`)).toBe(
      `/api/v1/auth/tokens/${REDACTED}`,
    );
  });
});

describe('JsonLogger', () => {
  it('writes one JSON line with level, context, message and the request id', () => {
    const lines: string[] = [];
    const logger = new JsonLogger('debug', (line) => lines.push(line));
    new RequestContextService().run(systemContext('req-123'), () => {
      logger.log({ msg: 'hello', password: 'p', code: 'K7M4-Q9XR' }, 'Probe');
      logger.error(new Error('failed for K7M4-Q9XR'), undefined, 'Probe');
    });
    const [info, error] = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(info).toMatchObject({
      level: 'info',
      context: 'Probe',
      requestId: 'req-123',
      msg: 'hello',
      password: REDACTED,
      code: REDACTED,
    });
    expect(error).toMatchObject({ level: 'error', msg: `failed for ${REDACTED}` });
    expect(lines.join('')).not.toContain('K7M4-Q9XR');
  });

  it('respects the level', () => {
    const lines: string[] = [];
    const logger = new JsonLogger('info', (line) => lines.push(line));
    logger.debug('hidden');
    logger.warn('shown');
    expect(lines).toHaveLength(1);
  });
});
