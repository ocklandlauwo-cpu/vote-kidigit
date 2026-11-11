// Published results for voters and the public (RES-04, VTR-WEB-08): closed time and turnout, then
// per category the winners and, when the event shows full results, every contester's votes and %.
// The check code identifies this exact version of the results.
import { CheckCircleFilled } from '@ant-design/icons';
import type { PublicResults } from '@vote-kidigit/shared';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../format';
import { Photo } from './Photo';

export function ResultsView({ results }: { results: PublicResults }) {
  const { t } = useTranslation();
  const tz = results.event.timeZone;
  return (
    <div className="flex flex-col gap-4" data-testid="results-view">
      <h1 className="text-h2 font-semibold">{t('results.title')}</h1>
      {results.event.closedAt && (
        <p className="text-body-sm text-text-secondary">
          {t('results.closedAt', { time: formatDateTime(results.event.closedAt, tz) })}
        </p>
      )}
      {results.turnout && (
        <p className="font-semibold">
          {t('results.turnout', {
            voted: results.turnout.voted.toLocaleString('en'),
            registered: results.turnout.registered.toLocaleString('en'),
          })}
        </p>
      )}
      {results.categories.map((category) => (
        <section key={category.name} className="vk-list-card">
          <h2 className="px-4 pt-4 pb-2 text-h4 font-semibold">{category.name}</h2>
          {category.quorumMet === false && (
            <p className="px-4 pb-2 text-body-sm text-text-secondary">
              {t('results.quorumNotMet')}
            </p>
          )}
          {category.rows.length === 0 ? (
            <p className="px-4 pb-4 text-text-secondary">{t('results.noWinner')}</p>
          ) : (
            <ul>
              {category.rows.map((row) => (
                <li key={`${row.name}-${row.choice}`} className="flex items-center gap-3 px-4 py-3">
                  <Photo url={row.photoUrl} name={row.name} size="row" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className={row.isWinner ? 'font-semibold' : ''}>
                      {row.choice === 'contester'
                        ? row.name
                        : `${row.name} · ${t(row.choice === 'yes' ? 'results.yes' : 'results.no')}`}
                    </span>
                    {row.votes !== null && (
                      <span className="text-body-sm text-text-secondary tabular-nums">
                        {t('results.votes', {
                          votes: row.votes.toLocaleString('en'),
                          percent: row.percent,
                        })}
                      </span>
                    )}
                  </div>
                  {row.isWinner && (
                    <span className="flex items-center gap-1 text-body-sm text-success-fg">
                      <CheckCircleFilled aria-hidden />
                      {t('results.winner')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {category.tieNote && (
            <p className="px-4 pb-4 text-body-sm text-text-secondary">
              {t('results.tieNote', { reason: category.tieNote })}
            </p>
          )}
        </section>
      ))}
      <p className="font-mono text-caption break-all text-text-tertiary">
        {t('results.version', { version: results.version })} ·{' '}
        {t('results.check', { hash: results.contentHash })}
      </p>
    </div>
  );
}
