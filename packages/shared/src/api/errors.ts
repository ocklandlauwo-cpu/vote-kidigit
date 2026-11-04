import { z } from 'zod';

// API error contract (Backend Schema 12.1). Every error response is
//   { "code": "VOTING_CLOSED", "message": "…", "details": { … } }
// The code is stable; frontends map it to the wording of the App Flow Document. The message is
// a plain English fallback for logs and API clients, never shown to voters as is.

export const errorCodes = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'ACCOUNT_INACTIVE',
  'ORG_SUSPENDED',
  'FORBIDDEN',
  'NOT_FOUND',
  'EVENT_LOCKED',
  'INVALID_TRANSITION',
  'CHECKLIST_FAILED',
  'CATEGORY_WINDOW_INVALID',
  'UNRESOLVED_TIES',
  'RESULTS_PUBLISHED',
  'IMMUTABLE_RECORD',
  'VOTING_CLOSED',
  'CATEGORY_CLOSED',
  'NOT_ELIGIBLE',
  'ALREADY_VOTED',
  'RULE_NOT_MET',
  'VOTER_LOCKED',
  'CHOOSE_EVENT',
  'TOKEN_EXPIRED',
  'TOKEN_USED',
  'PASSWORD_POLICY',
  'PASSWORD_REUSED',
  'LAST_SUPER_ADMIN',
  'ALT_PHONE_LIMIT',
  'KIOSK_PIN_INVALID',
  'FILE_TOO_LARGE',
  'FILE_TYPE',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export const ErrorCodeSchema = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** HTTP status for each code (Backend Schema 12.1: 400, 401, 403, 404, 409, 410, 422, 423, 429, 500). */
export const errorStatus: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_LOCKED: 423,
  ACCOUNT_INACTIVE: 403,
  ORG_SUSPENDED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EVENT_LOCKED: 409,
  INVALID_TRANSITION: 409,
  CHECKLIST_FAILED: 422,
  CATEGORY_WINDOW_INVALID: 422,
  UNRESOLVED_TIES: 409,
  RESULTS_PUBLISHED: 409,
  IMMUTABLE_RECORD: 409,
  VOTING_CLOSED: 409,
  CATEGORY_CLOSED: 409,
  NOT_ELIGIBLE: 403,
  ALREADY_VOTED: 409,
  RULE_NOT_MET: 422,
  VOTER_LOCKED: 423,
  CHOOSE_EVENT: 300,
  TOKEN_EXPIRED: 410,
  TOKEN_USED: 409,
  PASSWORD_POLICY: 422,
  PASSWORD_REUSED: 422,
  LAST_SUPER_ADMIN: 409,
  ALT_PHONE_LIMIT: 422,
  KIOSK_PIN_INVALID: 401,
  FILE_TOO_LARGE: 413,
  FILE_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** Default English messages; endpoints may pass a more specific one. */
export const errorMessages: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'The request is not valid.',
  UNAUTHENTICATED: 'Sign in to continue.',
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  ACCOUNT_LOCKED: 'The account is locked. Try again later.',
  ACCOUNT_INACTIVE: 'The account is inactive.',
  ORG_SUSPENDED: "The organization's access is suspended.",
  FORBIDDEN: 'You do not have permission to do this.',
  NOT_FOUND: 'Not found.',
  EVENT_LOCKED: 'The event is published and can no longer be changed.',
  INVALID_TRANSITION: 'This status change is not allowed.',
  CHECKLIST_FAILED: 'The event is not ready to publish.',
  CATEGORY_WINDOW_INVALID: 'The category window must lie within the event window.',
  UNRESOLVED_TIES: 'Resolve all ties before publishing results.',
  RESULTS_PUBLISHED: 'Results are published and can no longer be changed.',
  IMMUTABLE_RECORD: 'This record cannot be changed.',
  VOTING_CLOSED: 'Voting has closed.',
  CATEGORY_CLOSED: 'Voting in this category has closed.',
  NOT_ELIGIBLE: 'The voter is not eligible for this category.',
  ALREADY_VOTED: 'The voter has already voted in this category.',
  RULE_NOT_MET: 'The choices do not meet the rule of the category.',
  VOTER_LOCKED: 'Too many attempts. Try again later.',
  CHOOSE_EVENT: 'Choose the event to vote in.',
  TOKEN_EXPIRED: 'This link has expired.',
  TOKEN_USED: 'This link was already used.',
  PASSWORD_POLICY: 'The password does not meet the policy.',
  PASSWORD_REUSED: 'This password was used recently.',
  LAST_SUPER_ADMIN: 'The organization must keep at least one Org Super Admin.',
  ALT_PHONE_LIMIT: 'This phone number has received codes for too many voters.',
  KIOSK_PIN_INVALID: 'The staff PIN is incorrect.',
  FILE_TOO_LARGE: 'The file is too large.',
  FILE_TYPE: 'This file type is not accepted.',
  RATE_LIMITED: 'Too many requests. Try again later.',
  INTERNAL: 'Something went wrong on our side.',
};

export const ErrorResponseSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (errorCodes as readonly string[]).includes(value);
}
