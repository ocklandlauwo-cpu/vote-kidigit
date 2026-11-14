// Voter components in the development gallery (Design System 10): every variant and state, with
// sample data. English labels only: this page is a developer tool.
import { LockOutlined } from '@ant-design/icons';
import { FeatureTile, PhoneMock } from '../pages/public/PublicParts';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { BallotProgress, ContesterCard, YesNoChoice } from '../components/vote/BallotParts';
import { Button } from '../components/vote/Button';
import {
  CategoryOverview,
  IdentityCard,
  ReviewCard,
  StatusScreen,
} from '../components/vote/VoterCards';
import { HelpLine, PoweredBy, VoterHeader } from '../components/vote/VoterFrame';
import { card, category, identity } from './fixtures';

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-6 flex max-w-120 flex-col gap-3">
      <p className="text-label font-semibold text-text-secondary">{title}</p>
      {children}
    </div>
  );
}

const sample = category('Mwenyekiti', ['Asha Mollel', 'Juma Ali Mohamed', 'Neema Mushi']);
const single = category('Mweka hazina', ['Rehema Kweka']);

export function VoterComponents() {
  const [chosen, setChosen] = useState<string[]>([sample.contesters[0]?.id ?? '']);
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null);
  return (
    <section className="mb-8">
      <h2 className="mb-4 text-h2 font-semibold">Voter components</h2>
      <Block title="VoterHeader, HelpLine, PoweredBy">
        <VoterHeader event={card()} />
        <HelpLine phone="+255754000222" />
        <PoweredBy />
      </Block>
      <Block title="Buttons: primary, secondary, tertiary, loading, disabled, S">
        <Button block>Endelea</Button>
        <Button block variant="secondary">
          Si mimi
        </Button>
        <Button block variant="tertiary">
          Rudi
        </Button>
        <Button block loading>
          Tuma kura
        </Button>
        <Button block disabled>
          Inayofuata
        </Button>
        <Button size="S" variant="tertiary">
          Badilisha
        </Button>
      </Block>
      <Block title="BallotProgress">
        <BallotProgress current={2} total={3} />
      </Block>
      <Block title="ContesterCard: selected, default, disabled (limit reached)">
        <div className="vk-card-grid">
          {sample.contesters.map((contester, i) => (
            <ContesterCard
              key={contester.id}
              contester={contester}
              role="checkbox"
              selected={chosen.includes(contester.id)}
              disabled={i === 2}
              showParty
              onToggle={() =>
                setChosen((ids) =>
                  ids.includes(contester.id)
                    ? ids.filter((x) => x !== contester.id)
                    : [...ids, contester.id],
                )
              }
            />
          ))}
        </div>
      </Block>
      <Block title="YesNoChoice">
        {single.contesters[0] && (
          <YesNoChoice
            contester={single.contesters[0]}
            value={answer}
            showParty={false}
            onChange={setAnswer}
          />
        )}
      </Block>
      <Block title="IdentityCard">
        <IdentityCard identity={identity} />
      </Block>
      <Block title="CategoryOverview">
        <CategoryOverview
          timeZone="Africa/Dar_es_Salaam"
          categories={[
            {
              id: 'a',
              name: 'Mwenyekiti',
              state: 'voted',
              votedAt: null,
              opensAt: null,
              closesAt: null,
            },
            {
              id: 'b',
              name: 'Katibu',
              state: 'open',
              votedAt: null,
              opensAt: null,
              closesAt: null,
            },
            {
              id: 'c',
              name: 'Mweka hazina',
              state: 'opens_later',
              votedAt: null,
              opensAt: '2026-11-20T09:00:00.000Z',
              closesAt: null,
            },
            {
              id: 'd',
              name: 'Wajumbe',
              state: 'closed',
              votedAt: null,
              opensAt: null,
              closesAt: null,
            },
          ]}
        />
      </Block>
      <Block title="ReviewCard">
        <ReviewCard
          items={[
            {
              categoryId: 'a',
              categoryName: 'Mwenyekiti',
              chosen: [{ name: 'Asha Mollel', photoUrl: null }],
              onChange: () => undefined,
            },
            { categoryId: 'b', categoryName: 'Katibu', chosen: null, onChange: () => undefined },
          ]}
        />
      </Block>
      <Block title="StatusScreen: scheduled, closed, voted, cancelled, locked, received">
        {(['scheduled', 'closed', 'voted', 'cancelled', 'locked', 'received'] as const).map(
          (kind) => (
            <StatusScreen key={kind} kind={kind} title={kind} message="Message" />
          ),
        )}
      </Block>
      <Block title="Public site (10.11): buttons M, CTA on primary, step number, feature tile, phone mock">
        <div className="vk-site flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="vk-btn vk-btn--primary vk-btn--m">
              Primary M
            </button>
            <button type="button" className="vk-btn vk-btn--secondary vk-btn--m">
              Secondary M
            </button>
            <button type="button" className="vk-btn vk-btn--tertiary vk-btn--m">
              Tertiary M
            </button>
            <button type="button" className="vk-btn vk-btn--primary vk-btn--m" disabled>
              Disabled
            </button>
          </div>
          <div className="vk-cta-band px-4">
            <button type="button" className="vk-btn vk-btn--on-primary">
              On primary
            </button>
          </div>
          <span className="vk-step-number">1</span>
          <FeatureTile icon={LockOutlined} title="Feature tile" text="Body small text" />
          <PhoneMock />
        </div>
      </Block>
    </section>
  );
}
