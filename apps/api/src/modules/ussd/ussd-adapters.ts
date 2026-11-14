// USSD aggregator adapters (Backend Schema 8.5): each turns its aggregator's callback into a
// UssdTurn and the engine's screen into the reply the aggregator expects. The engine never sees
// an aggregator's format.
import type { UssdTurn } from './ussd-engine.js';
import type { Screen } from './ussd-screens.js';

export interface UssdReply {
  contentType: 'application/json' | 'text/plain';
  body: string | Record<string, unknown>;
}

export interface UssdAdapter {
  /** Path segment: POST /api/ussd/{name}/callback */
  readonly name: string;
  /** The turn, 'end' when the aggregator reports the session closed, or null if malformed. */
  parse(body: unknown): UssdTurn | { end: string } | null;
  reply(body: unknown, screen: Screen): UssdReply;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 200): string | null =>
  typeof value === 'string' && value.length <= max
    ? value
    : typeof value === 'number'
      ? String(value)
      : null;

/**
 * Beem Africa USSD Hub (docs.beem.africa/guides/ussd/callback): Beem POSTs JSON
 * { command: initiate | continue | terminate, msisdn, operator, session_id,
 *   payload: { request_id, response } } where response is what the caller typed on this step.
 * The reply echoes msisdn, operator and session_id, with command continue | terminate and
 * payload: { request_id, request } (request is the menu text).
 */
export const beemUssdAdapter: UssdAdapter = {
  name: 'beem',
  parse(body) {
    if (!isObject(body) || !isObject(body.payload)) return null;
    const sessionId = text(body.session_id, 100);
    const phoneNumber = text(body.msisdn, 20);
    const command = text(body.command, 20);
    if (!sessionId || !phoneNumber || !command) return null;
    if (command === 'terminate') return { end: sessionId };
    if (command === 'initiate') return { sessionId, phoneNumber, input: null };
    if (command !== 'continue') return null;
    return { sessionId, phoneNumber, input: text(body.payload.response, 160) ?? '' };
  },
  reply(body, screen) {
    const request = isObject(body) ? body : {};
    const payload = isObject(request.payload) ? request.payload : {};
    const step = Number(payload.request_id ?? 0);
    return {
      contentType: 'application/json',
      body: {
        msisdn: request.msisdn ?? null,
        operator: request.operator ?? null,
        session_id: request.session_id ?? null,
        command: screen.end ? 'terminate' : 'continue',
        payload: { request_id: Number.isFinite(step) ? step + 1 : 1, request: screen.text },
      },
    };
  },
};

/**
 * Generic adapter for tests and simulators, in the common form-post style: { sessionId,
 * phoneNumber, text } where text holds every answer so far joined by "*" (empty at the start);
 * the reply is plain text starting "CON " (more to come) or "END " (finished).
 */
export const genericUssdAdapter: UssdAdapter = {
  name: 'generic',
  parse(body) {
    if (!isObject(body)) return null;
    const sessionId = text(body.sessionId, 100);
    const phoneNumber = text(body.phoneNumber, 20);
    const all = text(body.text ?? '', 2000);
    if (!sessionId || !phoneNumber || all === null) return null;
    if (all === '') return { sessionId, phoneNumber, input: null };
    return { sessionId, phoneNumber, input: all.split('*').at(-1) ?? '' };
  },
  reply(_body, screen) {
    return { contentType: 'text/plain', body: `${screen.end ? 'END' : 'CON'} ${screen.text}` };
  },
};

export const USSD_ADAPTERS: Record<string, UssdAdapter> = {
  [beemUssdAdapter.name]: beemUssdAdapter,
  [genericUssdAdapter.name]: genericUssdAdapter,
};
