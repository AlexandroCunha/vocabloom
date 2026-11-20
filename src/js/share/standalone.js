/*
 * Download a worksheet as one self-contained .html file.
 * The page re-reads its own source (captured before anything is drawn) and swaps in the worksheet data.
 */

// The app's install links are left out of a downloaded file: it is not part of the website.
const PAGE_SOURCE = ('<!DOCTYPE html>\n' + document.documentElement.outerHTML).replace(/<link rel="(?:manifest|apple-touch-icon)"[^>]*>\n?/g, '');
const DATA_TAG_OPEN = '<script id="ws-data" type="application/json">';
const SCRIPT_CLOSE = '</' + 'script>';

function buildStandalonePage(worksheet) {
  const start = PAGE_SOURCE.indexOf(DATA_TAG_OPEN);
  const end = PAGE_SOURCE.indexOf(SCRIPT_CLOSE, start);
  // "<" is escaped so the data can never close the script tag early.
  const json = slimJSON(worksheet).replace(/</g, '\\u003c');
  return PAGE_SOURCE.slice(0, start + DATA_TAG_OPEN.length) + json + PAGE_SOURCE.slice(end);
}

function downloadTextFile(name, text) {
  downloadBlob(name, new Blob([text], { type: 'text/html' }));
}

function downloadBlob(name, blob) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 3000);
}
