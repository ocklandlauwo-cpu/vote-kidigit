// Puppeteer configuration (Tech Stack 9.4). Reports launch chrome-headless-shell only
// (PdfRenderer, headless: 'shell'), so the full Chrome is not downloaded at install.
module.exports = {
  chrome: { skipDownload: true },
  'chrome-headless-shell': { skipDownload: false },
};
