// Kiosk on-screen keypad (App Flow 10.2 KSK-02): large keys for membership IDs (letters, digits,
// dash), codes, PINs (digits only) and phone numbers. Physical keyboards still work in the field.
import { CloseOutlined, LeftOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

interface KeypadProps {
  mode: 'alnum' | 'numeric';
  onKey: (key: string) => void;
  onBackspace: () => void;
  onClear: () => void;
}

export function Keypad({ mode, onKey, onBackspace, onClear }: KeypadProps) {
  const { t } = useTranslation();
  const keys = mode === 'numeric' ? DIGITS : [...DIGITS, ...LETTERS, '-'];
  return (
    <div
      className={`vk-keypad ${mode === 'numeric' ? 'vk-keypad--numeric' : ''}`}
      role="group"
      aria-label={t('kiosk.keypad')}
    >
      {keys.map((key) => (
        <button key={key} type="button" className="vk-key" onClick={() => onKey(key)}>
          {key}
        </button>
      ))}
      <button
        type="button"
        className="vk-key"
        onClick={onBackspace}
        aria-label={t('kiosk.backspace')}
      >
        <LeftOutlined aria-hidden />
      </button>
      <button type="button" className="vk-key" onClick={onClear} aria-label={t('kiosk.clear')}>
        <CloseOutlined aria-hidden />
      </button>
    </div>
  );
}
