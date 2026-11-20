/* Small DOM and UI helpers used everywhere. */

const $ = (selector, root) => (root || document).querySelector(selector);

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Every piece of text goes through this before it is placed in HTML. */
const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ESCAPES[char]);

const LOGO = '<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><g fill="#fff"><circle cx="16" cy="8" r="6"/><circle cx="24" cy="14" r="6" opacity=".85"/><circle cx="21" cy="24" r="6" opacity=".7"/><circle cx="11" cy="24" r="6" opacity=".85"/><circle cx="8" cy="14" r="6"/></g><circle cx="16" cy="16" r="5.5" fill="#E4474C"/></svg>';

function toast(message) {
  const element = document.createElement('div');
  element.className = 'toast';
  element.setAttribute('role', 'status');
  element.textContent = message;
  document.body.appendChild(element);
  setTimeout(() => element.remove(), 1900);
}

/**
 * Shows an overlay (a dark backdrop holding a box). Escape or a click on the backdrop closes it,
 * and focus goes back to what had it before. Returns the function that closes the overlay.
 */
function showOverlay(overlay) {
  const opener = document.activeElement;
  document.body.appendChild(overlay);
  const onKey = event => { if (event.key === 'Escape') close(); };
  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
  }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  return close;
}

/** Fallback when the clipboard is blocked: shows the text so the user can copy it by hand. */
function showText(title, text) {
  const overlay = document.createElement('div');
  overlay.className = 'ov';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', title);
  overlay.innerHTML = '<div class="box"><h3 style="margin:0 0 8px">' + esc(title) + '</h3><textarea readonly></textarea><div class="nav"><button class="sec">Close</button></div></div>';
  const close = showOverlay(overlay);
  const field = $('textarea', overlay);
  field.value = text;
  field.focus();
  field.select();
  $('button', overlay).onclick = close;
}

/** True when a drag carries files (and not, say, selected text). */
const dragHasFiles = event => Array.from((event.dataTransfer && event.dataTransfer.types) || []).indexOf('Files') !== -1;

const ARROW_STEPS = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

/**
 * Arrow keys move between the answer buttons of one question, so a keyboard user does not have to Tab through
 * every one. Returns true when the key was used.
 */
function moveBetweenOptions(event) {
  const step = ARROW_STEPS[event.key];
  const current = event.target;
  if (!step || !current.classList || !current.classList.contains('opt')) return false;
  const group = Array.from(current.parentNode.querySelectorAll('.opt'));
  const next = group[(group.indexOf(current) + step + group.length) % group.length];
  if (next) next.focus();
  return true;
}

async function copyText(text, title) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied!');
  } catch (error) {
    showText(title || 'Copy this text', text);
  }
}
