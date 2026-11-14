// Vite plugin shared by the staff and voter apps (Design System 4.1, 12.4):
//  - copies the Inter font files from src/design/fonts into the app's public/fonts at start-up
//    (one committed copy; the app copies are git-ignored),
//  - injects the pre-paint theme script at the top of <head>,
//  - preloads the upright Inter file (respecting the app's base path),
//  - in production builds, puts the Content-Security-Policy first in <head> (step 32): scripts
//    only from the app itself plus the pre-paint script by its hash. Styles allow inline
//    because Ant Design and the organization brand colour inject <style> elements.
//    frame-ancestors cannot be set in a <meta>; Nginx sends it as a header (step 33).
// Only types it needs are declared here, so this package does not depend on Vite.
import { createHash } from 'node:crypto';
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

/** The CSP of both apps' production builds; the pre-paint script is allowed by its hash. */
export function contentSecurityPolicy(): string {
  const hash = createHash('sha256').update(THEME_PREPAINT_SCRIPT).digest('base64');
  return [
    "default-src 'self'",
    `script-src 'self' 'sha256-${hash}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

interface DesignPlugin {
  name: string;
  configResolved(config: {
    base: string;
    publicDir: string;
    root: string;
    command: 'build' | 'serve';
  }): void;
  buildStart(): void;
  transformIndexHtml(): HtmlTag[];
}

export function designSystem(): DesignPlugin {
  let base = '/';
  let build = false;
  let publicDir = '';
  let fontsDir = '';
  return {
    name: 'vote-kidigit:design-system',
    configResolved(config) {
      base = config.base;
      build = config.command === 'build';
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
      const csp: HtmlTag[] = build
        ? [
            {
              tag: 'meta',
              attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy() },
              injectTo: 'head-prepend',
            },
          ]
        : [];
      return [
        ...csp,
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
