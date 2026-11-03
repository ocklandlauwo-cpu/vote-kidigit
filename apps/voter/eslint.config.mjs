// Root rules plus the React rules for this app (Tech Stack 5.4).
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import root from '../../eslint.config.mjs';

export default defineConfig(root, {
  files: ['src/**/*.{ts,tsx}'],
  extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
  languageOptions: { globals: globals.browser },
});
