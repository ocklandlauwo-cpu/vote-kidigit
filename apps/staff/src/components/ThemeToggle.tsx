// Light / dark toggle for the top bar (Design System 6.2, 12.4): icon button M showing
// MoonOutlined in light mode and SunOutlined in dark mode; sets the opposite explicit theme.
// The label moves to i18next with the shell in step 13.
import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import { toggleTheme } from '@vote-kidigit/shared';
import { Button, Tooltip } from 'antd';
import { useEffectiveTheme } from '../hooks/useEffectiveTheme';

const LABEL = 'Badili mwonekano';

export function ThemeToggle() {
  const theme = useEffectiveTheme();
  return (
    <Tooltip title={LABEL}>
      <Button
        color="default"
        variant="text"
        aria-label={LABEL}
        icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
        onClick={() => toggleTheme()}
      />
    </Tooltip>
  );
}
