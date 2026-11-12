// The results PDF (PRD REP-01, App Flow RES-05): organization logo and name; event name, dates
// and status; per category the contesters with votes and %, skipped, winners and tie notes;
// turnout; opened and closed times; who generated it and when; signature lines; a QR code to the
// public results page and the content hash of the snapshot. Pure: data in, HTML out.
import type { EventStatus, Language, ResultCategory, ResultSnapshot } from '@vote-kidigit/shared';
import { documentHtml, esc, reportHeader } from './html.js';
import { count, reportDateTime, type ReportText, reportText } from './report-text.js';

export interface ResultsReportData {
  language: Language;
  timeZone: string;
  organization: { name: string; logo: string | null };
  event: {
    name: string;
    status: EventStatus;
    startAt: Date;
    endAt: Date;
    openedAt: Date | null;
    closedAt: Date | null;
    resultsPublishedAt: Date | null;
  };
  snapshot: ResultSnapshot;
  /** The public results page; null before publication. */
  publicUrl: string | null;
  /** QR code of publicUrl as an SVG element. */
  qrSvg: string | null;
  generatedAt: Date;
  generatedBy: string;
  /** Inter as a data URI; null renders in the fallback fonts. */
  font: string | null;
}

const pct = (value: number) => value.toFixed(1);

function categorySection(
  category: ResultCategory,
  text: ReportText,
  when: (at: Date) => string,
): string {
  const rows = category.rows
    .map((row) => {
      const name =
        row.choice === 'contester'
          ? row.name
          : `${row.name} · ${row.choice === 'yes' ? text.yes : text.no}`;
      const party = row.party ? ` <span class="muted small">${esc(row.party)}</span>` : '';
      const winner = row.isWinner ? ` <span class="badge">${esc(text.winner)}</span>` : '';
      return `<tr><td class="${row.isWinner ? 'winner' : ''}">${esc(name)}${party}${winner}</td>
<td class="num">${esc(count(row.votes))}</td><td class="num">${esc(pct(row.percent))}</td></tr>`;
    })
    .join('\n');
  // Each note is HTML, its values escaped as it is added.
  const notes: string[] = [
    esc(
      `${text.eligible}: ${count(category.eligibleVoters)} · ${text.votedInCategory}: ${count(
        category.votersVoted,
      )} · ${text.skipped}: ${count(category.skipped)}`,
    ),
  ];
  if (category.thresholdPct !== null && category.thresholdMet !== null) {
    notes.push(esc(text.threshold(pct(category.thresholdPct), category.thresholdMet)));
  }
  if (category.quorumPct !== null && category.quorumMet !== null) {
    notes.push(esc(text.quorum(pct(category.quorumPct), category.quorumMet)));
  }
  if (category.tie) {
    const { resolvedBy, resolvedAt, reason } = category.tie;
    notes.push(esc(text.tieNote(resolvedBy, when(new Date(resolvedAt)), reason)));
  } else if (category.hasTie) {
    notes.push(`<span class="warn">${esc(text.tieOpen)}</span>`);
  }
  if (!category.rows.some((row) => row.isWinner)) notes.push(esc(text.noWinner));
  return `<section class="category">
<h2>${esc(category.name)} <span class="muted small">${esc(text.seats(category.seats))}</span></h2>
<table><thead><tr><th>${esc(text.contester)}</th><th class="num">${esc(text.votes)}</th>
<th class="num">${esc(text.percent)}</th></tr></thead><tbody>
${rows}
</tbody></table>
<div class="notes">${notes.join('<br>')}</div>
</section>`;
}

export function resultsReportHtml(data: ResultsReportData): string {
  const text = reportText[data.language];
  const when = (at: Date) => reportDateTime(at, data.timeZone, data.language);
  const { event, snapshot } = data;
  const turnoutPct = snapshot.registeredVoters
    ? (snapshot.votersVoted * 100) / snapshot.registeredVoters
    : 0;
  const facts: [string, string][] = [
    [text.status, text.eventStatus[event.status]],
    [text.window, `${when(event.startAt)} – ${when(event.endAt)}`],
    ...(event.openedAt ? [[text.opened, when(event.openedAt)] as [string, string]] : []),
    ...(event.closedAt ? [[text.closed, when(event.closedAt)] as [string, string]] : []),
    ...(event.resultsPublishedAt
      ? [[text.published, when(event.resultsPublishedAt)] as [string, string]]
      : []),
    [
      text.turnout,
      text.turnoutValue(
        count(snapshot.votersVoted),
        count(snapshot.registeredVoters),
        pct(turnoutPct),
      ),
    ],
  ];
  const witnesses = [text.returningOfficer, text.witness(1), text.witness(2)]
    .map(
      (role) => `<div><strong>${esc(role)}</strong>
<div class="line">${esc(text.nameLine)}</div><div class="line">${esc(text.signLine)}</div>
<div class="line">${esc(text.dateLine)}</div></div>`,
    )
    .join('\n');
  const verify = `<div class="verify">${data.qrSvg ?? ''}<div>
<p><strong>${esc(text.verify)}</strong></p>
${
  data.publicUrl
    ? `<p class="small">${esc(text.verifyHint)}</p><p class="mono">${esc(data.publicUrl)}</p>`
    : `<p class="small">${esc(text.notPublished)}</p>`
}
<p class="small">${esc(text.version(snapshot.version))} · ${esc(text.hash)}</p>
<p class="mono">${esc(snapshot.contentHash)}</p>
<p class="small muted">${esc(text.generated(when(data.generatedAt), data.generatedBy))}</p>
</div></div>`;
  const body = `${reportHeader({
    organizationName: data.organization.name,
    logo: data.organization.logo,
    title: text.resultsTitle,
    subtitle: event.name,
  })}
<dl class="facts">${facts.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>
${snapshot.categories.map((category) => categorySection(category, text, when)).join('\n')}
<div class="signatures"><h2>${esc(text.signatures)}</h2><div class="lines">${witnesses}</div></div>
${verify}`;
  return documentHtml({
    title: `${text.resultsTitle} · ${event.name}`,
    language: data.language,
    font: data.font,
    body,
  });
}
