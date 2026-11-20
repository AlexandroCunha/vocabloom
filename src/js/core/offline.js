/*
 * Working offline. A service worker keeps the app and every worksheet a student has opened,
 * and a bar at the bottom of the screen says so when the phone loses its connection.
 */

const OFFLINE_MESSAGES = {
  student: 'You are offline. Your answers are still saved on this device.',
  teacher: 'You are offline. Converting a PDF needs an internet connection.'
};

let offlineKind = 'student';
let offlineBar = null;

/** Service workers need a secure page (https), and localhost counts for testing. */
function canUseServiceWorker() {
  return 'serviceWorker' in navigator
    && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
}

function registerServiceWorker() {
  if (!canUseServiceWorker()) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* the app works without it */ });
  });
}

function updateOfflineBar() {
  if (!offlineBar) return;
  offlineBar.textContent = OFFLINE_MESSAGES[offlineKind];
  offlineBar.hidden = navigator.onLine !== false;
}

function watchConnection() {
  offlineBar = document.createElement('div');
  offlineBar.className = 'net';
  offlineBar.setAttribute('role', 'status');
  document.body.appendChild(offlineBar);
  window.addEventListener('online', updateOfflineBar);
  window.addEventListener('offline', updateOfflineBar);
  updateOfflineBar();
}

/** kind: 'student' or 'teacher' */
function setOfflineMessage(kind) {
  offlineKind = kind;
  updateOfflineBar();
}
