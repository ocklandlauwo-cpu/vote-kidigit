// Contact (PUB-04) and demo (PUB-05) form logic: the shared schema judges the fields, each field
// gets one message from the public strings, and send failures map to their own words.
import {
  type Language,
  type PublicContactRequest,
  PublicContactRequestSchema,
} from '@vote-kidigit/shared';
import { isVoterApiError, voterApi } from '../../api/client';
import type { PublicKey } from './publicText';

export const CONTACT_FIELDS = [
  'name',
  'organization',
  'phone',
  'email',
  'expectedVoters',
  'preferredDate',
  'message',
] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];
export type FormValues = Partial<Record<ContactField, string>> & { website?: string };
export type FieldErrors = Partial<Record<ContactField, PublicKey>>;
export type FormKind = PublicContactRequest['kind'];

const isField = (value: unknown): value is ContactField =>
  (CONTACT_FIELDS as readonly unknown[]).includes(value);

function fieldMessage(field: ContactField, code: string | undefined): PublicKey {
  if (field === 'message' && code === 'too_big') return 'form.errors.messageLong';
  return `form.errors.${field}`;
}

/** Today in the visitor's own calendar, as YYYY-MM-DD (the date picker's minimum). */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function toBody(kind: FormKind, values: FormValues, language: Language): Record<string, unknown> {
  const text = (field: ContactField) => values[field] ?? '';
  const common = {
    kind,
    name: text('name'),
    email: text('email'),
    phone: text('phone'),
    message: text('message'),
    language,
    website: values.website ?? '',
  };
  if (kind === 'contact') return common;
  const voters = text('expectedVoters').trim();
  return {
    ...common,
    organization: text('organization'),
    expectedVoters: /^\d{1,9}$/.test(voters) ? Number(voters) : Number.NaN,
    preferredDate: text('preferredDate'),
  };
}

/** The request to send, or one message per invalid field (in form order). */
export function validateForm(
  kind: FormKind,
  values: FormValues,
  language: Language,
  now = new Date(),
): { body: PublicContactRequest; errors: null } | { body: null; errors: FieldErrors } {
  const result = PublicContactRequestSchema.safeParse(toBody(kind, values, language));
  const errors: FieldErrors = {};
  if (!result.success) {
    for (const issue of result.error.issues) {
      const [field] = issue.path;
      if (isField(field) && !errors[field]) errors[field] = fieldMessage(field, issue.code);
    }
  } else if (result.data.kind === 'demo' && result.data.preferredDate < today(now)) {
    errors.preferredDate = 'form.errors.preferredDate';
  }
  return Object.keys(errors).length > 0 || !result.success
    ? { body: null, errors }
    : { body: result.data, errors: null };
}

/** Field messages from a server VALIDATION_FAILED answer (paths such as "phone"). */
export function serverFieldErrors(error: unknown): FieldErrors {
  const errors: FieldErrors = {};
  if (!isVoterApiError(error, 'VALIDATION_FAILED')) return errors;
  const issues = error.details.issues;
  if (!Array.isArray(issues)) return errors;
  for (const issue of issues as { path?: unknown; code?: unknown }[]) {
    const field = typeof issue.path === 'string' ? issue.path.split('.')[0] : undefined;
    if (isField(field) && !errors[field]) {
      errors[field] = fieldMessage(field, typeof issue.code === 'string' ? issue.code : undefined);
    }
  }
  return errors;
}

/** Words for a failed send that is not about a field. */
export function sendErrorKey(error: unknown): PublicKey {
  if (isVoterApiError(error, 'RATE_LIMITED')) return 'form.sendErrors.rate';
  if (isVoterApiError(error, 'NETWORK')) return 'form.sendErrors.network';
  return 'form.sendErrors.other';
}

export function sendContact(body: PublicContactRequest): Promise<void> {
  return voterApi('/v1/public/contact', { method: 'POST', body });
}
