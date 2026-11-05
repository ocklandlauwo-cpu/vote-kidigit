// Live password rule checklist (App Flow 4.3: AUTH-02, AUTH-04). The last-5 rule can only be
// checked by the server; it turns red when the server answers PASSWORD_REUSED.
import { CheckCircleFilled, CloseCircleFilled, MinusCircleOutlined } from '@ant-design/icons';
import { failedPasswordRules, passwordRules } from '@vote-kidigit/shared';
import { useTranslation } from 'react-i18next';

export function PasswordRules({
  password,
  showHistory = true,
  reused = false,
}: {
  password: string;
  showHistory?: boolean;
  reused?: boolean;
}) {
  const { t } = useTranslation();
  const failed = new Set(failedPasswordRules(password));
  return (
    <div>
      <p style={{ margin: '0 0 var(--vk-space-1)', color: 'var(--vk-text-secondary)' }}>
        {t('auth.rules.title')}
      </p>
      <ul className="vk-rule-list" aria-live="polite">
        {passwordRules.map((rule) => {
          const met = password.length > 0 && !failed.has(rule.key);
          return (
            <li key={rule.key} data-rule={rule.key} data-met={met}>
              {met ? <CheckCircleFilled aria-hidden /> : <MinusCircleOutlined aria-hidden />}
              <span>{t(`auth.rules.${rule.key}`)}</span>
              <span className="vk-visually-hidden">
                {t(met ? 'auth.rules.met' : 'auth.rules.notMet')}
              </span>
            </li>
          );
        })}
        {showHistory && (
          <li
            data-rule="history"
            data-met={false}
            style={reused ? { color: 'var(--vk-danger-fg)' } : undefined}
          >
            {reused ? <CloseCircleFilled aria-hidden /> : <MinusCircleOutlined aria-hidden />}
            <span>{t('auth.rules.history')}</span>
          </li>
        )}
      </ul>
    </div>
  );
}
