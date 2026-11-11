// Ballot components (Design System 10.2–10.5): BallotProgress, ContesterCard, YesNoChoice.
// Every card in a category looks the same; nothing may favour a contester (Yes and No both use
// the brand colour when chosen).
import { CheckCircleFilled, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import type { BallotContester } from '@vote-kidigit/shared';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Photo } from './Photo';

export function BallotProgress({ current, total }: { current: number; total: number }) {
  const { t } = useTranslation();
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body-sm text-text-secondary">{t('ballot.progress', { current, total })}</p>
      <div
        className="vk-progress"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current}
        aria-label={t('ballot.progress', { current, total })}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

interface ContesterCardProps {
  contester: BallotContester;
  /** radio for single choice (inside a radiogroup), checkbox for multi-select. */
  role: 'radio' | 'checkbox';
  selected: boolean;
  disabled: boolean;
  showParty: boolean;
  onToggle: () => void;
}

export function ContesterCard({
  contester,
  role,
  selected,
  disabled,
  showParty,
  onToggle,
}: ContesterCardProps) {
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (!disabled) onToggle();
    }
  }
  return (
    <div
      role={role}
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      aria-label={contester.fullName}
      tabIndex={disabled ? -1 : 0}
      className="vk-card"
      onClick={disabled ? undefined : onToggle}
      onKeyDown={onKey}
      data-testid="contester-card"
    >
      <Photo url={contester.photoUrl} name={contester.fullName} />
      {selected && (
        <span className="vk-card__tick" aria-hidden>
          <CheckCircleFilled />
        </span>
      )}
      <span className="mt-2 line-clamp-3 text-h4">{contester.fullName}</span>
      {showParty && contester.party && (
        <span className="mt-0.5 text-body-sm font-normal text-text-secondary">
          {contester.party}
        </span>
      )}
    </div>
  );
}

interface YesNoChoiceProps {
  contester: BallotContester;
  value: 'yes' | 'no' | null;
  showParty: boolean;
  onChange: (value: 'yes' | 'no') => void;
}

export function YesNoChoice({ contester, value, showParty, onChange }: YesNoChoiceProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-4">
      <Photo url={contester.photoUrl} name={contester.fullName} size="large" />
      <div className="text-center">
        <p className="text-h3 font-semibold">{contester.fullName}</p>
        {showParty && contester.party && (
          <p className="text-body-sm text-text-secondary">{contester.party}</p>
        )}
      </div>
      <div role="radiogroup" aria-label={contester.fullName} className="flex w-full gap-3">
        {(['yes', 'no'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            className="vk-yesno"
            onClick={() => onChange(option)}
          >
            {option === 'yes' ? <CheckOutlined aria-hidden /> : <CloseOutlined aria-hidden />}
            {t(option === 'yes' ? 'ballot.yes' : 'ballot.no')}
          </button>
        ))}
      </div>
    </div>
  );
}
