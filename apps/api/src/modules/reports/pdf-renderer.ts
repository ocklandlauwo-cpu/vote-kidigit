// HTML → PDF with one shared headless Chromium in the worker (Tech Stack 9.4: one browser, at
// most 2 PDFs at a time; the reports queue runs with concurrency 2). Pages run without
// JavaScript and without network: a report can only show what its own HTML contains.
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { type Browser, launch } from 'puppeteer';

@Injectable()
export class PdfRenderer implements OnModuleDestroy {
  private readonly logger = new Logger(PdfRenderer.name);
  private browser: Promise<Browser> | null = null;
  private font: Promise<string | null> | null = null;

  /** Inter (Design System 4.1) as a data URI for the templates; null falls back to system fonts. */
  fontDataUri(): Promise<string | null> {
    this.font ??= readFile(require.resolve('@vote-kidigit/shared/design/fonts/InterVariable.woff2'))
      .then((bytes) => `data:font/woff2;base64,${bytes.toString('base64')}`)
      .catch(() => {
        this.logger.warn({ message: 'Inter font not found; PDFs use system fonts' });
        return null;
      });
    return this.font;
  }

  async render(html: string, footerTemplate: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (request.url().startsWith('data:')) void request.continue();
        else void request.abort();
      });
      await page.setContent(html, { waitUntil: 'load', timeout: 60_000 });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate,
        timeout: 120_000,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async onModuleDestroy(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    if (browser) await (await browser.catch(() => null))?.close().catch(() => undefined);
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser) {
      const current = await this.browser.catch(() => null);
      if (current?.connected) return current;
    }
    this.browser = launch({
      headless: 'shell',
      // Chromium's sandbox cannot start as root (containers in CI); the server runs as vk.
      args: process.getuid?.() === 0 ? ['--no-sandbox'] : [],
    });
    this.browser.catch((error: unknown) => {
      this.logger.error({ message: 'Could not start Chromium for PDFs', error });
      this.browser = null;
    });
    return this.browser;
  }
}
