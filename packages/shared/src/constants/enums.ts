import { z } from 'zod';

// Fixed lists of the data model (Backend Schema 3), identical to the PostgreSQL enums and the
// Prisma enums in apps/api/prisma/schema.prisma; apps/api/src/database/enums.spec.ts checks
// that all three agree. Each enum exports its values, a Zod schema and a TypeScript type.

export const orgStatuses = ['active', 'suspended'] as const;
export const OrgStatusSchema = z.enum(orgStatuses);
export type OrgStatus = z.infer<typeof OrgStatusSchema>;

export const userStatuses = ['invited', 'active', 'deactivated'] as const;
export const UserStatusSchema = z.enum(userStatuses);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const assignmentTypes = ['moderator', 'observer'] as const;
export const AssignmentTypeSchema = z.enum(assignmentTypes);
export type AssignmentType = z.infer<typeof AssignmentTypeSchema>;

export const eventStatuses = [
  'draft',
  'scheduled',
  'open',
  'closed',
  'results_published',
  'cancelled',
  'archived',
] as const;
export const EventStatusSchema = z.enum(eventStatuses);
export type EventStatus = z.infer<typeof EventStatusSchema>;

export const resultsVisibilities = ['full', 'winners_only'] as const;
export const ResultsVisibilitySchema = z.enum(resultsVisibilities);
export type ResultsVisibility = z.infer<typeof ResultsVisibilitySchema>;

/** auto = follow opens_at / closes_at; open / closed = staff switch. */
export const categoryManualStates = ['auto', 'open', 'closed'] as const;
export const CategoryManualStateSchema = z.enum(categoryManualStates);
export type CategoryManualState = z.infer<typeof CategoryManualStateSchema>;

export const selectionModes = ['exact', 'range'] as const;
export const SelectionModeSchema = z.enum(selectionModes);
export type SelectionMode = z.infer<typeof SelectionModeSchema>;

export const winnerRules = ['plurality', 'threshold'] as const;
export const WinnerRuleSchema = z.enum(winnerRules);
export type WinnerRule = z.infer<typeof WinnerRuleSchema>;

export const eligibilityModes = ['all', 'selected'] as const;
export const EligibilityModeSchema = z.enum(eligibilityModes);
export type EligibilityMode = z.infer<typeof EligibilityModeSchema>;

export const contesterStatuses = ['active', 'withdrawn'] as const;
export const ContesterStatusSchema = z.enum(contesterStatuses);
export type ContesterStatus = z.infer<typeof ContesterStatusSchema>;

export const genders = ['male', 'female'] as const;
export const GenderSchema = z.enum(genders);
export type Gender = z.infer<typeof GenderSchema>;

export const codeStatuses = ['not_sent', 'sent', 'delivered', 'failed'] as const;
export const CodeStatusSchema = z.enum(codeStatuses);
export type CodeStatus = z.infer<typeof CodeStatusSchema>;

/** Stored on voter participation only, never on ballots. */
export const voteChannels = ['web', 'ussd', 'kiosk'] as const;
export const VoteChannelSchema = z.enum(voteChannels);
export type VoteChannel = z.infer<typeof VoteChannelSchema>;

export const choiceKinds = ['contester', 'yes', 'no', 'skipped'] as const;
export const ChoiceKindSchema = z.enum(choiceKinds);
export type ChoiceKind = z.infer<typeof ChoiceKindSchema>;

export const tieOutcomes = ['contester', 'no_winner'] as const;
export const TieOutcomeSchema = z.enum(tieOutcomes);
export type TieOutcome = z.infer<typeof TieOutcomeSchema>;

export const messageTypes = [
  'code_delivery',
  'reminder_before_open',
  'voting_open',
  'reminder_before_close',
  'vote_confirmation',
  'results_published',
  'event_cancelled',
  'event_extended',
] as const;
export const MessageTypeSchema = z.enum(messageTypes);
export type MessageType = z.infer<typeof MessageTypeSchema>;

export const messageChannels = ['sms', 'email'] as const;
export const MessageChannelSchema = z.enum(messageChannels);
export type MessageChannel = z.infer<typeof MessageChannelSchema>;

export const messageStatuses = ['queued', 'sent', 'delivered', 'failed'] as const;
export const MessageStatusSchema = z.enum(messageStatuses);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

export const batchAudiences = ['all', 'not_sent', 'failed', 'not_voted', 'single'] as const;
export const BatchAudienceSchema = z.enum(batchAudiences);
export type BatchAudience = z.infer<typeof BatchAudienceSchema>;

export const batchStatuses = ['queued', 'sending', 'paused', 'completed', 'cancelled'] as const;
export const BatchStatusSchema = z.enum(batchStatuses);
export type BatchStatus = z.infer<typeof BatchStatusSchema>;

export const importStatuses = [
  'uploaded',
  'validated',
  'importing',
  'completed',
  'failed',
  'abandoned',
] as const;
export const ImportStatusSchema = z.enum(importStatuses);
export type ImportStatus = z.infer<typeof ImportStatusSchema>;

export const reportTypes = ['results_pdf', 'voters_pdf', 'voters_xlsx', 'audit_xlsx'] as const;
export const ReportTypeSchema = z.enum(reportTypes);
export type ReportType = z.infer<typeof ReportTypeSchema>;

export const jobStatuses = ['queued', 'running', 'completed', 'failed'] as const;
export const JobStatusSchema = z.enum(jobStatuses);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const fileKinds = [
  'org_logo',
  'category_picture',
  'contester_photo',
  'voter_photo',
  'csv_import',
  'report',
] as const;
export const FileKindSchema = z.enum(fileKinds);
export type FileKind = z.infer<typeof FileKindSchema>;

export const actorTypes = ['user', 'voter', 'system'] as const;
export const ActorTypeSchema = z.enum(actorTypes);
export type ActorType = z.infer<typeof ActorTypeSchema>;

/** Every enum by its PostgreSQL type name, for checks that compare the three definitions. */
export const pgEnums = {
  org_status: orgStatuses,
  user_status: userStatuses,
  assignment_type: assignmentTypes,
  event_status: eventStatuses,
  results_visibility: resultsVisibilities,
  category_manual_state: categoryManualStates,
  selection_mode: selectionModes,
  winner_rule: winnerRules,
  eligibility_mode: eligibilityModes,
  contester_status: contesterStatuses,
  gender: genders,
  code_status: codeStatuses,
  vote_channel: voteChannels,
  choice_kind: choiceKinds,
  tie_outcome: tieOutcomes,
  message_type: messageTypes,
  message_channel: messageChannels,
  message_status: messageStatuses,
  batch_audience: batchAudiences,
  batch_status: batchStatuses,
  import_status: importStatuses,
  report_type: reportTypes,
  job_status: jobStatuses,
  file_kind: fileKinds,
  actor_type: actorTypes,
} as const satisfies Record<string, readonly string[]>;
