// The registered-voters report (PRD REP-02): name, membership ID, gender, masked phone, the
// categories the voter may vote in, voted / not voted and the code SMS status. It never shows
// choices or codes: the data type has no field for them. Pure: data in, HTML out.
import type { CodeStatus, EventStatus, Gender, Language } from '@vote-kidigit/shared';
import { documentHtml, esc, reportHeader } from './html.js';
import { count, reportDateTime, reportText } from './report-text.js';

export interface VoterReportRow {
  fullName: string;
  membershipId: string;
  gender: Gender;
  /** Already masked: "•••••••456". */
  phoneMasked: string;
  /** Names of the categories the voter is eligible for; empty when the event has none. */
  categories: string[];
  /** All of the event's categories: shown as "All" instead of the list. */
  allCategories: boolean;
  voted: boolean;
  codeStatus: CodeStatus;
}

export interface VotersReportData {
  language: Language;
  timeZone: string;
  organization: { name: string; logo: string | null };
  event: { name: string; status: EventStatus };
  voters: VoterReportRow[];
  generatedAt: Date;
  generatedBy: string;
  font: string | null;
}

/** The text of a row's cells, shared by the PDF and the Excel file. */
export function voterCells(row: VoterReportRow, language: Language): string[] {
  const text = reportText[language];
  return [
    row.fullName,
    row.membershipId,
    text.genders[row.gender],
    row.phoneMasked,
    row.allCategories ? text.allCategories : row.categories.join(', '),
    row.voted ? text.voted : text.notVoted,
    text.codeStatus[row.codeStatus],
  ];
}

export function voterColumns(language: Language): string[] {
  const text = reportText[language];
  return [
    text.name,
    text.membershipId,
    text.gender,
    text.phone,
    text.categories,
    text.status,
    text.sms,
  ];
}

export function votersReportHtml(data: VotersReportData): string {
  const text = reportText[data.language];
  const voted = data.voters.filter((row) => row.voted).length;
  const head = voterColumns(data.language)
    .map((column) => `<th>${esc(column)}</th>`)
    .join('');
  const rows = data.voters
    .map(
      (row) =>
        `<tr>${voterCells(row, data.language)
          .map((cell) => `<td>${esc(cell)}</td>`)
          .join('')}</tr>`,
    )
    .join('\n');
  const body = `${reportHeader({
    organizationName: data.organization.name,
    logo: data.organization.logo,
    title: text.votersTitle,
    subtitle: data.event.name,
  })}
<p>${esc(text.totals(count(data.voters.length), count(voted)))}</p>
<p class="small muted">${esc(
    text.generated(
      reportDateTime(data.generatedAt, data.timeZone, data.language),
      data.generatedBy,
    ),
  )}</p>
<table class="small" style="margin-top: 8pt"><thead><tr>${head}</tr></thead><tbody>
${rows}
</tbody></table>`;
  return documentHtml({
    title: `${text.votersTitle} · ${data.event.name}`,
    language: data.language,
    font: data.font,
    body,
  });
}
