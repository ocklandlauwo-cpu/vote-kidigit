// Avatar (Design System 8.11): initials of the first two names on one of six tinted backgrounds
// picked by a stable hash of the user ID. Photos arrive with files (step 17).
import { Avatar } from 'antd';
import { avatarTone, initials } from './avatar';

export function UserAvatar({
  userId,
  name,
  size = 32,
}: {
  userId: string;
  name: string;
  size?: 24 | 32 | 40 | 64;
}) {
  const tone = avatarTone(userId);
  return (
    <Avatar
      size={size}
      className={`vk-tone-${tone}`}
      data-tone={tone}
      style={{ background: 'var(--vk-tone-bg)', color: 'var(--vk-tone-fg)', fontWeight: 600 }}
      aria-hidden
    >
      {initials(name)}
    </Avatar>
  );
}
