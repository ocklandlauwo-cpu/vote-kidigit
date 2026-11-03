// Tech Stack 5.4: @eslint/js recommended + typescript-eslint recommended-type-checked
// + eslint-config-prettier. The two frontend apps add their React rules in step 2.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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
