// Voter CSV validation (PRD VTR-02–VTR-05, VTR-09): every rule, the error file and the speed of a
// 10,000-row file.
import Papa from 'papaparse';
import {
  errorRowsCsv,
  type ExistingVoters,
  validateVoterCsv,
  voterCsvTemplate,
} from './csv-validation.js';

const CHAIR_ID = '0190f0a1-2b3c-7d4e-8f90-000000000301';

const none = (): ExistingVoters => ({
  membershipIds: new Set(),
  phones: new Set(),
  categories: new Map([
    ['mwenyekiti', CHAIR_ID],
    ['katibu', null],
  ]),
});

const csv = (rows: string[][]) =>
  Papa.unparse({
    fields: ['full_name', 'membership_id', 'phone', 'gender', 'email', 'photo_file', 'categories'],
    data: rows,
  });

describe('validateVoterCsv', () => {
  it('accepts good rows, normalizing phone, gender, email and categories', () => {
    const result = validateVoterCsv(
      `\uFEFF${csv([
        [
          'Asha Mollel',
          'M-1',
          '0712 345 678',
          'Female',
          ' Asha@Example.com ',
          '',
          'Mwenyekiti|Katibu',
        ],
        ['Juma Ali', 'm 2', '+255622000111', 'mwanaume', '', '', ''],
      ])}`,
      none(),
    );
    expect(result).toMatchObject({ totalRows: 2, validRows: 2, warningRows: 0, errorRows: 0 });
    expect(result.problems).toEqual([]);
    expect(result.rows).toEqual([
      {
        row: 2,
        fullName: 'Asha Mollel',
        membershipId: 'M-1',
        phone: '+255712345678',
        gender: 'female',
        email: 'asha@example.com',
        // "Katibu" is open to all voters: named, nothing to link.
        categoryIds: [CHAIR_ID],
      },
      {
        row: 3,
        fullName: 'Juma Ali',
        membershipId: 'm 2',
        phone: '+255622000111',
        gender: 'male',
        email: null,
        categoryIds: [],
      },
    ]);
  });

  it('reports each rule with the row and field', () => {
    const existing = none();
    existing.membershipIds.add('M-9');
    const result = validateVoterCsv(
      csv([
        ['', 'M-1', '0712345678', 'Female', '', '', ''],
        ['Neema', '', '0712345679', 'Female', '', '', ''],
        ['Baraka', 'M-3', '12345', 'Female', '', '', ''],
        ['Rehema', 'M-4', '0712345670', 'Other', '', '', ''],
        ['Zawadi', 'M-5', '0712345671', 'Female', 'si-barua', '', ''],
        ['Juma', 'M-6', '0712345672', 'Male', '', '', 'Mweka hazina'],
        ['Halima', 'M-9', '0712345673', 'Female', '', '', ''],
        ['Ali', 'M-7', '0712345674', 'Male', '', '', ''],
        ['Ali tena', 'm-7', '0712345675', 'Male', '', '', ''],
        ['x'.repeat(151), 'M-8', '0712345676', 'Male', '', '', ''],
      ]),
      existing,
    );
    expect(result.problems.map((p) => [p.row, p.field, p.code, p.severity])).toEqual([
      [2, 'full_name', 'required', 'error'],
      [3, 'membership_id', 'required', 'error'],
      [4, 'phone', 'invalid_phone', 'error'],
      [5, 'gender', 'invalid_gender', 'error'],
      [6, 'email', 'invalid_email', 'error'],
      [7, 'categories', 'unknown_category', 'error'],
      [8, 'membership_id', 'membership_exists', 'error'],
      [10, 'membership_id', 'duplicate_in_file', 'error'],
      [11, 'full_name', 'too_long', 'error'],
    ]);
    expect(result).toMatchObject({ totalRows: 10, validRows: 1, warningRows: 0, errorRows: 9 });
    expect(result.rows.map((r) => r.row)).toEqual([9]);
  });

  it('warns about a phone shared by several voters but imports them (VTR-04)', () => {
    const existing = none();
    existing.phones.add('+255700000001');
    const result = validateVoterCsv(
      csv([
        ['Mama', 'M-1', '0712000000', 'Female', '', '', ''],
        ['Mtoto', 'M-2', '0712 000 000', 'Male', '', '', ''],
        ['Babu', 'M-3', '0700000001', 'Male', '', '', ''],
      ]),
      existing,
    );
    expect(result).toMatchObject({ validRows: 0, warningRows: 3, errorRows: 0 });
    expect(result.rows).toHaveLength(3);
    expect(
      result.problems.every((p) => p.code === 'duplicate_phone' && p.severity === 'warning'),
    ).toBe(true);
  });

  it('names missing required columns and reads headers loosely', () => {
    const missing = validateVoterCsv('Full Name,Phone\nAsha,0712345678\n', none());
    expect(missing.missingColumns).toEqual(['membership_id', 'gender']);
    expect(missing.rows).toEqual([]);
    const loose = validateVoterCsv(
      'FULL NAME,Membership-ID,phone,Gender\nAsha,M-1,0712345678,F\n',
      none(),
    );
    expect(loose).toMatchObject({ missingColumns: [], validRows: 1 });
  });

  it('writes the rejected rows with their reasons (VTR-05)', () => {
    const result = validateVoterCsv(
      csv([
        ['Asha', 'M-1', '0712345678', 'Female', '', '', ''],
        ['Baraka', 'M-2', 'simu', 'X', '', '', ''],
      ]),
      none(),
    );
    const lines = errorRowsCsv(result).split(/\r?\n/);
    expect(lines[0]).toBe(
      'row,full_name,membership_id,phone,gender,email,photo_file,categories,errors',
    );
    expect(lines[1]).toBe('3,Baraka,M-2,simu,X,,,,phone: invalid_phone; gender: invalid_gender');
    expect(lines).toHaveLength(2);
  });

  it('offers a template that validates', () => {
    expect(validateVoterCsv(voterCsvTemplate(), none())).toMatchObject({
      missingColumns: [],
      validRows: 1,
    });
  });

  it('validates 10,000 rows well under 30 seconds', () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => [
      `Mpiga kura ${i}`,
      `M-${i}`,
      `07${String(10_000_000 + i).slice(-8)}`,
      i % 2 ? 'Male' : 'Female',
      '',
      '',
      i % 3 ? '' : 'Mwenyekiti',
    ]);
    const started = performance.now();
    const result = validateVoterCsv(csv(rows), none());
    const seconds = (performance.now() - started) / 1000;
    expect(result).toMatchObject({ totalRows: 10_000, validRows: 10_000, errorRows: 0 });
    expect(seconds).toBeLessThan(30);
  });
});
