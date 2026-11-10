// Voter CSV validation (PRD VTR-02–VTR-04, VTR-09, App Flow 6.6). One pure function used by the
// validation job, the import itself and the error file, so a row is judged the same way each time.
import {
  EmailSchema,
  type Gender,
  type ImportProblem,
  MEMBERSHIP_ID_MAX,
  normalizeMembershipId,
  normalizePersonName,
  normalizePhone,
  parseGender,
  REQUIRED_VOTER_CSV_COLUMNS,
  VOTER_CSV_COLUMNS,
  VOTER_NAME_MAX,
} from '@vote-kidigit/shared';
import Papa from 'papaparse';

export interface ExistingVoters {
  /** Normalized membership IDs already in the event. */
  membershipIds: Set<string>;
  /** Phones (E.164) already in the event. */
  phones: Set<string>;
  /**
   * Category name (normalized) → id for the optional categories column; null for a category
   * open to all event voters (named in the file, but nothing to link).
   */
  categories: Map<string, string | null>;
}

export interface ValidVoterRow {
  row: number;
  fullName: string;
  membershipId: string;
  phone: string;
  gender: Gender;
  email: string | null;
  categoryIds: string[];
}

export interface CsvValidation {
  /** Required columns missing from the header: nothing else is checked then. */
  missingColumns: string[];
  totalRows: number;
  /** Rows without errors (warnings included), ready to import. */
  rows: ValidVoterRow[];
  problems: ImportProblem[];
  validRows: number;
  warningRows: number;
  errorRows: number;
  /** The parsed records by row number, for the error file. */
  records: Map<number, Record<string, string>>;
}

/** Header names as people write them: "Full Name", "full-name" and "FULL_NAME" are one. */
const headerKey = (header: string) =>
  header
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

export function parseVoterCsv(text: string): {
  headers: string[];
  records: Record<string, string>[];
} {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: headerKey,
  });
  return { headers: parsed.meta.fields ?? [], records: parsed.data };
}

export function validateVoterCsv(text: string, existing: ExistingVoters): CsvValidation {
  const { headers, records } = parseVoterCsv(text);
  const missingColumns = REQUIRED_VOTER_CSV_COLUMNS.filter((c) => !headers.includes(c));
  const result: CsvValidation = {
    missingColumns,
    totalRows: records.length,
    rows: [],
    problems: [],
    validRows: 0,
    warningRows: 0,
    errorRows: 0,
    records: new Map(),
  };
  if (missingColumns.length > 0) return result;

  // First row (in file order) of each membership ID and phone, to flag later repeats.
  const seenMembership = new Set<string>();
  const phoneCount = new Map<string, number>();
  for (const record of records) {
    const phone = normalizePhone(record.phone ?? '');
    if (phone) phoneCount.set(phone, (phoneCount.get(phone) ?? 0) + 1);
  }

  records.forEach((record, index) => {
    const row = index + 2; // the header is row 1
    result.records.set(row, record);
    const errors: ImportProblem[] = [];
    const error = (field: string, code: ImportProblem['code']) =>
      errors.push({ row, field, code, severity: 'error' });

    const fullName = (record.full_name ?? '').trim();
    if (!fullName) error('full_name', 'required');
    else if (fullName.length > VOTER_NAME_MAX) error('full_name', 'too_long');

    const membershipId = (record.membership_id ?? '').trim();
    const membershipKey = normalizeMembershipId(membershipId);
    if (!membershipKey) error('membership_id', 'required');
    else if (membershipId.length > MEMBERSHIP_ID_MAX) error('membership_id', 'too_long');
    else if (existing.membershipIds.has(membershipKey)) error('membership_id', 'membership_exists');
    else if (seenMembership.has(membershipKey)) error('membership_id', 'duplicate_in_file');
    if (membershipKey) seenMembership.add(membershipKey);

    const rawPhone = (record.phone ?? '').trim();
    const phone = normalizePhone(rawPhone);
    if (!rawPhone) error('phone', 'required');
    else if (!phone) error('phone', 'invalid_phone');

    const rawGender = (record.gender ?? '').trim();
    const gender = parseGender(rawGender);
    if (!rawGender) error('gender', 'required');
    else if (!gender) error('gender', 'invalid_gender');

    const rawEmail = (record.email ?? '').trim();
    const email = rawEmail ? EmailSchema.safeParse(rawEmail) : null;
    if (email && !email.success) error('email', 'invalid_email');

    const categoryIds: string[] = [];
    for (const name of (record.categories ?? '')
      .split('|')
      .map((n) => n.trim())
      .filter(Boolean)) {
      const key = normalizePersonName(name);
      if (!existing.categories.has(key)) error('categories', 'unknown_category');
      const id = existing.categories.get(key);
      if (id) categoryIds.push(id);
    }

    if (errors.length > 0 || !phone || !gender) {
      result.errorRows += 1;
      result.problems.push(...errors);
      return;
    }
    const sharedPhone = (phoneCount.get(phone) ?? 0) > 1 || existing.phones.has(phone);
    if (sharedPhone) {
      result.warningRows += 1;
      result.problems.push({ row, field: 'phone', code: 'duplicate_phone', severity: 'warning' });
    } else {
      result.validRows += 1;
    }
    result.rows.push({
      row,
      fullName,
      membershipId,
      phone,
      gender,
      email: email?.success ? email.data : null,
      categoryIds: [...new Set(categoryIds)],
    });
  });
  return result;
}

/** The template (PRD VTR-02): the header and one example row. */
export function voterCsvTemplate(): string {
  return Papa.unparse({
    fields: [...VOTER_CSV_COLUMNS],
    data: [['Asha Mollel', 'M-1029', '0712345678', 'Female', 'asha@example.com', 'M-1029.jpg', '']],
  });
}

/**
 * VTR-05: the rejected rows as they were, with the reasons, to fix and upload again. The values
 * come from an uploaded file and the result is opened in a spreadsheet, so cells starting with
 * = + - @ (or a tab / carriage return) are prefixed with ' and never run as formulas.
 */
export function errorRowsCsv(validation: CsvValidation): string {
  const rows = new Map<number, string[]>();
  for (const problem of validation.problems) {
    if (problem.severity !== 'error') continue;
    rows.set(problem.row, [...(rows.get(problem.row) ?? []), `${problem.field}: ${problem.code}`]);
  }
  const fields = [...VOTER_CSV_COLUMNS];
  return Papa.unparse(
    {
      fields: ['row', ...fields, 'errors'],
      data: [...rows.entries()].map(([row, reasons]) => {
        const record = validation.records.get(row) ?? {};
        return [String(row), ...fields.map((f) => record[f] ?? ''), reasons.join('; ')];
      }),
    },
    { escapeFormulae: true },
  );
}
