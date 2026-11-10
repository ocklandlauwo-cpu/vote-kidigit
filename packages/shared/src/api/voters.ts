// Voters, voting codes and CSV imports (Backend Schema 5.4, 7.7, 12.7; App Flow 6.5, 6.6;
// PRD VTR-01–VTR-09, COD-01–COD-06). The parsing rules here are used by the API, the CSV import
// worker and the staff forms alike, so a voter is judged the same way everywhere.
import { z } from 'zod';
import {
  CodeStatusSchema,
  type Gender,
  GenderSchema,
  ImportStatusSchema,
} from '../constants/enums.js';
import { EmailSchema } from './auth.js';
import { VoterMessageSchema } from './messages.js';
import { PaginationQuerySchema, pageSchema } from './common.js';

// ---------------------------------------------------------------------------------------------
// Voting codes (COD-01)
// ---------------------------------------------------------------------------------------------

/** 8 characters without 0, O, 1, I, L. */
export const VOTING_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const VOTING_CODE_LENGTH = 8;

/** What the voter typed, as stored for lookup: upper case, no dash or spaces. */
export function normalizeVotingCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** As shown in SMS and on screen: two groups, e.g. K7M4-Q9XR. */
export function formatVotingCode(code: string): string {
  const plain = normalizeVotingCode(code);
  return `${plain.slice(0, 4)}-${plain.slice(4)}`;
}

// ---------------------------------------------------------------------------------------------
// Voter fields (VTR-01, VTR-04)
// ---------------------------------------------------------------------------------------------

/**
 * A Tanzanian mobile number in E.164 (+2556… or +2557…), from the ways people write it:
 * 0712 345 678, 712345678, 255712345678, +255 712-345-678. Null when it is not one.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.trim().replace(/[\s\-().]/g, '');
  const match = /^(?:\+?255|0)?([67]\d{8})$/.exec(digits);
  return match ? `+255${match[1]}` : null;
}

/** Same rule as the database's generated column: upper case without spaces. */
export function normalizeMembershipId(input: string): string {
  return input.toUpperCase().replace(/\s/g, '');
}

/** Male / Female, also M / F and Swahili Mwanaume / Mwanamke (Me / Ke). */
export function parseGender(input: string): Gender | null {
  const value = input.trim().toLowerCase();
  if (['male', 'm', 'mwanaume', 'me'].includes(value)) return 'male';
  if (['female', 'f', 'mwanamke', 'ke'].includes(value)) return 'female';
  return null;
}

export const VOTER_NAME_MAX = 150;
export const MEMBERSHIP_ID_MAX = 50;

const fullName = z.string().trim().min(1).max(VOTER_NAME_MAX);
const membershipId = z.string().trim().min(1).max(MEMBERSHIP_ID_MAX);
/** Accepts the usual ways of writing a number and turns it into +255… */
export const VoterPhoneSchema = z.string().transform((value, ctx) => {
  const phone = normalizePhone(value);
  if (!phone) {
    ctx.addIssue({ code: 'custom', message: 'must be a Tanzanian mobile number' });
    return z.NEVER;
  }
  return phone;
});
const email = z.union([z.literal('').transform(() => null), EmailSchema]).nullable();

export const CreateVoterRequestSchema = z
  .object({
    fullName,
    membershipId,
    phone: VoterPhoneSchema,
    gender: GenderSchema,
    email: email.optional(),
    /** Categories with "selected" eligibility this voter joins (VTR-08). */
    categoryIds: z.array(z.uuid()).max(200).optional(),
  })
  .strict();
export type CreateVoterRequest = z.input<typeof CreateVoterRequestSchema>;

export const UpdateVoterRequestSchema = z
  .object({
    fullName: fullName.optional(),
    membershipId: membershipId.optional(),
    phone: VoterPhoneSchema.optional(),
    gender: GenderSchema.optional(),
    email: email.optional(),
  })
  .strict();
export type UpdateVoterRequest = z.input<typeof UpdateVoterRequestSchema>;

/** Phone shown in lists: everything but the last 3 digits hidden (App Flow 6.5). */
export function maskPhone(phone: string): string {
  return `${'•'.repeat(Math.max(0, phone.length - 3))}${phone.slice(-3)}`;
}

export const VoterSummarySchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  membershipId: z.string(),
  phoneMasked: z.string(),
  gender: GenderSchema,
  photoUrl: z.string().nullable(),
  /** Categories this voter was selected for (categories with "all" apply to everyone). */
  categoryIds: z.array(z.uuid()),
  codeStatus: CodeStatusSchema,
  codeGeneratedAt: z.iso.datetime().nullable(),
});
export type VoterSummary = z.infer<typeof VoterSummarySchema>;

