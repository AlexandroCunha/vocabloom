/*
 * Keeps the student's place when the window changes shape: a phone turned sideways, an iPhone Duo opening or closing,
 * a window split in two. The page re-flows (one column becomes two), but Safari leaves the scroll position where it was
 * in pixels, so afterwards the student can be many questions away from the one they were answering.
 * keepPlace(root, win) remembers which question is at the top of the screen and puts it back after the change.
 */

const PLACE_MIN_WIDTH_CHANGE = 40;   // px: a smaller change is a scroll bar coming and going, not a new shape
const PLACE_SETTLE_MS = 150;         // wait for the new layout, and for Safari to finish turning, before measuring

const PLACE_EDGE_SLACK = 24;         // px of a question that may hide under the score bar and still count as the one in view

/**
 * What the student is looking at: the first item that starts at or just above `top` (the foot of the score bar) and still
 * reaches below it. When a question is cut off by the bar, the next one is the anchor. When two sit side by side, the left
 * one comes first. `rects` are { top, bottom } in document order. Returns -1 when nothing is in view.
 */
function pickAnchor(rects, top) {
  const inView = rect => rect.bottom > top + 1;
  const whole = rects.findIndex(rect => inView(rect) && rect.top >= top - PLACE_EDGE_SLACK);
  return whole >= 0 ? whole : rects.findIndex(inView);
}

let placeKeeper = null;   // one at a time: showing another worksheet replaces the listeners of the one before

function keepPlace(root, win) {
  if (placeKeeper) placeKeeper.stop();
  let place = null;             // { element, offset }: the question at the top, and how far below the score bar it sits
  let width = win.innerWidth;   // the width the remembered place belongs to
  let frame = 0;
  let timer = 0;

  const marks = () => Array.from(root.querySelectorAll('.pl h3, .pl .card, .pl .mk, .final'));
  const barBottom = () => { const bar = root.querySelector('.bar'); return bar ? bar.getBoundingClientRect().bottom : 0; };

  function remember() {
    frame = 0;
    // The shape has just changed: keep the old place until restore() has put it back.
    if (Math.abs(win.innerWidth - width) >= PLACE_MIN_WIDTH_CHANGE) return;
    const list = marks();
    const top = barBottom();
    const at = pickAnchor(list.map(element => element.getBoundingClientRect()), top);
    place = at < 0 ? null : { element: list[at], offset: list[at].getBoundingClientRect().top - top };
  }

  function restore() {
    timer = 0;
    if (Math.abs(win.innerWidth - width) < PLACE_MIN_WIDTH_CHANGE) return;
    width = win.innerWidth;
    if (place && place.element.isConnected) {
      const shift = place.element.getBoundingClientRect().top - barBottom() - place.offset;
      if (Math.abs(shift) > 1) {
        // 'instant': the page scrolls smoothly otherwise. Browsers that do not know the word get a plain scroll.
        try { win.scrollBy({ top: shift, behavior: 'instant' }); } catch (error) { win.scrollBy(0, shift); }
      }
    }
    remember();
  }

  const onScroll = () => { if (!frame) frame = win.requestAnimationFrame(remember); };
  const onResize = () => { win.clearTimeout(timer); timer = win.setTimeout(restore, PLACE_SETTLE_MS); };

  placeKeeper = {
    stop() {
      win.removeEventListener('scroll', onScroll);
      win.removeEventListener('resize', onResize);
      win.removeEventListener('orientationchange', onResize);
      win.clearTimeout(timer);
      if (frame) win.cancelAnimationFrame(frame);
    }
  };
  win.addEventListener('scroll', onScroll, { passive: true });
  win.addEventListener('resize', onResize);
  win.addEventListener('orientationchange', onResize);
  remember();
}

/** Called when the page leaves the worksheet (the teacher's tool and the home page have nothing to keep). */
function stopKeepingPlace() {
  if (placeKeeper) placeKeeper.stop();
  placeKeeper = null;
}
