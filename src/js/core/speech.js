/*
 * Read-aloud for questions, reading texts and words, using the browser's own speech synthesis.
 * Nothing is sent by Vocabloom itself. Only the worksheet's text is ever spoken, never what a student typed.
 *
 * The helpers (spokenText, splitForSpeech, pickVoice) have no DOM and are unit-tested.
 * createSpeaker wraps window.speechSynthesis; nothing plays until a student presses a button.
 */

const SPEECH_LANG = 'en-GB';
const SPEECH_RATE = 0.9;           // a little slower than normal, for learners
const SPEECH_CHUNK_CHARS = 180;    // some browsers stop long utterances, so long texts are read in pieces

/** Spoken text should not contain stray spaces or doubled punctuation. */
function tidySpeech(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/,(\s*,)+/g, ',')
    .replace(/,\s*([.;:!?])/g, '$1')
    .replace(/^[,;\s]+/, '')
    .trim();
}

/**
 * What to say for one question. A blank is spoken as a short pause and the word "blank";
 * once the question is settled (`revealAnswers`) the right answer is read in its place.
 */
function spokenText(type, item, revealAnswers) {
  const answerFor = k => firstAlternative((type === 'fill' ? item.answers[k] : (k === 0 ? item.answers[0] : '')) || '');
  const prompt = String(item.prompt || '');
  const hasBlank = prompt.indexOf('___') !== -1;
  let blankNumber = 0;
  let text = prompt.replace(/___/g, () => {
    const answer = revealAnswers ? answerFor(blankNumber) : '';
    blankNumber += 1;
    return answer ? ' ' + answer + ' ' : ', blank, ';
  });
  // A new sentence is added after the question: end it properly first, so there is never a double full stop.
  const then = extra => { text = tidySpeech(text); text = (/[.!?:;]$/.test(text) ? text : text + '.') + ' ' + extra; };
  if (type === 'choice' && !revealAnswers) then(item.options.join('. '));
  if (revealAnswers && !hasBlank && item.answers[0]) then('Answer: ' + firstAlternative(item.answers[0]));
  return tidySpeech(text);
}

/** Splits a text at sentence ends into pieces of at most `maxChars` characters. */
function splitForSpeech(text, maxChars) {
  const pieces = String(text).match(/[^.!?;:\n]+[.!?;:]*/g) || [];
  const chunks = [];
  let current = '';
  pieces.forEach(raw => {
    const piece = raw.trim();
    if (!piece) return;
    if (piece.length > maxChars) {
      if (current) { chunks.push(current); current = ''; }
      let rest = piece;
      while (rest.length > maxChars) {
        let cut = rest.lastIndexOf(' ', maxChars);
        if (cut < maxChars / 2) cut = maxChars;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      current = rest;
    } else if (current && current.length + 1 + piece.length > maxChars) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? current + ' ' + piece : piece;
    }
  });
  if (current) chunks.push(current);
  return chunks;
}

/** British English first, then Irish, then any English. A voice that runs on the device beats an online one. */
function voiceRank(voice) {
  const lang = String(voice.lang || '').replace('_', '-').toLowerCase();
  let rank;
  if (lang === 'en-gb') rank = 30;
  else if (lang === 'en-ie') rank = 20;
  else if (lang === 'en' || lang.indexOf('en-') === 0) rank = 10;
  else return -1;
  if (voice.localService) rank += 5;
  if (voice.default) rank += 2;
  return rank;
}

function pickVoice(voices) {
  let best = null;
  let bestRank = -1;
  Array.prototype.forEach.call(voices || [], voice => {
    const rank = voiceRank(voice);
    if (rank > bestRank) { best = voice; bestRank = rank; }
  });
  return best;
}

/**
 * `win` is the browser window (or a stand-in in tests).
 * speak(text, button) reads the text and marks the button as playing; pressing the same button again stops it.
 */
function createSpeaker(win) {
  const synth = win && win.speechSynthesis;
  const Utterance = win && win.SpeechSynthesisUtterance;
  const supported = Boolean(synth && Utterance);
  let playing = null;   // the button that started the current speech
  let run = 0;          // changes on every start and stop, so late events from a cancelled run are ignored
  let pieces = [];      // the pieces being spoken. Safari and Chrome can drop a piece (and its "end" event) once nothing refers to it

  function clearButton() {
    if (!playing) return;
    playing.classList.remove('speaking');
    playing.setAttribute('aria-pressed', 'false');
    playing = null;
  }

  function stop() {
    run += 1;
    clearButton();
    pieces = [];
    if (supported) synth.cancel();
  }

  function speak(text, button) {
    if (!supported) return false;
    const wasPlaying = button && button === playing;
    stop();
    if (wasPlaying || !text) return true;
    const thisRun = run;
    const voice = pickVoice(synth.getVoices());
    const chunks = splitForSpeech(text, SPEECH_CHUNK_CHARS);
    if (button) {
      playing = button;
      button.classList.add('speaking');
      button.setAttribute('aria-pressed', 'true');
    }
    chunks.forEach((chunk, position) => {
      const utterance = new Utterance(chunk);
      utterance.lang = SPEECH_LANG;
      utterance.rate = SPEECH_RATE;
      if (voice) utterance.voice = voice;
      const finished = () => { if (run === thisRun && position === chunks.length - 1) { clearButton(); pieces = []; } };
      utterance.onend = finished;
      utterance.onerror = finished;
      pieces.push(utterance);
      synth.speak(utterance);
    });
    return true;
  }

  if (supported && win.addEventListener) win.addEventListener('pagehide', stop);
  return { supported, speak, stop };
}
