import { App as AntApp, ConfigProvider } from 'antd';
import { RouterProvider } from 'react-router/dom';
import { useEffectiveTheme } from './hooks/useEffectiveTheme';
import { router } from './router';
import { darkTheme, lightTheme } from './theme';

/** Theme provider (Design System 12.2): AntApp gives message/notification the active theme. */
export function App() {
  const theme = useEffectiveTheme();
  return (
    <ConfigProvider theme={theme === 'dark' ? darkTheme : lightTheme}>
      <AntApp>
        <RouterProvider router={router} />
      </AntApp>
    </ConfigProvider>
  );
}
