// Light / dark toggle for the top bar (Design System 6.2, 12.4): icon button M showing
// MoonOutlined in light mode and SunOutlined in dark mode; sets the opposite explicit theme.
import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import { toggleTheme } from '@vote-kidigit/shared';
import { Button, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { useEffectiveTheme } from '../hooks/useEffectiveTheme';

export function ThemeToggle() {
  const { t } = useTranslation();
  const theme = useEffectiveTheme();
  const label = t('topbar.theme');
  return (
    <Tooltip title={label}>
      <Button
        color="default"
        variant="text"
        aria-label={label}
        icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
        onClick={() => toggleTheme()}
      />
    </Tooltip>
  );
}
