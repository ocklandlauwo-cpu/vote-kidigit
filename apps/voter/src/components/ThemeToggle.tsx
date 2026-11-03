// Light / dark toggle for the voter header (Design System 12.4): 40 px icon button, MoonOutlined
// in light mode and SunOutlined in dark mode; sets the opposite explicit theme. Hidden on kiosk.
import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import { toggleTheme } from '@vote-kidigit/shared';
import { useEffectiveTheme } from '../hooks/useEffectiveTheme';

const LABEL = 'Badili mwonekano';

export function ThemeToggle() {
  const theme = useEffectiveTheme();
  const Icon = theme === 'dark' ? SunOutlined : MoonOutlined;
  return (
    <button
      type="button"
      aria-label={LABEL}
      title={LABEL}
      onClick={() => toggleTheme()}
      className="inline-flex size-10 items-center justify-center rounded-md text-text-secondary transition-colors duration-(--vk-duration-fast) hover:bg-surface-muted hover:text-text"
    >
      <Icon aria-hidden="true" style={{ fontSize: 20 }} />
    </button>
  );
}
