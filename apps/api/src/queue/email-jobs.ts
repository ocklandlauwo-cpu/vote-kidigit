// Jobs on the email queue. Payloads carry no link tokens: the worker creates the token when it
// sends the email, so a token exists only in the database (as a hash) and in the email.

export const EMAIL_JOB = {
  invitation: 'invitation',
  passwordReset: 'password-reset',
} as const;

/** Send (or resend) the invitation of a user with status 'invited'. */
export interface InvitationJob {
  userId: string;
  /** The user's organization; null for a platform administrator. */
  organizationId: string | null;
  /** Staff user who invited, for user_tokens.created_by. */
  invitedBy: string | null;
  requestId: string;
}

/** A forgot-password request; the worker decides whether the email belongs to an account. */
export interface PasswordResetJob {
  email: string;
  requestId: string;
}
