import { z } from 'zod';

// Staff authentication and profile (Backend Schema 8.1, 12.2; PRD USR-05–USR-09).

/** Password rules (PRD USR-06), in the order the live checklist shows them (App Flow 4.3). */
export const passwordRules = [
  { key: 'length', test: (value: string) => value.length >= 10 },
  { key: 'upper', test: (value: string) => /[A-Z]/.test(value) },
  { key: 'lower', test: (value: string) => /[a-z]/.test(value) },
  { key: 'number', test: (value: string) => /\d/.test(value) },
] as const;

export type PasswordRuleKey = (typeof passwordRules)[number]['key'];

/** Policy rules a password fails (empty when it is acceptable). Reuse is checked by the API. */
export function failedPasswordRules(value: string): PasswordRuleKey[] {
  return passwordRules.filter((rule) => !rule.test(value)).map((rule) => rule.key);
}

export const PasswordSchema = z
  .string()
  .max(128, 'must be at most 128 characters')
  .refine((value) => failedPasswordRules(value).length === 0, {
    message:
      'must be at least 10 characters with an upper-case letter, a lower-case letter and a number',
  });

export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** E.164, e.g. +255712345678 */
export const PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'must be in +255… format');

export const LanguageSchema = z.enum(['sw', 'en']);
export const ThemePreferenceSchema = z.enum(['system', 'light', 'dark']);

export const LoginRequestSchema = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const UpdateMeRequestSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    phone: PhoneSchema.nullable(),
    language: LanguageSchema,
    themePreference: ThemePreferenceSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'nothing to update');
export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: PasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

/** GET /me and the login response: who is signed in and what they may do. */
export const MeResponseSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  language: LanguageSchema,
  themePreference: ThemePreferenceSchema,
  isPlatformAdmin: z.boolean(),
  isOrgSuperAdmin: z.boolean(),
  organization: z
    .object({
      id: z.uuid(),
      name: z.string(),
      slug: z.string(),
      timeZone: z.string(),
      primaryColor: z.string().nullable(),
      sessionTimeoutMinutes: z.number().int(),
    })
    .nullable(),
  role: z.object({ id: z.uuid(), name: z.string(), systemKey: z.string().nullable() }).nullable(),
  /** Permission keys (Backend Schema 9.1). */
  permissions: z.array(z.string()),
  /** Events the user is mapped to as moderator or observer. */
  mappedEventIds: z.array(z.uuid()),
  /** Send as X-CSRF-Token on every state-changing request. */
  csrfToken: z.string(),
  /** When the session ends without further activity (also in the X-Session-Expires header). */
  sessionExpiresAt: z.iso.datetime(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const SESSION_EXPIRES_HEADER = 'X-Session-Expires';
export const CSRF_HEADER = 'X-CSRF-Token';

// Invitations and password reset (Backend Schema 8.2).

/** 32 random bytes, base64url: the token in /app/invite/{token} and /app/reset/{token}. */
export const UserTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'is not a valid link token');

export const userTokenPurposes = ['invite', 'password_reset'] as const;
export type UserTokenPurpose = (typeof userTokenPurposes)[number];

/** Invitation links last 48 hours, reset links 60 minutes (PRD USR-02, App Flow AUTH-04). */
export const TOKEN_LIFETIME_MINUTES: Record<UserTokenPurpose, number> = {
  invite: 48 * 60,
  password_reset: 60,
};

export const ForgotPasswordRequestSchema = z.object({ email: EmailSchema });
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

/** GET /auth/tokens/{token}: what the set-password screens show. */
export const TokenInfoResponseSchema = z.object({
  purpose: z.enum(userTokenPurposes),
  fullName: z.string(),
  email: z.string(),
  organizationName: z.string().nullable(),
  expiresAt: z.iso.datetime(),
});
export type TokenInfoResponse = z.infer<typeof TokenInfoResponseSchema>;

export const AcceptInviteRequestSchema = z.object({
  token: UserTokenSchema,
  fullName: z.string().trim().min(2).max(120),
  password: PasswordSchema,
});
export type AcceptInviteRequest = z.infer<typeof AcceptInviteRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  token: UserTokenSchema,
  password: PasswordSchema,
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;
