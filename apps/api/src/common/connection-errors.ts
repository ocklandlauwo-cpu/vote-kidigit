/**
 * Describes a connection URL for error messages without its password,
 * e.g. "127.0.0.1:5433/vote_kidigit as vk_api".
 */
export function describeConnection(url: string): string {
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, '');
    const target = `${parsed.hostname}:${parsed.port || 'default port'}${database ? `/${database}` : ''}`;
    return parsed.username ? `${target} as ${decodeURIComponent(parsed.username)}` : target;
  } catch {
    return '(unparseable URL)';
  }
}

/** One-line reason for an error, for startup and log messages. */
export function errorReason(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) {
    return error.errors.map(errorReason).join('; ');
  }
  // Duck-typed: errors from another realm (Node internals under Jest's VM) fail instanceof Error.
  const { message, name } = (error ?? {}) as { message?: unknown; name?: unknown };
  const text =
    typeof message === 'string' && message ? message : typeof name === 'string' ? name : '';
  return (text || String(error)).replace(/\s+/g, ' ').trim();
}

interface DriverAdapterCause {
  originalMessage?: unknown;
  kind?: unknown;
  host?: unknown;
  port?: unknown;
}

/**
 * Reason for a Prisma error raised by the PostgreSQL driver adapter. Prisma wraps the driver
 * error in a multi-line "Invalid prisma.$queryRaw() invocation" message; the useful part is
 * in meta.driverAdapterError.cause.
 */
export function prismaErrorReason(error: unknown): string {
  const meta = (error as { meta?: { driverAdapterError?: { cause?: DriverAdapterCause } } })?.meta;
  const cause = meta?.driverAdapterError?.cause;
  if (typeof cause?.originalMessage === 'string') return cause.originalMessage;
  if (cause?.kind === 'DatabaseNotReachable') return 'database server not reachable';
  if (typeof cause?.kind === 'string') return cause.kind;
  return errorReason(error);
}
