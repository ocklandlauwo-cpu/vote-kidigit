// VTR-WEB-04 one category of the ballot (App Flow 8.1; Design System 10.2–10.5): progress, name
// and picture, the rule line and a live counter, contester cards in this voter's own order (radio
// for one choice, checkbox for several; the others disable at the limit), or Yes / No for a single
// contester, and "Ruka nafasi hii" where skipping is allowed. Inayofuata needs the rule met.
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';
import { BallotProgress, ContesterCard, YesNoChoice } from '../../components/vote/BallotParts';
import { Button } from '../../components/vote/Button';
import { VoterFrame } from '../../components/vote/VoterFrame';
import { paths, useIdleTimeout } from '../../vote/flow';
import {
  type Choice,
  isSingle,
  limitReached,
  maxChoices,
  minChoices,
  ruleMet,
  toggle,
} from '../../vote/rules';
import { setVoteState, useVote } from '../../vote/store';

export default function CategoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { eventId = '', index: indexParam = '1' } = useParams();
  const { token, event, ballot, choices, result } = useVote();
  useIdleTimeout(eventId);

  // After submit, browser back never returns to the ballot (App Flow 3.8).
  if (result) return <Navigate to={paths.received(eventId)} replace />;
  if (!token) return <Navigate to={paths.signIn(eventId)} replace />;
  if (!ballot) return <Navigate to={paths.status(eventId)} replace />;
  const index = Number(indexParam);
  const total = ballot.categories.length;
  const category = ballot.categories[index - 1];
  if (!category || !Number.isInteger(index)) return <Navigate to={paths.status(eventId)} replace />;

  const choice = choices[category.id];
  const choose = (next: Choice) => setVoteState({ choices: { ...choices, [category.id]: next } });
  const chosenIds = choice?.kind === 'contesters' ? choice.ids : [];
  const single = isSingle(category);
  const atLimit = limitReached(category, choice);
  const max = maxChoices(category);
  const min = minChoices(category);

  const ruleLine = category.rules.yesNo
    ? t('ballot.ruleYesNo')
    : category.rules.selectionMode === 'range' && min !== max
      ? t('ballot.ruleRange', { min, max })
      : t('ballot.ruleExact', { count: max });

  function next() {
    void navigate(index < total ? paths.category(eventId, index + 1) : paths.review(eventId));
  }
  function back() {
    void navigate(index > 1 ? paths.category(eventId, index - 1) : paths.status(eventId));
  }

  return (
    <VoterFrame
      event={event}
      poweredBy={false}
      actions={
        <>
          <Button variant="tertiary" block onClick={back}>
            {t('ballot.back')}
          </Button>
          <Button block disabled={!ruleMet(category, choice)} onClick={next}>
            {t('ballot.next')}
          </Button>
        </>
      }
    >
      <BallotProgress current={index} total={total} />
      {category.pictureUrl && (
        <img src={category.pictureUrl} alt="" className="vk-photo vk-photo--large self-center" />
      )}
      <h1 className="text-h2 font-semibold" id="category-name">
        {category.name}
      </h1>
      <p className="text-body text-text-secondary">{ruleLine}</p>
      {!single && !category.rules.yesNo && (
        <p className="text-label font-semibold text-brand" aria-live="polite">
          {t('ballot.chosen', { count: chosenIds.length, max })}
        </p>
      )}
      {category.rules.yesNo && category.contesters[0] ? (
        <YesNoChoice
          contester={category.contesters[0]}
          value={choice?.kind === 'yes' || choice?.kind === 'no' ? choice.kind : null}
          showParty={ballot.showParty}
          onChange={(value) => choose({ kind: value })}
        />
      ) : (
        <div
          className="vk-card-grid"
          role={single ? 'radiogroup' : 'group'}
          aria-labelledby="category-name"
        >
          {category.contesters.map((contester) => {
            const selected = chosenIds.includes(contester.id);
            return (
              <ContesterCard
                key={contester.id}
                contester={contester}
                role={single ? 'radio' : 'checkbox'}
                selected={selected}
                disabled={atLimit && !selected}
                showParty={ballot.showParty}
                onToggle={() => choose(toggle(category, choice, contester.id))}
              />
            );
          })}
        </div>
      )}
      {category.rules.allowSkip && (
        <Button
          variant="tertiary"
          block
          aria-pressed={choice?.kind === 'skipped'}
          onClick={() => {
            choose({ kind: 'skipped' });
            next();
          }}
        >
          {t('ballot.skip')}
        </Button>
      )}
    </VoterFrame>
  );
}
