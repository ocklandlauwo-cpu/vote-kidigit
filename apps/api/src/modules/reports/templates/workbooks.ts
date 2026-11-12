// Excel files (Tech Stack: ExcelJS): the registered-voters report (REP-02) and the audit export
// (SYS-01). Values are written as text cells, never as formulas, so a name starting with "="
// stays a name.
import type { AuditEntry, Language } from '@vote-kidigit/shared';
import { Workbook, type Worksheet } from 'exceljs';
import { reportDateTime, reportText } from './report-text.js';
import { voterCells, voterColumns, type VotersReportData } from './voters-report.js';

/** Excel keeps at most 32,767 characters in a cell. */
const MAX_CELL = 32_000;

function table(sheet: Worksheet, columns: string[], rows: string[][], widths: number[]): void {
  sheet.columns = columns.map((header, index) => ({ header, width: widths[index] ?? 18 }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const row of rows) sheet.addRow(row.map((cell) => cell.slice(0, MAX_CELL)));
}

async function toBuffer(workbook: Workbook): Promise<Buffer> {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function votersWorkbook(data: VotersReportData): Promise<Buffer> {
  const text = reportText[data.language];
  const workbook = new Workbook();
  workbook.creator = 'Vote-Kidigit';
  workbook.created = data.generatedAt;
  const sheet = workbook.addWorksheet(text.votersTitle.slice(0, 31));
  table(
    sheet,
    voterColumns(data.language),
    data.voters.map((row) => voterCells(row, data.language)),
    [28, 18, 12, 16, 32, 16, 14],
  );
  return toBuffer(workbook);
}

const json = (value: unknown) =>
  value === null || value === undefined ? '' : JSON.stringify(value);

export function auditWorkbook(options: {
  language: Language;
  timeZone: string;
  entries: AuditEntry[];
  eventNames: Map<string, string>;
  generatedAt: Date;
}): Promise<Buffer> {
  const text = reportText[options.language].audit;
  const workbook = new Workbook();
  workbook.creator = 'Vote-Kidigit';
  workbook.created = options.generatedAt;
  const sheet = workbook.addWorksheet(text.sheet);
  table(
    sheet,
    [
      text.time,
      text.user,
      text.action,
      text.item,
      text.itemId,
      text.event,
      text.ip,
      text.reason,
      text.before,
      text.after,
    ],
    options.entries.map((entry) => [
      reportDateTime(new Date(entry.createdAt), options.timeZone, options.language),
      entry.actorLabel,
      entry.action,
      entry.entityType,
      entry.entityId ?? '',
      entry.eventId ? (options.eventNames.get(entry.eventId) ?? entry.eventId) : '',
      entry.ip ?? '',
      entry.reason ?? '',
      json(entry.before),
      json(entry.after),
    ]),
    [22, 28, 26, 18, 38, 24, 16, 30, 40, 40],
  );
  return toBuffer(workbook);
}
