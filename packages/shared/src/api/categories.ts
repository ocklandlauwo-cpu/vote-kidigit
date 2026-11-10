// Categories and contesters (Backend Schema 12.6, App Flow 6.4, PRD CAT-01–CAT-08, RUL-01–RUL-07).
import { z } from 'zod';
import {
  CategoryManualStateSchema,
  ContesterStatusSchema,
  EligibilityModeSchema,
  SelectionModeSchema,
  WinnerRuleSchema,
} from '../constants/enums.js';

/** The category status badge (Design System 3.3, App Flow 6.4). */
export const categoryStatuses = ['not_open', 'open', 'closed', 'inactive'] as const;
export const CategoryStatusSchema = z.enum(categoryStatuses);
export type CategoryStatus = z.infer<typeof CategoryStatusSchema>;

const isoDateTime = z.iso.datetime();
const count = z.number().int().min(1).max(100);
const percent = z.number().gt(0).lte(100).multipleOf(0.01);

const RulesShape = z.object({
  selectionMode: SelectionModeSchema,
  exactCount: count.nullable(),
  minCount: count.nullable(),
  maxCount: count.nullable(),
  seats: count,
  allowSkip: z.boolean(),
  winnerRule: WinnerRuleSchema,
  thresholdPct: percent.nullable(),
  quorumPct: percent.nullable(),
});
export type CategoryRules = z.infer<typeof RulesShape>;

/**
 * RUL-01–RUL-05 as one object. "Exactly N" needs N; "Between" needs min ≤ max; Threshold needs its
 * percentage. Counts against the contesters are checked by the publish checklist.
 */
export const CategoryRulesSchema = RulesShape.superRefine((rules, ctx) => {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });
  if (rules.selectionMode === 'exact' && rules.exactCount === null) {
    issue('exactCount', 'required for "exactly N"');
  }
  if (rules.selectionMode === 'range') {
    if (rules.minCount === null) issue('minCount', 'required for "between"');
    if (rules.maxCount === null) issue('maxCount', 'required for "between"');
    if (rules.minCount !== null && rules.maxCount !== null && rules.maxCount < rules.minCount) {
      issue('maxCount', 'must be at least the minimum');
    }
  }
  if (rules.winnerRule === 'threshold' && rules.thresholdPct === null) {
    issue('thresholdPct', 'required for the threshold rule');
  }
});

export const DEFAULT_CATEGORY_RULES: CategoryRules = {
  selectionMode: 'exact',
  exactCount: 1,
  minCount: null,
  maxCount: null,
  seats: 1,
  allowSkip: false,
  winnerRule: 'plurality',
  thresholdPct: null,
  quorumPct: null,
};

export const ContesterSchema = z.object({
  id: z.uuid(),
  categoryId: z.uuid(),
  fullName: z.string(),
  party: z.string().nullable(),
  photoUrl: z.string().nullable(),
  status: ContesterStatusSchema,
  withdrawnAt: isoDateTime.nullable(),
});
export type Contester = z.infer<typeof ContesterSchema>;

export const CategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  pictureUrl: z.string().nullable(),
  displayOrder: z.number().int(),
  isActive: z.boolean(),
  opensAt: isoDateTime.nullable(),
  closesAt: isoDateTime.nullable(),
  manualState: CategoryManualStateSchema,
  closedAt: isoDateTime.nullable(),
  status: CategoryStatusSchema,
  rules: RulesShape,
  eligibility: EligibilityModeSchema,
  /** Voters who may vote here: all event voters, or the selected ones. */
  eligibleVoters: z.number().int(),
  /** CAT-06: exactly one active contester makes it a Yes / No vote. */
  yesNo: z.boolean(),
  contesters: z.array(ContesterSchema),
});
export type Category = z.infer<typeof CategorySchema>;

export const CategoryListResponseSchema = z.object({ items: z.array(CategorySchema) });
export type CategoryListResponse = z.infer<typeof CategoryListResponseSchema>;

const categoryName = z.string().trim().min(1).max(100);
const windowFields = {
  opensAt: isoDateTime.nullable().optional(),
  closesAt: isoDateTime.nullable().optional(),
};
const windowRefine = (value: { opensAt?: string | null; closesAt?: string | null }) =>
  !value.opensAt || !value.closesAt || Date.parse(value.closesAt) > Date.parse(value.opensAt);
