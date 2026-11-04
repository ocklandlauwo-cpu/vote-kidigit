import { describe, expect, it } from 'vitest';
import {
  failedPasswordRules,
  LoginRequestSchema,
  PasswordSchema,
  UpdateMeRequestSchema,
} from './auth.js';

describe('password policy (PRD USR-06)', () => {
  it('accepts at least 10 characters with upper, lower and a number', () => {
    expect(PasswordSchema.safeParse('Uchaguzi2027').success).toBe(true);
    expect(failedPasswordRules('Uchaguzi2027')).toEqual([]);
  });

  it.each([
    ['Short1a', ['length']],
    ['alllowercase1', ['upper']],
    ['ALLUPPERCASE1', ['lower']],
    ['NoNumbersHere', ['number']],
    ['', ['length', 'upper', 'lower', 'number']],
  ])('reports the rules %s fails', (password, failed) => {
    expect(failedPasswordRules(password)).toEqual(failed);
    expect(PasswordSchema.safeParse(password).success).toBe(false);
  });
});

describe('request schemas', () => {
  it('trims the login email but keeps the password as typed', () => {
    expect(LoginRequestSchema.parse({ email: ' a@b.tz ', password: ' p ' })).toEqual({
      email: 'a@b.tz',
      password: ' p ',
    });
  });

  it('requires at least one profile field and an E.164 phone', () => {
    expect(UpdateMeRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateMeRequestSchema.safeParse({ phone: '0712345678' }).success).toBe(false);
    expect(UpdateMeRequestSchema.parse({ phone: '+255712345678' })).toEqual({
      phone: '+255712345678',
    });
  });
});
