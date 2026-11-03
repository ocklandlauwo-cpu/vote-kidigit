// Root rules plus the React rules for this app (Tech Stack 5.4) and the design-token rule
// (Design System 1.1: no hex, rgb() or Tailwind arbitrary values in components).
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import root, { designTokenRules } from '../../eslint.config.mjs';

export default defineConfig(root, {
  files: ['src/**/*.{ts,tsx}'],
  extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite, designTokenRules],
  languageOptions: { globals: globals.browser },
});
