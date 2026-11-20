/*
 * The review-deck panel. It is drawn under "Your mistakes" in a worksheet and on the student's home page.
 *   - offers to keep the student's mistakes on this device (nothing is saved until they say yes);
 *   - shows what is ready to review today;
 *   - runs a review round with the same one-question-at-a-time runner as "Practise your mistakes".
 * Nothing here is ever sent anywhere.
 *
 * options = {
 *   root, panel,        where to draw (the panel's selector, for example '#deck')
 *   enabled?,           false in the teacher's preview: nothing is offered, read or saved
 *   home?,              the worksheet was opened from a link, so the student's home page can be linked to
 *   source,             the worksheet title, kept with each card so students know where it came from
 *   mistakes?(),        the questions answered wrongly right now, as [{ type, item, choices }] (worksheet only)
 *   isDismissed?(), onDismiss?(),   remembers "No thanks" for this worksheet
 *   speak?(text, button)            read-aloud
 * }
 */

const CLEAR_CONFIRM_MS = 3000;

const questionWord = count => (count === 1 ? 'question' : 'questions');

function createDeckPanel(options) {
  const { root } = options;
  const today = () => dayNumber(new Date());
  const enabled = options.enabled !== false;
  let deck = enabled ? loadDeck(today()) : null;   // null until the student chooses to keep a deck
  let snapshot = null;                   // the cards being asked in the current round
  let clearArmedAt = 0;
  let problem = '';

  const inWorksheet = typeof options.mistakes === 'function';
  const mistakes = () => (inWorksheet ? options.mistakes() : []);
  const cardFor = source => makeCard(source.type, source.item, options.source || '', source.choices, today());

  function persist() {
    if (!deck || saveDeck(deck)) return true;
    problem = 'Your browser would not save anything on this device, so the review deck could not be kept.';
    return false;
  }

  /* ---------- what the panel shows when no round is running ---------- */

  function offerHtml(count) {
    return '<div class="card deck"><h3 style="margin:0 0 4px">Review these again later?</h3>'
      + '<p class="sub" style="margin:0 0 10px">Vocabloom can keep the ' + count + ' ' + questionWord(count) + ' you got wrong on this device and bring ' + (count === 1 ? 'it' : 'them') + ' back tomorrow, then after 3, 7, 14 and 30 days as you get ' + (count === 1 ? 'it' : 'them') + ' right. Nothing is sent anywhere, and you can delete it at any time.</p>'
      + (problem ? '<div class="msg bad">' + esc(problem) + '</div>' : '')
      + '<div class="actions" style="margin:0"><button data-act="d-save">Save to my review deck</button><button class="sec" data-act="d-no">No thanks</button></div></div>';
  }

  function emptyHomeHtml() {
    return '<div class="card deck"><h3 style="margin:0 0 4px">Your review deck</h3>'
      + '<p class="sub" style="margin:0">Nothing here yet. When you get a question wrong on a worksheet, you can keep it here and practise it again on later days. It is saved only on this device.</p></div>';
  }

  function statusHtml() {
    const stats = deckStats(deck, today());
    const keptFromHere = mistakes().filter(source => deck.cards[cardFor(source).id]).length;
    let line;
    if (stats.due > 0) {
      line = '<b>' + stats.due + '</b> ' + questionWord(stats.due) + ' ready to review today' + (stats.due > DECK_SESSION_SIZE ? ' (' + DECK_SESSION_SIZE + ' at a time).' : '.');
    } else if (stats.total > 0) {
      line = 'Nothing to review today. The next ' + (stats.nextInDays === 1 ? 'one comes back tomorrow.' : 'one comes back in ' + stats.nextInDays + ' days.');
    } else {
      line = 'Your deck is empty. Questions you get wrong on worksheets can be kept here.';
    }
    const small = stats.total + ' in your deck' + (stats.mastered ? ' &middot; ' + stats.mastered + ' learned' : '')
      + (keptFromHere ? ' &middot; ' + keptFromHere + ' from this worksheet' : '');
    const armed = Date.now() - clearArmedAt < CLEAR_CONFIRM_MS;
    return '<div class="card deck"><h3 style="margin:0 0 4px">Your review deck</h3>'
      + '<p style="margin:0 0 4px">' + line + '</p><p class="sub" style="margin:0 0 10px">' + small + '</p>'
      + (problem ? '<div class="msg bad">' + esc(problem) + '</div>' : '')
      + (needsHomeScreenHint(window) ? '<div class="tip" style="margin:0 0 10px">&#128241; ' + esc(HOME_SCREEN_HINT) + '</div>' : '')
      + '<div class="actions" style="margin:0">' + (stats.due > 0 ? '<button data-act="d-start">Review now</button>' : '')
      + '<button class="ghost" data-act="d-clear">' + (armed ? 'Tap again to delete' : 'Delete my deck') + '</button></div>'
      + (inWorksheet && options.home ? '<p class="sub" style="margin:10px 0 0">Find this deck again any time under <a href="#review">My review deck</a>, at the top of the worksheet.</p>' : '') + '</div>';
  }

  function idleHtml() {
    if (!enabled) return '';
    if (deck) return statusHtml();
    if (!inWorksheet) return emptyHomeHtml();
    const count = mistakes().length;
    return count && !(options.isDismissed && options.isDismissed()) ? offerHtml(count) : '';
  }

  /* ---------- the review round ---------- */

  const round = createPractice({
    root,
    panel: options.panel,
    prefix: 'd',
    ids: () => (deck ? dueCards(deck, today()).slice(0, DECK_SESSION_SIZE).map(card => card.id) : []),
    index: () => { snapshot = deckIndex(dueCards(deck, today())); return snapshot; },
    hintFor: id => {
      const entry = snapshot && snapshot.items[id];
      return entry ? (entry.item.hint || firstLetterHint(entry.section.type, entry.item)) : '';
    },
    idleHtml,
    afterClose: 'idle',
    onResult: (id, rightFirstTime) => { answerCard(deck, id, rightFirstTime, today()); persist(); },
    speak: options.speak,
    copy: {
      running: 'Review',
      doneTitle: 'Review complete',
      done: result => result.firstTime + ' of ' + result.asked + ' right first time. Questions you got right come back later; the others tomorrow.',
      close: 'Close'
    }
  });

  /* ---------- buttons that belong to the deck itself ---------- */

  const own = {
    'd-save'() {
      deck = emptyDeck();
      mistakes().forEach(source => addCard(deck, cardFor(source), today()));
      problem = '';
      if (!persist()) deck = null;
      round.render();
    },
    'd-no'() {
      if (options.onDismiss) options.onDismiss();
      round.render();
    },
    'd-clear'(button) {
      if (Date.now() - clearArmedAt < CLEAR_CONFIRM_MS) {
        deleteDeck();
        deck = null;
        clearArmedAt = 0;
        problem = '';
        round.render();
        return;
      }
      clearArmedAt = Date.now();
      round.render();
      setTimeout(() => { if (button.isConnected && !round.isRunning()) round.render(); }, CLEAR_CONFIRM_MS);
    }
  };

  return {
    render: round.render,
    isRunning: round.isRunning,
    hasDeck: () => Boolean(deck),
    /** The student got a question wrong. If they keep a deck, it goes in (or goes back to box 1). */
    noteMistake(source) {
      if (!deck) return;
      addCard(deck, cardFor(source), today());
      persist();
    },
    /** Returns true when the click belonged to the deck panel. */
    handleAction(action, button) {
      if (own[action]) { own[action](button); return true; }
      return round.handleAction(action, button);
    },
    handleChange: round.handleChange,
    handleEnter: round.handleEnter
  };
}
