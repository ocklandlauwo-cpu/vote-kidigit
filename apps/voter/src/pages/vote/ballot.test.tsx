import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ballotOf, card, category, EVENT_ID } from '../../dev/fixtures';
import { jsonResponse, renderAt, signedIn, status, stubFetch } from '../../test/vote';
import { getVoteState, resetVote } from '../../vote/store';
import CategoryPage from './CategoryPage';
import IdentityPage from './IdentityPage';
import ReceivedPage from './ReceivedPage';
import ReviewPage from './ReviewPage';
import SignInPage from './SignInPage';
import StatusPage from './StatusPage';

const pages = {
  '/vote/:eventId': SignInPage,
  '/vote/:eventId/identity': IdentityPage,
  '/vote/:eventId/status': StatusPage,
  '/vote/:eventId/ballot/:index': CategoryPage,
  '/vote/:eventId/review': ReviewPage,
  '/vote/:eventId/received': ReceivedPage,
};

afterEach(() => {
  vi.unstubAllGlobals();
  resetVote();
});

describe('VTR-WEB-04 category ballot', () => {
  it('keeps Inayofuata disabled until one is chosen; a second tap replaces the first', async () => {
    const chair = category('Mwenyekiti', ['Asha Mollel', 'Juma Ali', 'Neema Mushi']);
    signedIn({ ballot: ballotOf(chair) });
    renderAt(`/vote/${EVENT_ID}/ballot/1`, pages);
    const next = await screen.findByRole('button', { name: 'Inayofuata' });
    expect(next).toBeDisabled();
    expect(screen.getByText('Chagua mgombea 1')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Asha Mollel' }));
    expect(next).toBeEnabled();
    await userEvent.click(screen.getByRole('radio', { name: 'Juma Ali' }));
    expect(screen.getByRole('radio', { name: 'Juma Ali' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Asha Mollel' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('disables the other cards once the limit is reached', async () => {
    const board = category('Wajumbe', ['A Moshi', 'B Said', 'C Kweka', 'D Lyimo'], {
      selectionMode: 'range',
      exactCount: null,
      minCount: 1,
      maxCount: 2,
    });
    signedIn({ ballot: ballotOf(board) });
    renderAt(`/vote/${EVENT_ID}/ballot/1`, pages);
    expect(await screen.findByText('Chagua kati ya 1 na 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'A Moshi' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'C Kweka' }));
    expect(screen.getByText('Umechagua 2 kati ya 2')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'B Said' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'B Said' }));
    expect(screen.getByRole('checkbox', { name: 'B Said' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    // Unselecting frees the others again.
    await userEvent.click(screen.getByRole('checkbox', { name: 'A Moshi' }));
    expect(screen.getByRole('checkbox', { name: 'B Said' })).not.toHaveAttribute('aria-disabled');
  });

  it('offers Ndiyo / Hapana for a single contester, and skipping where allowed', async () => {
    const treasurer = category('Mweka hazina', ['Asha Mollel'], { allowSkip: true });
    const chair = category('Mwenyekiti', ['X', 'Y']);
    signedIn({ ballot: ballotOf(treasurer, chair) });
    const { router } = renderAt(`/vote/${EVENT_ID}/ballot/1`, pages);
    expect(await screen.findByText('Nafasi 1 kati ya 2')).toBeInTheDocument();
    const next = screen.getByRole('button', { name: 'Inayofuata' });
    expect(next).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: /Hapana/ }));
    expect(next).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Ruka nafasi hii' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/vote/${EVENT_ID}/ballot/2`));
    expect(getVoteState().choices[treasurer.id]).toEqual({ kind: 'skipped' });
  });
});

describe('VTR-WEB-05 review', () => {
  it('lists every choice, goes back with Badilisha, and submits', async () => {
    const chair = category('Mwenyekiti', ['Asha Mollel', 'Juma Ali']);
    const treasurer = category('Mweka hazina', ['Neema Mushi'], { allowSkip: true });
    signedIn({
      ballot: ballotOf(chair, treasurer),
      choices: {
        [chair.id]: { kind: 'contesters', ids: [chair.contesters[1]?.id ?? ''] },
        [treasurer.id]: { kind: 'skipped' },
      },
    });
    const calls = stubFetch({
      'POST /v1/vote/ballot': () =>
        jsonResponse(200, {
          recorded: [{ categoryId: chair.id, name: chair.name }],
          rejected: [{ categoryId: treasurer.id, name: treasurer.name, reason: 'CATEGORY_CLOSED' }],
          votedAt: '2026-11-20T07:42:00.000Z',
        }),
    });
    const { router } = renderAt(`/vote/${EVENT_ID}/review`, pages);
    const review = await screen.findByTestId('review-card');
    expect(within(review).getByText('Juma Ali')).toBeInTheDocument();
    expect(within(review).getByText('Umeruka')).toBeInTheDocument();
    expect(screen.getByText('Ukishatuma, huwezi kubadilisha kura')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Badilisha Mweka hazina' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/vote/${EVENT_ID}/ballot/2`));
    await router.navigate(`/vote/${EVENT_ID}/review`);

    await userEvent.click(await screen.findByRole('button', { name: 'Tuma kura' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/vote/${EVENT_ID}/received`));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      selections: [
        { categoryId: chair.id, choice: 'contester', contesterIds: [chair.contesters[1]?.id] },
        { categoryId: treasurer.id, choice: 'skipped', contesterIds: [] },
      ],
    });
    expect(
      await screen.findByText('Asante Asha, kura yako imepokelewa saa 10:42'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Nafasi Mweka hazina ilifungwa kabla hujatuma. Kura yako kwa nafasi hiyo haikuhesabiwa.',
      ),
    ).toBeInTheDocument();
    // Browser back after submit returns to the confirmation, never the ballot.
    await router.navigate(`/vote/${EVENT_ID}/ballot/1`);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/vote/${EVENT_ID}/received`));
  });

  it('says the vote was not counted when voting closed first', async () => {
    const chair = category('Mwenyekiti', ['Asha Mollel', 'Juma Ali']);
    signedIn({
      ballot: ballotOf(chair),
      choices: { [chair.id]: { kind: 'contesters', ids: [chair.contesters[0]?.id ?? ''] } },
    });
    stubFetch({
      'POST /v1/vote/ballot': () => jsonResponse(409, { code: 'VOTING_CLOSED', message: 'x' }),
    });
    renderAt(`/vote/${EVENT_ID}/review`, pages);
    await userEvent.click(await screen.findByRole('button', { name: 'Tuma kura' }));
    expect(
      await screen.findByText('Upigaji kura umefungwa saa 16:00. Kura yako haikuhesabiwa.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Angalia hali' })).toBeInTheDocument();
  });
});

describe('status screens', () => {
  const show = (loaded: ReturnType<typeof status>) => {
    signedIn();
    stubFetch({ 'GET /v1/vote/status': () => jsonResponse(200, loaded) });
    return renderAt(`/vote/${EVENT_ID}/status`, pages);
  };

  it('voting not yet open, with the start time', async () => {
    show(status({ event: card({ state: 'scheduled', startAt: '2099-11-20T05:00:00.000Z' }) }));
    expect(
      await screen.findByText('Upigaji kura utaanza 20 Nov 2099 saa 08:00'),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Zimebaki/)).toBeInTheDocument();
  });

  it('closed, cancelled and results published', async () => {
    const { unmount } = show(status({ event: card({ state: 'closed' }) }));
    expect(
      await screen.findByText('Upigaji kura umefungwa. Matokeo bado hayajatangazwa'),
    ).toBeInTheDocument();
    unmount();
    const second = show(status({ event: card({ state: 'cancelled' }) }));
    expect(await screen.findByText('Uchaguzi huu umesitishwa')).toBeInTheDocument();
    second.unmount();
    show(status({ event: card({ state: 'results_published' }) }));
    expect(await screen.findByText('Matokeo yametangazwa')).toBeInTheDocument();
  });

  it('first visit (VTR-WEB-03) and returning (VTR-WEB-07)', async () => {
    const categories = [
      {
        id: '0190f0a1-2b3c-7d4e-8f90-0000000000a1',
        name: 'Mwenyekiti',
        state: 'open' as const,
        votedAt: null,
        opensAt: null,
        closesAt: null,
      },
      {
        id: '0190f0a1-2b3c-7d4e-8f90-0000000000b1',
        name: 'Katibu',
        state: 'opens_later' as const,
        votedAt: null,
        opensAt: '2026-11-20T09:00:00.000Z',
        closesAt: null,
      },
    ];
    const { unmount } = show(status({ categories, canVote: true }));
    expect(await screen.findByRole('heading', { name: 'Kura yako' })).toBeInTheDocument();
    expect(screen.getByText('Utapiga kura katika nafasi 1 sasa')).toBeInTheDocument();
    expect(screen.getByText('Itafunguliwa 12:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anza kupiga kura' })).toBeInTheDocument();
    unmount();
    show(
      status({
        categories: [
          {
            id: '0190f0a1-2b3c-7d4e-8f90-0000000000a1',
            name: 'Mwenyekiti',
            state: 'voted',
            votedAt: '2026-11-20T07:42:00.000Z',
            opensAt: null,
            closesAt: null,
          },
        ],
        votedAt: '2026-11-20T07:42:00.000Z',
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Hali yako' })).toBeInTheDocument();
    expect(screen.getByText('Umeshapiga kura')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Piga kura' })).not.toBeInTheDocument();
  });

  it('a voter in no category', async () => {
    show(status({ categories: [] }));
    expect(
      await screen.findByText(
        'Hujapangiwa nafasi yoyote katika uchaguzi huu. Wasiliana na msimamizi.',
      ),
    ).toBeInTheDocument();
  });
});

describe('VTR-WEB-01 sign-in', () => {
  const fill = async () => {
    await userEvent.type(await screen.findByLabelText('Namba ya uanachama'), 'M-101');
    await userEvent.type(screen.getByLabelText('Msimbo wa uthibitisho'), 'k7m4q9xr');
  };

  it('formats the code, and shows the attempts left', async () => {
    const calls = stubFetch({
      [`GET /v1/vote/events/${EVENT_ID}`]: () => jsonResponse(200, card()),
      'POST /v1/vote/sign-in': () =>
        jsonResponse(401, {
          code: 'INVALID_CREDENTIALS',
          message: 'x',
          details: { attemptsLeft: 3 },
        }),
    });
    renderAt(`/vote/${EVENT_ID}`, pages);
    await fill();
    expect(screen.getByLabelText('Msimbo wa uthibitisho')).toHaveValue('K7M4-Q9XR');
    await userEvent.click(screen.getByRole('button', { name: 'Endelea' }));
    expect(
      await screen.findByText('Namba ya uanachama au msimbo si sahihi. Majaribio yaliyobaki: 3'),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      eventId: EVENT_ID,
      membershipId: 'M-101',
      code: 'K7M4-Q9XR',
    });
  });

  it('shows the lock screen with the time', async () => {
    stubFetch({
      [`GET /v1/vote/events/${EVENT_ID}`]: () => jsonResponse(200, card()),
      'POST /v1/vote/sign-in': () =>
        jsonResponse(423, {
          code: 'VOTER_LOCKED',
          message: 'x',
          details: { lockedUntil: '2026-11-20T07:15:00.000Z' },
        }),
    });
    renderAt(`/vote/${EVENT_ID}`, pages);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Endelea' }));
    expect(
      await screen.findByText('Umezuiwa kwa dakika 15. Jaribu tena saa 10:15'),
    ).toBeInTheDocument();
  });

  it('lets the voter choose when several events match', async () => {
    const other = '0190f0a1-2b3c-7d4e-8f90-0000000000f2';
    const calls = stubFetch({
      [`GET /v1/vote/events/${EVENT_ID}`]: () => jsonResponse(200, card()),
      'POST /v1/vote/sign-in': (body) =>
        (body as { eventId?: string }).eventId === other
          ? jsonResponse(200, {
              token: 'x'.repeat(43),
              voter: { fullName: 'Asha', membershipId: 'M-101', photoUrl: null },
              event: card({ id: other }),
            })
          : jsonResponse(300, {
              code: 'CHOOSE_EVENT',
              message: 'x',
              details: {
                events: [
                  { id: EVENT_ID, name: 'AGM', organizationName: 'Chama A' },
                  { id: other, name: 'Uchaguzi', organizationName: 'Chama B' },
                ],
              },
            }),
    });
    const { router } = renderAt(`/vote/${EVENT_ID}`, pages);
    await fill();
    // Pretend the link had no event: the first answer asks to choose.
    await userEvent.click(screen.getByRole('button', { name: 'Endelea' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Chama B: Uchaguzi' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/vote/${other}/identity`));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
  });
});
