// The password part of AUTH-02 and AUTH-04: password, confirmation and the live rule checklist.
import { failedPasswordRules } from '@vote-kidigit/shared';
import { Form, Input } from 'antd';
import { useTranslation } from 'react-i18next';
import { PasswordRules } from '../../auth/PasswordRules';

export interface PasswordValues {
  password: string;
  confirm: string;
}

export function PasswordFields({
  reused,
  newLabel = false,
}: {
  reused: boolean;
  newLabel?: boolean;
}) {
  const { t } = useTranslation();
  const password = Form.useWatch<string | undefined>('password') ?? '';
  return (
    <>
      <Form.Item
        name="password"
        label={t(newLabel ? 'auth.newPassword' : 'auth.password')}
        validateStatus={reused ? 'error' : undefined}
        help={reused ? t('auth.reset.reused') : undefined}
        rules={[
          {
            validator: (_, value: unknown) =>
              typeof value === 'string' && failedPasswordRules(value).length === 0
                ? Promise.resolve()
                : Promise.reject(new Error(t('auth.passwordWeak'))),
          },
        ]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <PasswordRules password={password} reused={reused} />
      <Form.Item
        name="confirm"
        label={t('auth.confirmPassword')}
        dependencies={['password']}
        rules={[
          ({ getFieldValue }) => ({
            validator: (_, value: unknown) =>
              value && value === getFieldValue('password')
                ? Promise.resolve()
                : Promise.reject(new Error(t('auth.passwordMismatch'))),
          }),
        ]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
    </>
  );
}
