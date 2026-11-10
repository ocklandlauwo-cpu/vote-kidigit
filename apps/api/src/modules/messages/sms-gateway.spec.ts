// The Beem adapter against a stubbed fetch: the request it sends, and how each kind of answer
// becomes a sent message, a final refusal or a retry.
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';
import { BeemSmsAdapter, SmsSendError } from './sms-gateway.js';

const SETTINGS: Partial<Env> = {
  BEEM_BASE_URL: 'https://beem.example.test/',
  BEEM_API_KEY: 'key',
  BEEM_SECRET_KEY: 'secret',
};
const config = { get: (name: keyof Env) => SETTINGS[name] } as unknown as ConfigService<Env, true>;
const sms = { to: '+255758000001', text: 'Msimbo: K7M4-Q9XR', senderId: 'CHAMA', reference: 'm1' };

function answer(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

describe('BeemSmsAdapter', () => {
  const realFetch = globalThis.fetch;
  let fetchMock: jest.Mock<Promise<Response>, [string, RequestInit]>;

  beforeEach(() => {
    fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const failure = async (): Promise<SmsSendError> => {
    const error: unknown = await new BeemSmsAdapter(config).send(sms).catch((e: unknown) => e);
    if (!(error instanceof SmsSendError)) throw new Error('expected SmsSendError');
    return error;
  };

  it('posts one recipient with Basic auth and returns the request id', async () => {
    fetchMock.mockResolvedValue(
      answer(200, {
        successful: true,
        request_id: 12345,
        message: 'Message Submitted Successfully',
      }),
    );
    expect(await new BeemSmsAdapter(config).send(sms)).toEqual({ providerMessageId: '12345' });
    const [url, init] = fetchMock.mock.calls[0] ?? ['', {}];
    expect(url).toBe('https://beem.example.test/v1/send');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('key:secret').toString('base64')}`,
    );
    expect(JSON.parse(init.body as string)).toEqual({
      source_addr: 'CHAMA',
      schedule_time: '',
      encoding: 0,
      message: 'Msimbo: K7M4-Q9XR',
      recipients: [{ recipient_id: 1, dest_addr: '255758000001' }],
    });
  });

  it("keeps Beem's error code and message for a refusal, without retrying", async () => {
    fetchMock.mockResolvedValue(
      answer(400, {
        error_code: 'INVALID_SENDER_ID',
        message: 'Invalid Sender Id',
        status_code: 400,
      }),
    );
    const error = await failure();
    expect(error.message).toBe('400 INVALID_SENDER_ID Invalid Sender Id');
    expect(error.retryable).toBe(false);
  });

  it('keeps only the status when the body is not Beem JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>Forbidden</html>', { status: 403, statusText: 'Forbidden' }),
    );
    const error = await failure();
    expect(error.message).toBe('403 Forbidden');
    expect(error.retryable).toBe(false);
  });

  it('retries server errors, rate limits and network failures', async () => {
    fetchMock.mockResolvedValueOnce(answer(503, { message: 'Service Unavailable' }));
    expect((await failure()).retryable).toBe(true);
    fetchMock.mockResolvedValueOnce(answer(429, { message: 'Too many requests' }));
    expect((await failure()).retryable).toBe(true);
    fetchMock.mockRejectedValueOnce(new Error('The operation was aborted due to timeout'));
    const timeout = await failure();
    expect(timeout).toMatchObject({
      retryable: true,
      message: 'The operation was aborted due to timeout',
    });
    // The message text (with the code) never ends up in the error.
    expect(timeout.message).not.toContain('K7M4');
  });
});
