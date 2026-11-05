import { scrubSentryEvent, scrubUrl } from './sentry-scrub.js';

const token = 'q3T9xZ0bR1mK8vN2pL5sW7yA4cE6gH0jU3iO9fD2kM1';

describe('Sentry scrubbing', () => {
  it('removes link tokens and query strings from URLs, keeping the origin', () => {
    expect(
      scrubUrl(`https://uchaguzi.example-organization.tz/api/v1/auth/tokens/${token}?a=1`),
    ).toBe('https://uchaguzi.example-organization.tz/api/v1/auth/tokens/[redacted]');
    expect(scrubUrl(`GET /app/reset/${token}`)).not.toContain(token);
  });

  it('scrubs the request, transaction and breadcrumbs', () => {
    const event = scrubSentryEvent({
      type: undefined,
      transaction: `GET /api/v1/auth/tokens/${token}`,
      request: {
        url: `http://localhost:3000/api/v1/auth/tokens/${token}`,
        data: { password: 'Siri2027Kabisa' },
        cookies: { 'vk.sid': 's:abc' },
        query_string: 'x=1',
        headers: { cookie: 'vk.sid=s:abc', 'user-agent': 'jest' },
      },
      breadcrumbs: [{ data: { url: `http://localhost/app/invite/${token}` } }],
    });
    expect(JSON.stringify(event)).not.toContain(token);
    expect(JSON.stringify(event)).not.toContain('Siri2027Kabisa');
    expect(event.request?.headers).toEqual({ 'user-agent': 'jest' });
    expect(event.request?.cookies).toBeUndefined();
  });
});
