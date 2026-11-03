// Vite plugin shared by the staff and voter apps (Design System 4.1, 12.4):
//  - copies the Inter font files from src/design/fonts into the app's public/fonts at start-up
//    (one committed copy; the app copies are git-ignored),
//  - injects the pre-paint theme script at the top of <head>,
//  - preloads the upright Inter file (respecting the app's base path).
// Only types it needs are declared here, so this package does not depend on Vite.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { THEME_PREPAINT_SCRIPT } from './src/design/theme.js';

// Both apps live at apps/<name>, so the fonts are found from the Vite project root
// (this package is CommonJS, where import.meta is not available).
const FONTS_FROM_APP_ROOT = '../../packages/shared/src/design/fonts';
const PRELOAD_FONT = 'InterVariable.woff2';

interface HtmlTag {
  tag: string;
  attrs?: Record<string, string | boolean>;
  children?: string;
  injectTo: 'head' | 'head-prepend';
}

interface DesignPlugin {
  name: string;
  configResolved(config: { base: string; publicDir: string; root: string }): void;
  buildStart(): void;
  transformIndexHtml(): HtmlTag[];
}

export function designSystem(): DesignPlugin {
  let base = '/';
  let publicDir = '';
  let fontsDir = '';
  return {
    name: 'vote-kidigit:design-system',
    configResolved(config) {
      base = config.base;
      publicDir = config.publicDir;
      fontsDir = resolve(config.root, FONTS_FROM_APP_ROOT);
    },
    buildStart() {
      if (!publicDir) return;
      const target = join(publicDir, 'fonts');
      mkdirSync(target, { recursive: true });
      for (const file of readdirSync(fontsDir)) {
        if (file.endsWith('.woff2')) copyFileSync(join(fontsDir, file), join(target, file));
      }
    },
    transformIndexHtml() {
      return [
        { tag: 'script', children: THEME_PREPAINT_SCRIPT, injectTo: 'head-prepend' },
        {
          tag: 'link',
          attrs: {
            rel: 'preload',
            href: `${base}fonts/${PRELOAD_FONT}`,
            as: 'font',
            type: 'font/woff2',
            crossorigin: true,
          },
          injectTo: 'head',
        },
      ];
    },
  };
}
