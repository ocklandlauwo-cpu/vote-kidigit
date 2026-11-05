import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { RouterProvider } from 'react-router/dom';
import { createQueryClient } from './api/queryClient';
import { useEffectiveTheme } from './hooks/useEffectiveTheme';
import { i18n } from './i18n';
import { router } from './router';
import { darkTheme, lightTheme } from './theme';

/**
 * Providers: server state (TanStack Query), strings (i18next) and the theme (Design System 12.2).
 * AntApp gives message/notification the active theme. Ant Design has no Swahili locale; its own
 * few built-in texts stay English, while every product string comes from i18next.
 */
export function App() {
  const theme = useEffectiveTheme();
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <ConfigProvider theme={theme === 'dark' ? darkTheme : lightTheme} locale={enUS}>
          <AntApp>
            <RouterProvider router={router} />
          </AntApp>
        </ConfigProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}
