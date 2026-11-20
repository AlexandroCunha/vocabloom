/*
 * What kind of device this is, used only to show the right tip. Nothing here is stored or sent anywhere.
 * `win` is the browser window (or a stand-in in tests).
 */

/** iPhone, iPod and iPad. Since iPadOS 13 an iPad says it is a Mac, but it is the one "Mac" with a touch screen. */
function isAppleTouchDevice(win) {
  const nav = (win && win.navigator) || {};
  const agent = String(nav.userAgent || '');
  return /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && Number(nav.maxTouchPoints) > 1);
}

/** True when the page was opened from the Home Screen icon and not from a browser tab. */
function isInstalledApp(win) {
  const nav = (win && win.navigator) || {};
  if (nav.standalone === true) return true;
  return Boolean(win && win.matchMedia && win.matchMedia('(display-mode: standalone)').matches);
}

/** iPhone and iPad have no "install" button, so a student has to be told about Share, then Add to Home Screen. */
const needsHomeScreenHint = win => isAppleTouchDevice(win) && !isInstalledApp(win);

const HOME_SCREEN_HINT = 'Tip: tap the Share button, then Add to Home Screen. Vocabloom then opens like an app, and Safari is less likely to clear your review deck if you do not visit for a while.';
