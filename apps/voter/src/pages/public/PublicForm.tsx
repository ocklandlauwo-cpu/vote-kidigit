// The contact (PUB-04) and demo (PUB-05) form: labelled fields, one message per invalid field,
// focus on the first problem, an alert for failed sends, and a hidden honeypot for bots.
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { type FormEvent, useRef, useState } from 'react';
import { Button } from '../../components/vote/Button';
import {
  type ContactField,
  type FieldErrors,
  type FormKind,
  type FormValues,
  sendContact,
  sendErrorKey,
  serverFieldErrors,
  today,
  validateForm,
} from './contactForm';
import { type PublicKey, usePublicText } from './publicText';

interface FieldSpec {
  name: ContactField;
  label: PublicKey;
  type?: 'text' | 'email' | 'tel' | 'number' | 'date';
  autoComplete?: string;
  optional?: boolean;
  hint?: PublicKey;
  multiline?: boolean;
}

const FIELDS: Record<FormKind, FieldSpec[]> = {
  contact: [
    { name: 'name', label: 'form.name', autoComplete: 'name' },
    { name: 'email', label: 'form.email', type: 'email', autoComplete: 'email' },
    {
      name: 'phone',
      label: 'form.phone',
      type: 'tel',
      autoComplete: 'tel',
      optional: true,
      hint: 'form.phoneHint',
    },
    { name: 'message', label: 'form.message', multiline: true },
  ],
  demo: [
    { name: 'name', label: 'form.name', autoComplete: 'name' },
    { name: 'organization', label: 'form.organization', autoComplete: 'organization' },
    {
      name: 'phone',
      label: 'form.phone',
      type: 'tel',
      autoComplete: 'tel',
      hint: 'form.phoneHint',
    },
    { name: 'email', label: 'form.email', type: 'email', autoComplete: 'email' },
    { name: 'expectedVoters', label: 'form.expectedVoters', type: 'number' },
    { name: 'preferredDate', label: 'form.preferredDate', type: 'date' },
    { name: 'message', label: 'form.message', multiline: true, optional: true },
  ],
};

interface PublicFormProps {
  kind: FormKind;
  submitLabel: PublicKey;
  onSent: () => void;
}

export function PublicForm({ kind, submitLabel, onSent }: PublicFormProps) {
  const { t, language } = usePublicText();
  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [sendError, setSendError] = useState<PublicKey | null>(null);
  const [sending, setSending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fields = FIELDS[kind];

  const focusFirst = (found: FieldErrors) => {
    const first = fields.find((field) => found[field.name]);
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first.name}"]`)?.focus();
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    setSendError(null);
    const checked = validateForm(kind, values, language);
    if (checked.errors) {
      setErrors(checked.errors);
      focusFirst(checked.errors);
      return;
    }
    setErrors({});
    setSending(true);
    try {
      await sendContact(checked.body);
      onSent();
    } catch (error) {
      const fromServer = serverFieldErrors(error);
      if (Object.keys(fromServer).length > 0) {
        setErrors(fromServer);
        focusFirst(fromServer);
      } else {
        setSendError(sendErrorKey(error));
      }
    } finally {
      setSending(false);
    }
  }

  const hasErrors = Object.keys(errors).length > 0;
  return (
    <form ref={formRef} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
      {(hasErrors || sendError) && (
        <p role="alert" className="vk-alert flex items-center gap-2" data-tone="danger">
          <ExclamationCircleOutlined aria-hidden />
          {t(sendError ?? 'form.errorSummary')}
        </p>
      )}
      {fields.map((field) => {
        const id = `${kind}-${field.name}`;
        const error = errors[field.name];
        const describedBy =
          [error ? `${id}-error` : null, field.hint ? `${id}-hint` : null]
            .filter(Boolean)
            .join(' ') || undefined;
        const common = {
          id,
          name: field.name,
          value: values[field.name] ?? '',
          'aria-invalid': error ? true : undefined,
          'aria-required': field.optional ? undefined : true,
          'aria-describedby': describedBy,
          onChange: (e: { target: { value: string } }) =>
            setValues((current) => ({ ...current, [field.name]: e.target.value })),
        };
        return (
          <div key={field.name} className="flex flex-col gap-1">
            <label htmlFor={id} className="text-label font-medium">
              {t(field.label)}
              {field.optional && (
                <span className="ml-1 font-normal text-text-secondary">{t('form.optional')}</span>
              )}
            </label>
            {field.hint && (
              <span id={`${id}-hint`} className="text-body-sm text-text-secondary">
                {t(field.hint)}
              </span>
            )}
            {field.multiline ? (
              <textarea {...common} rows={5} maxLength={2000} className="vk-input vk-textarea" />
            ) : (
              <input
                {...common}
                type={field.type ?? 'text'}
                autoComplete={field.autoComplete}
                inputMode={field.type === 'number' ? 'numeric' : undefined}
                min={field.type === 'number' ? 1 : field.type === 'date' ? today() : undefined}
                className="vk-input"
              />
            )}
            {error && (
              <span
                id={`${id}-error`}
                className="flex items-center gap-1 text-body-sm text-danger-fg"
              >
                <ExclamationCircleOutlined aria-hidden />
                {t(error)}
              </span>
            )}
          </div>
        );
      })}
      {/* Honeypot: invisible and unreachable for people; bots that fill it are ignored. */}
      <div className="sr-only" aria-hidden="true">
        <label htmlFor={`${kind}-website`}>{t('form.honeypot')}</label>
        <input
          id={`${kind}-website`}
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={values.website ?? ''}
          onChange={(e) => setValues((current) => ({ ...current, website: e.target.value }))}
        />
      </div>
      <div>
        <Button type="submit" loading={sending} className="w-full sm:w-auto">
          {sending ? t('form.sending') : t(submitLabel)}
        </Button>
      </div>
    </form>
  );
}
