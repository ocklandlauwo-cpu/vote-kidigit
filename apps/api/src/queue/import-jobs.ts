// Jobs on the imports queue (CSV voter imports, App Flow 6.6). The payload names the import; the
// file itself is read from storage by the worker.

export const IMPORT_JOB = {
  validate: 'validate',
  confirm: 'confirm',
} as const;

export interface ImportJob {
  importId: string;
  organizationId: string;
  requestId: string;
}
