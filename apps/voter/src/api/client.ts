// The voter app's typed fetch (Tech Stack 7.2: no data-fetching library). Calls /api{path},
// sends the ballot token when given, validates responses with the shared Zod schemas and turns
// error bodies { code, message, details } into VoterApiError.
import type { z } from 'zod';

export class VoterApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'VoterApiError';
  }
}

export function isVoterApiError(error: unknown, code?: string): error is VoterApiError {
  return error instanceof VoterApiError && (code === undefined || error.code === code);
}

interface Options<T> {
  method?: 'GET' | 'POST';
  body?: unknown;
  token?: string | null;
  schema?: z.ZodType<T>;
}

export async function voterApi<T = void>(path: string, options: Options<T> = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'omit',
    });
  } catch {
    throw new VoterApiError(0, 'NETWORK', {});
  }
  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const body = (data ?? {}) as { code?: unknown; details?: unknown };
    throw new VoterApiError(
      response.status,
      typeof body.code === 'string' ? body.code : 'INTERNAL',
      typeof body.details === 'object' && body.details !== null
        ? (body.details as Record<string, unknown>)
        : {},
    );
  }
  return options.schema ? options.schema.parse(data) : (data as T);
}
