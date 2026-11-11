// RES-04 Public results (App Flow 11.1): anyone with the link sees the published results, winners
// only when the event says so. A disabled or unknown link says "Kiungo hiki hakipatikani".
import type { PublicResults, VoterEventCard } from '@vote-kidigit/shared';
import { PublicResultsSchema } from '@vote-kidigit/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { voterApi } from '../../api/client';
import { ResultsView } from '../../components/vote/ResultsView';
import { StatusScreen } from '../../components/vote/VoterCards';
import { VoterFrame } from '../../components/vote/VoterFrame';
import { applyBrand } from '../../vote/brand';

export default function PublicResultsPage() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const [results, setResults] = useState<PublicResults | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    voterApi(`/v1/results/${encodeURIComponent(token)}`, { schema: PublicResultsSchema })
      .then((loaded) => {
        if (cancelled) return;
        setResults(loaded);
        applyBrand(loaded.event.primaryColor);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // The frame's header needs a card-like object: name, logo and organization.
  const card: VoterEventCard | null = results
    ? {
        id: '',
        name: results.event.name,
        organizationName: results.event.organizationName,
        logoUrl: results.event.logoUrl,
        primaryColor: results.event.primaryColor,
        timeZone: results.event.timeZone,
        helpPhone: null,
        startAt: results.event.closedAt ?? '',
        endAt: results.event.closedAt ?? '',
        state: 'results_published',
      }
    : null;

  return (
    <VoterFrame event={card}>
      {missing ? (
        <StatusScreen kind="closed" title={t('results.unavailable')} />
      ) : results ? (
        <ResultsView results={results} />
      ) : (
        <div className="h-40 animate-pulse rounded-lg bg-surface-muted" aria-busy />
      )}
    </VoterFrame>
  );
}
