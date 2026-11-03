// Tech Stack 5.4: @eslint/js recommended + typescript-eslint recommended-type-checked
// + eslint-config-prettier. The two frontend apps add their React rules in step 2.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Design System 1.1 rule 1: components use tokens, never raw values. Applied to apps/*/src by
// the app configs; raw values live only in packages/shared/src/design (tokens.css, tokens.ts).
const HEX = '#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z])';
const RGB = '\\brgba?\\(';
const TAILWIND_ARBITRARY = '(?:^|[\\s:])!?-?[a-z][\\w-]*-\\[[^\\]]+\\]';
const tokenMessage =
  'Use design tokens (--vk-* variables, the Ant Design theme or Tailwind theme classes) instead of raw values (Design System 1.1).';
export const designTokenRules = {
  rules: {
    'no-restricted-syntax': [
      'error',
      ...[HEX, RGB].flatMap((pattern) => [
        { selector: `Literal[value=/${pattern}/]`, message: tokenMessage },
        { selector: `TemplateElement[value.raw=/${pattern}/]`, message: tokenMessage },
      ]),
      {
        selector: `Literal[value=/${TAILWIND_ARBITRARY}/]`,
        message: `No Tailwind arbitrary values such as text-[15px]. ${tokenMessage}`,
      },
      {
        selector: `TemplateElement[value.raw=/${TAILWIND_ARBITRARY}/]`,
        message: `No Tailwind arbitrary values such as text-[15px]. ${tokenMessage}`,
      },
    ],
  },
};

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/build/',
    '**/coverage/',
    '**/playwright-report/',
    '**/test-results/',
    'Documentations/',
    'docs/',
    'apps/api/src/generated/',
  ]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            '*.mjs',
            '*.cjs',
            '*.js',
            'playwright.config.ts',
            'scripts/*.mjs',
            'apps/api/scripts/*.mjs',
            'apps/api/prisma.config.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
