// Public website (step 38): the pages render through the real routes, the language switch
// changes only the public site, the menu works by keyboard, and both forms validate field by
// field, send, and show their success or failure in Swahili and English.
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n as voterI18n } from '../../i18n';
import { routes } from '../../router';
import { jsonResponse, stubFetch } from '../../test/vote';
import { today, validateForm } from './contactForm';
import { publicI18n, setPublicLanguage } from './publicText';

const LOAD = { timeout: 5000 };

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return { router, ...render(<RouterProvider router={router} />) };
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', () => undefined); // jsdom has no scrolling
  act(() => setPublicLanguage('sw'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('public pages', () => {
  it('renders PUB-01 with its actions: Request a demo, Sign in, Vote', async () => {
    renderAt('/');
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Uchaguzi wa siri, matokeo ya uhakika' },
        LOAD,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Omba onyesho' })[0]).toHaveAttribute(
      'href',
      '/demo',
    );
    expect(screen.getAllByRole('link', { name: 'Piga kura' })[0]).toHaveAttribute('href', '/vote');
    expect(screen.getAllByRole('link', { name: 'Ingia' })[0]).toHaveAttribute('href', '/app/');
    expect(screen.getByRole('img', { name: /Mfano wa karatasi ya kura/ })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(document.title).toBe('Vote-Kidigit — Uchaguzi wa kidijitali');
  });

  it.each([
    ['/features', 'Vipengele'],
    ['/pricing', 'Bei'],
    ['/contact', 'Wasiliana nasi'],
    ['/demo', 'Omba onyesho'],
  ])('renders %s', async (path, title) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { level: 1, name: title }, LOAD)).toBeInTheDocument();
  });

  it('shows "Contact us for pricing" on PUB-03', async () => {
    renderAt('/pricing');
    expect(
      await screen.findByRole('heading', { name: 'Wasiliana nasi upate bei' }, LOAD),
    ).toBeVisible();
  });

  it('switches the site to English without changing the voter screens', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await screen.findByRole('heading', { level: 1 }, LOAD);
    await user.click(screen.getAllByRole('button', { name: 'Badili lugha kuwa Kiingereza' })[0]!);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Secret ballots, results you can trust' }),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
    expect(publicI18n.language).toBe('en');
    expect(voterI18n.language).toBe('sw');
    expect(globalThis.localStorage.getItem('vk.publicLanguage')).toBe('en');
  });

  it('opens and closes the menu on small screens', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await screen.findByRole('heading', { level: 1 }, LOAD);
    const toggle = screen.getByRole('button', { name: 'Fungua menyu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Funga menyu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const menu = document.getElementById('site-menu')!;
    expect(within(menu).getByRole('link', { name: 'Bei' })).toHaveAttribute('href', '/pricing');
    await user.keyboard('{Escape}');
    expect(document.getElementById('site-menu')).toBeNull();
  });

  it('still loads the voter sign-in at /vote', async () => {
    renderAt('/vote');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ingia' }, LOAD),
    ).toBeInTheDocument();
  });
});

describe('demo form (PUB-05)', () => {
  it('marks every invalid field and focuses the first', async () => {
    const calls = stubFetch({});
    const user = userEvent.setup();
    renderAt('/demo');
    await screen.findByRole('heading', { level: 1 }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Tuma ombi' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Rekebisha sehemu zilizowekwa alama.');
    const name = screen.getByLabelText('Jina kamili');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveFocus();
    expect(name).toHaveAccessibleDescription('Weka jina lako, herufi 2 au zaidi.');
    expect(screen.getByLabelText('Namba ya simu')).toHaveAccessibleDescription(
      'Weka namba ya simu sahihi, mfano 0754 123 456. Mfano 0754 123 456',
    );
    expect(screen.getByLabelText(/Ujumbe/)).not.toHaveAttribute('aria-invalid');
    expect(calls).toEqual([]);
  });

  it('sends a valid request and shows the next steps', async () => {
    const calls = stubFetch({ 'POST /v1/public/contact': () => jsonResponse(202, undefined) });
    const user = userEvent.setup();
    renderAt('/demo');
    await screen.findByRole('heading', { level: 1 }, LOAD);
    await user.type(screen.getByLabelText('Jina kamili'), 'Asha Mwinyi');
    await user.type(screen.getByLabelText('Taasisi'), 'SACCO ya Walimu');
    await user.type(screen.getByLabelText('Namba ya simu'), '0754 123 456');
    await user.type(screen.getByLabelText('Barua pepe'), 'asha@example.test');
    await user.type(screen.getByLabelText('Idadi ya wapiga kura inayotarajiwa'), '850');
    await user.type(screen.getByLabelText('Tarehe unayopendelea'), '2099-12-03');
    await user.click(screen.getByRole('button', { name: 'Tuma ombi' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ombi limepokelewa' }),
    ).toHaveFocus();
    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/v1/public/contact',
        body: {
          kind: 'demo',
          name: 'Asha Mwinyi',
          organization: 'SACCO ya Walimu',
          phone: '+255754123456',
          email: 'asha@example.test',
          expectedVoters: 850,
          preferredDate: '2099-12-03',
          language: 'sw',
          website: '',
        },
      },
    ]);
  });

  it('shows server field errors in English', async () => {
    stubFetch({
      'POST /v1/public/contact': () =>
        jsonResponse(400, {
          code: 'VALIDATION_FAILED',
          message: 'x',
          details: { issues: [{ path: 'email', code: 'invalid_format', message: 'x' }] },
        }),
    });
    act(() => setPublicLanguage('en'));
    const user = userEvent.setup();
    renderAt('/demo');
    await screen.findByRole('heading', { level: 1, name: 'Request a demo' }, LOAD);
    await user.type(screen.getByLabelText('Full name'), 'John Kim');
    await user.type(screen.getByLabelText('Organization'), 'Parish council');
    await user.type(screen.getByLabelText('Phone number'), '+254712345678');
    await user.type(screen.getByLabelText('Email'), 'john@example.test');
    await user.type(screen.getByLabelText('Expected number of voters'), '120');
    await user.type(screen.getByLabelText('Preferred date'), '2099-01-10');
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveFocus();
  });
});

