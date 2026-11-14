import type { FormInstance } from 'antd';
import { isApiError } from './client';

/**
 * Shows the field issues of a VALIDATION_FAILED answer on the form fields they name. `messages`
 * maps an API path (and optionally its code, "email:taken") to the field's text; unmapped
 * issues are left to the caller's banner. Returns true when every issue found a field.
 */
export function applyFieldErrors(
  form: FormInstance,
  error: unknown,
  messages: Record<string, string>,
): boolean {
  if (!isApiError(error, 'VALIDATION_FAILED') || error.issues.length === 0) return false;
  let all = true;
  // A nested path ("superAdmin.email") names a nested field: ['superAdmin', 'email'].
  const fields: { name: string[]; errors: string[] }[] = [];
  for (const issue of error.issues) {
    const text = messages[`${issue.path}:${issue.code}`] ?? messages[issue.path];
    if (!text) {
      all = false;
      continue;
    }
    fields.push({ name: issue.path.split('.'), errors: [text] });
  }
  form.setFields(fields);
  return all;
}