const windowIssue = { message: 'must be after the opening time', path: ['closesAt'] };

export const CreateCategoryRequestSchema = z
  .object({
    name: categoryName,
    isActive: z.boolean().optional(),
    ...windowFields,
    rules: CategoryRulesSchema.optional(),
  })
  .strict()
  .refine(windowRefine, windowIssue);
export type CreateCategoryRequest = z.infer<typeof CreateCategoryRequestSchema>;

export const UpdateCategoryRequestSchema = z
  .object({
    name: categoryName.optional(),
    isActive: z.boolean().optional(),
    ...windowFields,
    rules: CategoryRulesSchema.optional(),
  })
  .strict()
  .refine(windowRefine, windowIssue);
export type UpdateCategoryRequest = z.infer<typeof UpdateCategoryRequestSchema>;

export const ReorderCategoriesRequestSchema = z
  .object({ categoryIds: z.array(z.uuid()).min(1).max(200) })
  .strict()
  .refine((value) => new Set(value.categoryIds).size === value.categoryIds.length, {
    message: 'each category once',
    path: ['categoryIds'],
  });
export type ReorderCategoriesRequest = z.infer<typeof ReorderCategoriesRequestSchema>;

const voterIds = z.array(z.uuid()).max(20_000);

/** PUT …/eligibility (RUL-07): all event voters, or exactly the listed ones. */
export const SetEligibilityRequestSchema = z
  .object({ mode: EligibilityModeSchema, voterIds: voterIds.optional() })
  .strict()
  .refine((value) => (value.mode === 'selected') === (value.voterIds !== undefined), {
    message: 'voterIds goes with mode "selected" only',
    path: ['voterIds'],
  });
export type SetEligibilityRequest = z.infer<typeof SetEligibilityRequestSchema>;

/** PATCH …/eligibility: add or remove selected voters (the mode becomes "selected"). */
export const ChangeEligibilityRequestSchema = z
  .object({ add: voterIds.optional(), remove: voterIds.optional() })
  .strict();
export type ChangeEligibilityRequest = z.infer<typeof ChangeEligibilityRequestSchema>;

export const EligibilityResponseSchema = z.object({
  mode: EligibilityModeSchema,
  voterIds: z.array(z.uuid()),
});
export type EligibilityResponse = z.infer<typeof EligibilityResponseSchema>;

const contesterName = z.string().trim().min(1).max(120);
const party = z.string().trim().max(100).nullable().optional();

export const CreateContesterRequestSchema = z.object({ fullName: contesterName, party }).strict();
export type CreateContesterRequest = z.infer<typeof CreateContesterRequestSchema>;

export const UpdateContesterRequestSchema = z
  .object({ fullName: contesterName.optional(), party })
  .strict();
export type UpdateContesterRequest = z.infer<typeof UpdateContesterRequestSchema>;

/** Bulk photos (CAT-08): a ZIP whose image file names match the people's names. */
export const photoZipTargets = ['contesters', 'voters'] as const;
export const PhotoZipTargetSchema = z.enum(photoZipTargets);
export type PhotoZipTarget = z.infer<typeof PhotoZipTargetSchema>;
export const PhotoZipRequestSchema = z.object({ target: PhotoZipTargetSchema }).strict();
export type PhotoZipRequest = z.infer<typeof PhotoZipRequestSchema>;

export const photoZipProblems = ['no_match', 'ambiguous', 'not_image', 'too_large'] as const;
export const PhotoZipResultSchema = z.object({
  matched: z.array(z.object({ fileName: z.string(), id: z.uuid(), name: z.string() })),
  unmatched: z.array(z.object({ fileName: z.string(), problem: z.enum(photoZipProblems) })),
});
export type PhotoZipResult = z.infer<typeof PhotoZipResultSchema>;

/** Bulk ZIP limits: the archive, and the number of files in it. */
export const PHOTO_ZIP_MAX_BYTES = 50 * 1024 * 1024;
export const PHOTO_ZIP_MAX_FILES = 500;

/** Name matching for bulk photos: case, accents, punctuation and spacing are ignored. */
export function normalizePersonName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
