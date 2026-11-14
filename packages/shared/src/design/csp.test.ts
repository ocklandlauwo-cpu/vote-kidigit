// The Content-Security-Policy of both apps' production builds (Implementation Plan step 32).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, designSystem } from '../../vite-plugin-design';
import { THEME_PREPAINT_SCRIPT } from './theme';

function directives(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of contentSecurityPolicy().split('; ')) {
    const [name = '', ...values] = part.split(' ');
    out[name] = values.join(' ');
  }
  return out;
}

function tagsFor(command: 'build' | 'serve') {
  const plugin = designSystem();
  plugin.configResolved({ base: '/', publicDir: '', root: process.cwd(), command });
  return plugin.transformIndexHtml();
}

describe('content security policy', () => {
  it('allows scripts only from the app and the pre-paint script by its hash', () => {
    const hash = createHash('sha256').update(THEME_PREPAINT_SCRIPT).digest('base64');
    const csp = directives();
    expect(csp['script-src']).toBe(`'self' 'sha256-${hash}'`);
    expect(csp['script-src']).not.toContain('unsafe');
    expect(csp['default-src']).toBe("'self'");
    expect(csp['object-src']).toBe("'none'");
    expect(csp['connect-src']).toBe("'self'");
    expect(csp['base-uri']).toBe("'self'");
  });

  it('is the first tag of production builds and absent in development', () => {
    const built = tagsFor('build');
    expect(built[0]).toMatchObject({
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy() },
    });
    expect(built[1]).toMatchObject({ tag: 'script', children: THEME_PREPAINT_SCRIPT });
    expect(tagsFor('serve').some((tag) => tag.tag === 'meta')).toBe(false);
  });
});
