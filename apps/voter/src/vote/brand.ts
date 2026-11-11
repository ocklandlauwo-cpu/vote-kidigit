// Organization colour on voter screens (Design System 3.4, 12.5): one <style id="vk-brand"> with
// the four brand variables for light and both dark selectors. Nothing else changes.
import { deriveBrandTokens, type BrandTokens } from '@vote-kidigit/shared';

const STYLE_ID = 'vk-brand';

function block(selector: string, t: BrandTokens): string {
  return `${selector}{--vk-brand:${t.brand};--vk-brand-hover:${t.brandHover};--vk-on-brand:${t.onBrand};--vk-brand-subtle:${t.brandSubtle};}`;
}

export function applyBrand(primaryColor: string | null): void {
  const existing = document.getElementById(STYLE_ID);
  if (!primaryColor) {
    existing?.remove();
    return;
  }
  let derived;
  try {
    derived = deriveBrandTokens(primaryColor);
  } catch {
    existing?.remove();
    return;
  }
  const css =
    block(':root', derived.light) +
    `@media (prefers-color-scheme: dark){${block(":root:not([data-theme='light'])", derived.dark)}}` +
    block(":root[data-theme='dark']", derived.dark);
  const style = existing ?? document.head.appendChild(document.createElement('style'));
  style.id = STYLE_ID;
  style.textContent = css;
}