/** EVT-05a: everything staff may see. The voting code itself is never returned (COD-02). */
export const VoterDetailSchema = VoterSummarySchema.extend({
  phone: z.string(),
  email: z.string().nullable(),
  codeLastSentAt: z.iso.datetime().nullable(),
  failedAttempts: z.number().int(),
  lockedUntil: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  /** SMS and email history, newest first (the last 20). */
  messages: z.array(VoterMessageSchema),
});
export type VoterDetail = z.infer<typeof VoterDetailSchema>;

export const VoterListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  categoryId: z.uuid().optional(),
  gender: GenderSchema.optional(),
  codeStatus: CodeStatusSchema.optional(),
});
export type VoterListQuery = z.infer<typeof VoterListQuerySchema>;

export const VoterTotalsSchema = z.object({
  registered: z.number().int(),
  male: z.number().int(),
  female: z.number().int(),
});
export type VoterTotals = z.infer<typeof VoterTotalsSchema>;

export const VoterPageSchema = pageSchema(VoterSummarySchema).extend({
  totals: VoterTotalsSchema,
});
export type VoterPage = z.infer<typeof VoterPageSchema>;

/** Bulk actions on selected rows (App Flow 6.5). */
export const bulkVoterActions = ['assign', 'unassign', 'delete'] as const;
export const BulkVotersRequestSchema = z
  .object({
    action: z.enum(bulkVoterActions),
    voterIds: z.array(z.uuid()).min(1).max(20_000),
    categoryId: z.uuid().optional(),
  })
  .strict()
  .refine((value) => (value.action === 'delete') === (value.categoryId === undefined), {
    message: 'categoryId goes with assign and unassign',
    path: ['categoryId'],
  });
export type BulkVotersRequest = z.infer<typeof BulkVotersRequestSchema>;

export const BulkVotersResponseSchema = z.object({ affected: z.number().int() });
export type BulkVotersResponse = z.infer<typeof BulkVotersResponseSchema>;

// ---------------------------------------------------------------------------------------------
// CSV import (VTR-02–VTR-05, VTR-09)
// ---------------------------------------------------------------------------------------------

/** Template columns in order (PRD VTR-02, VTR-09). */
export const VOTER_CSV_COLUMNS = [
  'full_name',
  'membership_id',
  'phone',
  'gender',
  'email',
  'photo_file',
  'categories',
] as const;
export type VoterCsvColumn = (typeof VOTER_CSV_COLUMNS)[number];
export const REQUIRED_VOTER_CSV_COLUMNS: VoterCsvColumn[] = [
  'full_name',
  'membership_id',
  'phone',
  'gender',
];

export const importProblemCodes = [
  'required',
  'too_long',
  'invalid_phone',
  'invalid_gender',
  'invalid_email',
  'duplicate_in_file',
  'membership_exists',
  'unknown_category',
  'duplicate_phone',
] as const;
export type ImportProblemCode = (typeof importProblemCodes)[number];

/** Errors skip the row; warnings import it (VTR-04: a phone shared by voters is allowed). */
export const ImportProblemSchema = z.object({
  /** 1-based data row, as a spreadsheet shows it under the header (row 2 = first voter). */
  row: z.number().int(),
  field: z.string(),
  code: z.enum(importProblemCodes),
  severity: z.enum(['error', 'warning']),
});
export type ImportProblem = z.infer<typeof ImportProblemSchema>;

export const ImportQuerySchema = PaginationQuerySchema.extend({
  severity: z.enum(['error', 'warning']).optional(),
});
export type ImportQuery = z.infer<typeof ImportQuerySchema>;

export const VoterImportSchema = z.object({
  id: z.uuid(),
  status: ImportStatusSchema,
  fileName: z.string().nullable(),
  totalRows: z.number().int(),
  validRows: z.number().int(),
  warningRows: z.number().int(),
  errorRows: z.number().int(),
  importedRows: z.number().int(),
  /** Why the file could not be read at all (missing columns, not a CSV…). */
  failureReason: z.string().nullable(),
  missingColumns: z.array(z.string()),
  problems: pageSchema(ImportProblemSchema),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export type VoterImport = z.infer<typeof VoterImportSchema>;

export const CreateImportResponseSchema = z.object({ id: z.uuid() });
export type CreateImportResponse = z.infer<typeof CreateImportResponseSchema>;
