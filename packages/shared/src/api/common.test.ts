import { describe, expect, it } from 'vitest';
import { PaginationQuerySchema, TimeZoneSchema } from './common.js';
import { CreateOrganizationRequestSchema, UpdateOrganizationRequestSchema } from './platform.js';

describe('pagination', () => {
  it('defaults to page 1 of 50 and coerces query strings', () => {
    expect(PaginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 50 });
    expect(PaginationQuerySchema.parse({ page: '3', pageSize: '25' })).toEqual({
      page: 3,
      pageSize: 25,
    });
  });

  it('allows only page sizes 25, 50 and 100', () => {
    expect(PaginationQuerySchema.safeParse({ pageSize: '30' }).success).toBe(false);
    expect(PaginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });
});

describe('time zones', () => {
  it('accepts IANA names and rejects others', () => {
    expect(TimeZoneSchema.safeParse('Africa/Dar_es_Salaam').success).toBe(true);
    expect(TimeZoneSchema.safeParse('UTC').success).toBe(true);
    expect(TimeZoneSchema.safeParse('Mars/Olympus').success).toBe(false);
    expect(TimeZoneSchema.safeParse('').success).toBe(false);
  });
});

describe('organization requests', () => {
  const base = { name: 'Chama', superAdmin: { fullName: 'Neema', email: ' Neema@Example.TEST ' } };

  it('defaults the time zone and normalizes the email', () => {
    const parsed = CreateOrganizationRequestSchema.parse(base);
    expect(parsed.timeZone).toBe('Africa/Dar_es_Salaam');
    expect(parsed.superAdmin.email).toBe('neema@example.test');
  });

  it('treats an empty optional field as cleared', () => {
    expect(UpdateOrganizationRequestSchema.parse({ contactPhone: '' })).toEqual({
      contactPhone: null,
    });
    expect(UpdateOrganizationRequestSchema.safeParse({}).success).toBe(false);
  });
});
