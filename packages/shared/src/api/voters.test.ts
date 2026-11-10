import { describe, expect, it } from 'vitest';
import {
  BulkVotersRequestSchema,
  CreateVoterRequestSchema,
  formatVotingCode,
  maskPhone,
  normalizeMembershipId,
  normalizePhone,
  normalizeVotingCode,
  parseGender,
  VOTING_CODE_ALPHABET,
} from './voters.js';

describe('voter fields', () => {
  it('turns the usual ways of writing a Tanzanian mobile number into +255…', () => {
    for (const input of [
      '0712345678',
      '0712 345 678',
      '712345678',
      '255712345678',
      '+255 712-345-678',
      '(0712) 345678',
    ]) {
      expect(normalizePhone(input)).toBe('+255712345678');
    }
    expect(normalizePhone('0622000111')).toBe('+255622000111');
    for (const input of ['0512345678', '071234567', '07123456789', '+254712345678', 'simu', '']) {
      expect(normalizePhone(input)).toBeNull();
    }
  });

  it('reads gender in English and Swahili', () => {
    expect(['Male', 'm', 'Mwanaume', 'ME'].map(parseGender)).toEqual([
      'male',
      'male',
      'male',
      'male',
    ]);
    expect(['FEMALE', 'f', 'mwanamke', 'Ke'].map(parseGender)).toEqual([
      'female',
      'female',
      'female',
      'female',
    ]);
    expect(parseGender('other')).toBeNull();
  });

  it('normalizes membership IDs like the database does', () => {
    expect(normalizeMembershipId(' m-10 29 ')).toBe('M-1029');
  });

  it('masks the phone except the last 3 digits', () => {
    expect(maskPhone('+255712345678')).toBe('••••••••••678');
  });

  it('validates a new voter, normalizing the phone', () => {
    const parsed = CreateVoterRequestSchema.parse({
      fullName: ' Asha Mollel ',
      membershipId: 'M-1',
      phone: '0712 345 678',
      gender: 'female',
      email: '',
    });
    expect(parsed).toMatchObject({ fullName: 'Asha Mollel', phone: '+255712345678', email: null });
    const bad = CreateVoterRequestSchema.safeParse({
      fullName: '',
      membershipId: '  ',
      phone: '123',
      gender: 'x',
    });
    expect(bad.success ? [] : bad.error.issues.map((i) => i.path.join('.')).sort()).toEqual([
      'fullName',
      'gender',
      'membershipId',
      'phone',
    ]);
  });

  it('needs a category for assign and unassign only', () => {
    const id = '0190f0a1-2b3c-7d4e-8f90-000000000001';
    expect(BulkVotersRequestSchema.safeParse({ action: 'assign', voterIds: [id] }).success).toBe(
      false,
    );
    expect(
      BulkVotersRequestSchema.safeParse({ action: 'assign', voterIds: [id], categoryId: id })
        .success,
    ).toBe(true);
    expect(
      BulkVotersRequestSchema.safeParse({ action: 'delete', voterIds: [id], categoryId: id })
        .success,
    ).toBe(false);
  });
});

describe('voting codes (COD-01)', () => {
  it('uses no ambiguous characters', () => {
    for (const c of '01OIL') expect(VOTING_CODE_ALPHABET).not.toContain(c);
    expect(VOTING_CODE_ALPHABET).toHaveLength(31);
  });

  it('is typed with or without the dash, in any case, and shown as two groups', () => {
    expect(normalizeVotingCode(' k7m4-q9xr ')).toBe('K7M4Q9XR');
    expect(formatVotingCode('k7m4q9xr')).toBe('K7M4-Q9XR');
  });
});
