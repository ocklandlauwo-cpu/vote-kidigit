// Profile menu (Design System 8.2, App Flow 3.2): avatar opening name, email, Profile and Sign out.
import { LogoutOutlined, UserOutlined } from '@ant-design/icons';
import type { MeResponse } from '@vote-kidigit/shared';
import { Button, Dropdown } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useSignOut } from '../auth/useAuth';
import { UserAvatar } from '../components/UserAvatar';

export function ProfileMenu({ me }: { me: MeResponse }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const signOut = useSignOut();
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: [
          {
            key: 'who',
            type: 'group',
            label: (
              <span>
                <span style={{ display: 'block', color: 'var(--vk-text)' }}>{me.fullName}</span>
                <span style={{ color: 'var(--vk-text-tertiary)' }}>{me.email}</span>
              </span>
            ),
          },
          { type: 'divider' },
          { key: 'profile', icon: <UserOutlined />, label: t('nav.profile') },
          { key: 'signOut', icon: <LogoutOutlined />, label: t('topbar.signOut') },
        ],
        onClick: ({ key }) => {
          if (key === 'profile') void navigate('/profile');
          if (key === 'signOut') {
            signOut.mutate(undefined, {
              onSettled: () => void navigate('/login?reason=signedOut', { replace: true }),
            });
          }
        },
      }}
    >
      <Button
        type="text"
        shape="circle"
        aria-label={t('topbar.profileMenu')}
        icon={<UserAvatar userId={me.id} name={me.fullName} />}
      />
    </Dropdown>
  );
}
