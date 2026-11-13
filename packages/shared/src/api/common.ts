import { z } from 'zod';

// Shared request and response building blocks (Backend Schema 12.1).

/** ?page=1&pageSize=50, page sizes 25 / 50 / 100. */
export const pageSizes = [25, 50, 100] as const;

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((size) => (pageSizes as readonly number[]).includes(size), 'must be 25, 50 or 100')
    .default(50),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/** { items, total, page, pageSize } */
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });
}

/** An IANA time zone name the runtime knows, e.g. Africa/Dar_es_Salaam. */
export const TimeZoneSchema = z.string().refine((zone) => {
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}, 'is not a known time zone');

/** Optional text the client may clear: an empty string and null both mean "none". */
export function optionalText<T extends z.ZodType<string>>(schema: T) {
  return z.preprocess((value) => (value === '' ? null : value), schema.nullable());
}

/** True for a well-formed UUID: ids taken from a URL are checked before they reach an API path. */
export function isUuid(value: unknown): value is string {
  return z.uuid().safeParse(value).success;
}
