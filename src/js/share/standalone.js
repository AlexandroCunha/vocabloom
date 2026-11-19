/*
 * Download a worksheet as one self-contained .html file.
 * The page re-reads its own source (captured before anything is drawn) and swaps in the worksheet data.
 */

const PAGE_SOURCE = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
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
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'text/html' }));
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 3000);
}
