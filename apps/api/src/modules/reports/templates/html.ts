// The HTML around every PDF report (Design System 1.3: 11 pt, organization logo only, colours
// from the design tokens). Every value from the database goes through `esc`.
import { tokens } from '@vote-kidigit/shared';

const { danger, fontFamily, fontFamilyMono, neutral, primary, success } = tokens;

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const esc = (value: string | number): string =>
  String(value).replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

const styles = `
@page { size: A4; margin: 16mm 14mm 18mm; }
* { box-sizing: border-box; }
html { font-family: ${fontFamily}; font-size: 11pt; line-height: 1.45; color: ${neutral[900]}; }
body { margin: 0; }
h1 { font-size: 18pt; margin: 0 0 2pt; font-weight: 600; }
h2 { font-size: 13pt; margin: 0 0 4pt; font-weight: 600; }
p { margin: 0; }
.muted { color: ${neutral[600]}; }
.small { font-size: 9pt; }
.mono { font-family: ${fontFamilyMono}; font-size: 8.5pt; word-break: break-all; }
header.report { display: flex; align-items: center; gap: 12pt; padding-bottom: 8pt;
  border-bottom: 2pt solid ${primary[600]}; margin-bottom: 12pt; }
header.report img { max-height: 48pt; max-width: 120pt; }
dl.facts { display: grid; grid-template-columns: max-content 1fr; gap: 2pt 12pt; margin: 0 0 12pt; }
dl.facts dt { color: ${neutral[600]}; }
dl.facts dd { margin: 0; }
section.category { break-inside: avoid; border: 0.75pt solid ${neutral[200]}; border-radius: 4pt;
  padding: 8pt 10pt; margin-bottom: 10pt; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-weight: 600; font-size: 9pt; color: ${neutral[600]};
  border-bottom: 0.75pt solid ${neutral[300]}; padding: 3pt 4pt; }
td { padding: 3pt 4pt; border-bottom: 0.5pt solid ${neutral[100]}; vertical-align: top; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.winner { font-weight: 600; }
.badge { display: inline-block; font-size: 8.5pt; font-weight: 600; color: ${success[700]};
  border: 0.75pt solid ${success[600]}; border-radius: 3pt; padding: 0 3pt; }
.warn { color: ${danger[700]}; }
.notes { margin-top: 4pt; font-size: 9pt; color: ${neutral[600]}; }
.signatures { break-inside: avoid; margin-top: 16pt; }
.signatures .lines { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14pt; margin-top: 8pt; }
.signatures .line { border-top: 0.75pt solid ${neutral[700]}; padding-top: 3pt; margin-top: 28pt;
  font-size: 9pt; color: ${neutral[600]}; }
.verify { break-inside: avoid; display: flex; gap: 12pt; align-items: center; margin-top: 16pt;
  padding-top: 8pt; border-top: 0.75pt solid ${neutral[200]}; }
.verify svg { width: 84pt; height: 84pt; flex: none; }
`;

/** A complete HTML document for Puppeteer; `font` is the Inter face as a data URI, if found. */
export function documentHtml(options: {
  title: string;
  language: string;
  font: string | null;
  body: string;
}): string {
  const fontFace = options.font
    ? `@font-face { font-family: Inter; font-weight: 100 900; src: url(${options.font}) format('woff2'); }`
    : '';
  return `<!doctype html>
<html lang="${esc(options.language)}">
<head>
<meta charset="utf-8">
<title>${esc(options.title)}</title>
<style>${fontFace}${styles}</style>
</head>
<body>
${options.body}
</body>
</html>
`;
}

/** Header with the organization logo and name and the report title. */
export function reportHeader(options: {
  organizationName: string;
  logo: string | null;
  title: string;
  subtitle: string;
}): string {
  const logo = options.logo ? `<img src="${esc(options.logo)}" alt="">` : '';
  return `<header class="report">${logo}<div><p class="muted">${esc(options.organizationName)}</p>
<h1>${esc(options.title)}</h1><p>${esc(options.subtitle)}</p></div></header>`;
}

/** The page footer Puppeteer prints on every page (its own small document; inline styles only). */
export function footerTemplate(left: string, page: string, of: string): string {
  return `<div style="font-family: ${fontFamily}; font-size: 7pt; color: ${neutral[600]};
width: 100%; padding: 0 14mm; display: flex; justify-content: space-between;">
<span>${esc(left)}</span><span>${esc(page)} <span class="pageNumber"></span> ${esc(of)}
<span class="totalPages"></span></span></div>`;
}
