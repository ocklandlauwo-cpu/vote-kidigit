import type { ErrorEvent } from '@sentry/nestjs';
import { maskVotingCodes, redact, redactPath } from './redaction.js';

/** A URL or path safe to report: origin kept, query dropped, token segments replaced. */
export function scrubUrl(url: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return redactPath(url);
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${redactPath(parsed.pathname)}`;
  } catch {
    return redactPath(url);
  }
}

/**
 * Sentry beforeSend (Tech Stack 11.2): no request bodies, cookies, query strings or credential
 * headers; link tokens (invitation, reset, kiosk, public results) removed from URLs,
 * transaction names and breadcrumbs; voting codes masked in messages.
 */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
    const userAgent = event.request.headers?.['user-agent'];
    event.request.headers = userAgent ? { 'user-agent': userAgent } : {};
  }
  if (event.transaction) event.transaction = scrubUrl(event.transaction);
  for (const crumb of event.breadcrumbs ?? []) {
    if (typeof crumb.data?.url === 'string') crumb.data.url = scrubUrl(crumb.data.url);
    if (crumb.message) crumb.message = maskVotingCodes(crumb.message);
  }
  if (event.message) event.message = maskVotingCodes(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = maskVotingCodes(exception.value);
  }
  if (event.extra) event.extra = redact(event.extra) as Record<string, unknown>;
  return event;
}
