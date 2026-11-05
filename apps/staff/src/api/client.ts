// Typed fetch for the staff portal (Tech Stack 11.4): JSON in and out, the session cookie, the
// CSRF header on state-changing requests, and the { code, message, details } error format
// (Backend Schema 12.1) turned into ApiError. Responses are validated with the shared Zod schema.
import {
  CSRF_HEADER,
  type ErrorCode,
  ErrorResponseSchema,
  SESSION_EXPIRES_HEADER,
} from '@vote-kidigit/shared';
import { session } from './session';

export type ApiErrorCode = ErrorCode | 'NETWORK';

export interface FieldIssue {
  path: string;
  code: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field issues of a VALIDATION_FAILED response, for form errors. */
  get issues(): FieldIssue[] {
    const issues = this.details?.issues;
    return Array.isArray(issues) ? (issues as FieldIssue[]) : [];
  }
}

export function isApiError(error: unknown, code?: ApiErrorCode): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

/** A shared Zod schema (only parse is needed, so the app does not depend on zod itself). */
interface Schema<T> {
  parse(value: unknown): T;
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  schema?: Schema<T>;
  signal?: AbortSignal;
}

const SAFE_METHODS = new Set(['GET', 'HEAD']);

/** Calls /api{path}, e.g. api('/v1/me', { schema: MeResponseSchema }). */
export async function api<T = void>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const csrf = session.get().csrfToken;
  if (!SAFE_METHODS.has(method) && csrf) headers[CSRF_HEADER] = csrf;

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK', 'No connection');
  }

  const expires = response.headers.get(SESSION_EXPIRES_HEADER);
  if (expires) session.setExpiresAt(expires);

  if (!response.ok) {
    const parsed = ErrorResponseSchema.safeParse(await response.json().catch(() => null));
    const error = parsed.success
      ? new ApiError(response.status, parsed.data.code, parsed.data.message, parsed.data.details)
      : new ApiError(response.status, 'INTERNAL', response.statusText);
    if (error.code === 'UNAUTHENTICATED') session.notifySignedOut();
    throw error;
  }
  if (response.status === 204 || response.status === 202) return undefined as T;
  const json: unknown = await response.json();
  return options.schema ? options.schema.parse(json) : (json as T);
}