describe('contact form (PUB-04)', () => {
  async function fillAndSend() {
    const user = userEvent.setup();
    renderAt('/contact');
    await screen.findByRole('heading', { level: 1 }, LOAD);
    await user.type(screen.getByLabelText('Jina kamili'), 'Neema Kweka');
    await user.type(screen.getByLabelText('Barua pepe'), 'neema@example.test');
    await user.type(screen.getByLabelText(/^Ujumbe/), 'Tunahitaji uchaguzi wa bodi mwezi ujao.');
    await user.click(screen.getByRole('button', { name: 'Tuma ujumbe' }));
    return user;
  }

  it('says "Asante, tutawasiliana nawe" after sending, and can send another', async () => {
    const calls = stubFetch({ 'POST /v1/public/contact': () => jsonResponse(202, undefined) });
    const user = await fillAndSend();
    expect(await screen.findByText('Asante, tutawasiliana nawe')).toBeInTheDocument();
    expect(calls[0]?.body).toMatchObject({ kind: 'contact', language: 'sw' });
    expect(calls[0]?.body).not.toHaveProperty('phone');
    await user.click(screen.getByRole('button', { name: 'Tuma ujumbe mwingine' }));
    expect(screen.getByLabelText('Jina kamili')).toHaveValue('');
  });

  it('explains a rate limit and a lost connection', async () => {
    stubFetch({
      'POST /v1/public/contact': () => jsonResponse(429, { code: 'RATE_LIMITED', message: 'x' }),
    });
    await fillAndSend();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Maombi ni mengi. Subiri dakika moja kisha ujaribu tena.',
    );
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tuma ujumbe' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Hakuna mtandao.');
  });
});

describe('validateForm', () => {
  const now = new Date(2026, 10, 14, 12);
  const demo = {
    name: 'Asha',
    organization: 'SACCO',
    phone: '0754123456',
    email: 'a@example.test',
    expectedVoters: '10',
    preferredDate: '2026-11-14',
  };

  it('accepts today and refuses an earlier date', () => {
    expect(today(now)).toBe('2026-11-14');
    expect(validateForm('demo', demo, 'sw', now).errors).toBeNull();
    expect(
      validateForm('demo', { ...demo, preferredDate: '2026-11-13' }, 'sw', now).errors,
    ).toEqual({
      preferredDate: 'form.errors.preferredDate',
    });
  });

  it('refuses decimals and words as the number of voters', () => {
    for (const expectedVoters of ['1.5', 'mia', '0', '']) {
      expect(validateForm('demo', { ...demo, expectedVoters }, 'sw', now).errors).toEqual({
        expectedVoters: 'form.errors.expectedVoters',
      });
    }
  });

  it('has its own words for a message that is too long', () => {
    const base = { name: 'Asha', email: 'a@example.test' };
    expect(validateForm('contact', { ...base, message: 'x'.repeat(2001) }, 'sw').errors).toEqual({
      message: 'form.errors.messageLong',
    });
    expect(validateForm('contact', { ...base, message: 'short' }, 'sw').errors).toEqual({
      message: 'form.errors.message',
    });
  });
});
