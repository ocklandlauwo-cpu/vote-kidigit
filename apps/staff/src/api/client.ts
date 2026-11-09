// Typed fetch for the staff portal (Tech Stack 11.4): JSON in and out, the session cookie, the
// CSRF header on state-changing requests, and the { code, message, details } error format
// (Backend Schema 12.1) turned into ApiError. Responses are validated with the shared Zod schema.
import {
  CSRF_HEADER,
  type ErrorCode,
  ErrorResponseSchema,
  SESSION_EXPIRES_HEADER,
  UPLOAD_FIELD,
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
    throw toApiError(response.status, response.statusText, await response.json().catch(() => null));
  }
  if (response.status === 204 || response.status === 202) return undefined as T;
  const json: unknown = await response.json();
  return options.schema ? options.schema.parse(json) : (json as T);
}

function toApiError(status: number, statusText: string, body: unknown): ApiError {
  const parsed = ErrorResponseSchema.safeParse(body);
  const error = parsed.success
    ? new ApiError(status, parsed.data.code, parsed.data.message, parsed.data.details)
    : new ApiError(status, 'INTERNAL', statusText);
  if (error.code === 'UNAUTHENTICATED') session.notifySignedOut();
  return error;
}

interface UploadOptions<T> {
  schema?: Schema<T>;
  /** Name sent with the file (the server keeps it as original_name). */
  filename?: string;
  /** 0–100 while the file is sent (Design System 7.6 progress bar). */
  onProgress?: (percent: number) => void;
}

/**
 * POSTs one file as multipart field "file" to /api{path}. XMLHttpRequest rather than fetch,
 * because only it reports upload progress; errors are the same ApiError as api().
 */
export function upload<T = void>(path: string, file: Blob, options: UploadOptions<T> = {}) {
  return new Promise<T>((resolve, reject) => {
    const form = new FormData();
    form.append(
      UPLOAD_FIELD,
      file,
      options.filename ?? (file instanceof File ? file.name : 'file'),
    );
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    const csrf = session.get().csrfToken;
    if (csrf) xhr.setRequestHeader(CSRF_HEADER, csrf);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        options.onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', 'No connection'));
    xhr.onload = () => {
      const expires = xhr.getResponseHeader(SESSION_EXPIRES_HEADER);
      if (expires) session.setExpiresAt(expires);
      const body = parseJson(xhr.responseText);
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(toApiError(xhr.status, xhr.statusText, body));
        return;
      }
      try {
        resolve(options.schema ? options.schema.parse(body) : (body as T));
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error('Invalid response'));
      }
    };
    xhr.send(form);
  });
}

function parseJson(text: string): unknown {
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}
