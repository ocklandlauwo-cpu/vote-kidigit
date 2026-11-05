// Language switch (Design System 8.2): Dropdown with "Kiswahili" and "English", each in its own
// language. Saved on this device and, when signed in, in the user's profile.
import { GlobalOutlined } from '@ant-design/icons';
import { languages } from '@vote-kidigit/shared';
import { Button, Dropdown } from 'antd';
import { useTranslation } from 'react-i18next';
import { useChangeLanguage } from '../auth/useAuth';
import { currentLanguage } from '../i18n';

export function LanguageSwitch() {
  const { t } = useTranslation();
  const change = useChangeLanguage();
  const active = currentLanguage();
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        selectable: true,
        selectedKeys: [active],
        items: languages.map((language) => ({
          key: language,
          label: <span lang={language}>{t(`language.${language}`)}</span>,
        })),
        onClick: ({ key }) => {
          if (key === 'sw' || key === 'en') change.mutate(key);
        },
      }}
    >
      <Button
        color="default"
        variant="text"
        icon={<GlobalOutlined />}
        aria-label={t('topbar.language')}
      >
        {t(`language.${active}`)}
      </Button>
    </Dropdown>
  );
}
