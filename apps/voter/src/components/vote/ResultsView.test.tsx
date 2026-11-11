import { render, screen } from '@testing-library/react';
import type { PublicResults } from '@vote-kidigit/shared';
import { describe, expect, it } from 'vitest';
import '../../i18n';
import { ResultsView } from './ResultsView';

function results(change: Partial<PublicResults> = {}): PublicResults {
  return {
    event: {
      name: 'Uchaguzi Mkuu 2027',
      organizationName: 'Chama cha Walimu',
      logoUrl: null,
      primaryColor: null,
      timeZone: 'Africa/Dar_es_Salaam',
      closedAt: '2026-11-20T13:00:00.000Z',
      publishedAt: '2026-11-20T14:00:00.000Z',
    },
    visibility: 'full',
    version: 1,
    contentHash: 'b'.repeat(64),
    turnout: { registered: 5000, voted: 3214 },
    categories: [
      {
        name: 'Mwenyekiti',
        seats: 1,
        votersVoted: 3200,
        quorumMet: null,
        tieNote: null,
        rows: [
          {
            name: 'Asha Mollel',
            party: null,
            photoUrl: null,
            choice: 'contester',
            votes: 1800,
            percent: 56.3,
            isWinner: true,
          },
          {
            name: 'Juma Ali',
            party: null,
            photoUrl: null,
            choice: 'contester',
            votes: 1400,
            percent: 43.8,
            isWinner: false,
          },
        ],
      },
    ],
    ...change,
  };
}

describe('ResultsView', () => {
  it('shows turnout, every contester with votes and %, and the winner', () => {
    render(<ResultsView results={results()} />);
    expect(screen.getByText('Wamepiga kura 3,214 kati ya 5,000')).toBeInTheDocument();
    expect(screen.getByText('kura 1,800 · 56.3%')).toBeInTheDocument();
    expect(screen.getByText('Juma Ali')).toBeInTheDocument();
    expect(screen.getAllByText('Mshindi')).toHaveLength(1);
    expect(screen.getByText(/Toleo 1 · Alama ya uhakiki: b{64}/)).toBeInTheDocument();
  });

  it('shows only the winners, without counts, when the event says so', () => {
    render(
      <ResultsView
        results={results({
          visibility: 'winners_only',
          turnout: null,
          categories: [
            {
              name: 'Mwenyekiti',
              seats: 1,
              votersVoted: null,
              quorumMet: null,
              tieNote: null,
              rows: [
                {
                  name: 'Asha Mollel',
                  party: null,
                  photoUrl: null,
                  choice: 'contester',
                  votes: null,
                  percent: null,
                  isWinner: true,
                },
              ],
            },
          ],
        })}
      />,
    );
    expect(screen.queryByText(/Wamepiga kura/)).not.toBeInTheDocument();
    expect(screen.queryByText(/kura \d/)).not.toBeInTheDocument();
    expect(screen.getByText('Asha Mollel')).toBeInTheDocument();
  });
});
