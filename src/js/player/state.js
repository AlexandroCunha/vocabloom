/*
 * What a student has done so far. It lives only in that student's browser (local storage):
 * nothing is sent to a server.
 */

const STORAGE_PREFIX = 'vocabloom3:';

function freshStudentState() {
  return {
    name: '',
    values: {},          // id -> what the student typed or chose
    checked: {},         // id -> true once "Check" was pressed (typed answers)
    revealed: {},        // id -> true once the student asked to see the answer
    hintTaps: {},        // id -> how many times the hint button was pressed
    wrongAttempts: {},   // id -> number of different wrong answers
    everWrong: {},       // id -> true once a wrong answer was given
    lastWrongAnswer: {}, // id -> the last wrong answer, to avoid counting the same one twice
    practiceSkipped: false
  };
}

/** The same worksheet always maps to the same key, so a student can come back later. */
const storageKey = worksheet => STORAGE_PREFIX + hash(slimJSON(worksheet));

function loadStudentState(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    return Object.assign(freshStudentState(), saved || {});
  } catch (error) {
    return freshStudentState();
  }
}

function saveStudentState(key, state) {
  try { localStorage.setItem(key, JSON.stringify(state)); } catch (error) { /* storage full or blocked: keep going */ }
}
