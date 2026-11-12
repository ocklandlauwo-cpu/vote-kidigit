// Starts a browser download of a finished report: the file route answers with
// Content-Disposition: attachment, so the page stays where it is.
export function startDownload(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}
