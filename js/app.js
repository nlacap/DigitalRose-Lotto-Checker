// Controller: owns the state, builds the page, wires events, runs the comparison.

import { APP_VERSION, GAMES, BET_SLOTS, PICK_COUNT, STORAGE_KEY } from './config.js';
import {
  sanitizeInput, validateSet, liveCheck, validateDrawDate, notDrawnMessage, resultsAvailable,
  matchNumbers, prizeTier, findDuplicateBets, nextDrawDate,
} from './validation.js';
import { loadState, saveState, blankBets, blankRow, gameHasData, countBets, clearAllGames, loadResults, saveResults, mergeResults, findResult, latestResult } from './storage.js';
import { parseResults } from './resultsParser.js';
import { makeBackup, parseBackup, resultsToList } from './backup.js';
import { luckyPick } from './luckyPick.js';
import { $, $$, el } from './dom.js';
import { setStatus } from './status.js';
import { createPicker } from './picker.js';
import { splitNumbers, parseTicket } from './ticketParser.js';

// ---------------------------------------------------------------- state

const initial = loadState();
let state = initial.state;
const picker = createPicker();
let results = loadResults(); // official winning numbers saved on this device

const game = () => GAMES[state.game];
const draw = () => state.byGame[state.game];

/** Cells for a row key: 'w' = winning numbers, 0..5 = bet index. */
const rowCells = key => (key === 'w' ? draw().wins : draw().bets[key]);
const rowInputs = key => $$(`.cell[data-row="${key}"]`);
const rowHint = key => $(key === 'w' ? '#winHint' : `#hint${key}`);

function persist() {
  const r = saveState(state);
  const label = $('#saveState');
  label.classList.toggle('warn', !r.ok);
  label.textContent = r.ok
    ? 'Saved on this device • ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '⚠ ' + r.error;
}

// ---------------------------------------------------------------- build

function cellInputs(rowKey, labelPrefix) {
  return Array.from({ length: PICK_COUNT }, (_, j) => el('input', {
    class: 'cell ' + (rowKey === 'w' ? 'winnum' : 'betnum'),
    'data-row': rowKey,
    'data-j': j,
    type: 'text',
    inputmode: 'numeric',
    pattern: '[0-9]*',
    autocomplete: 'off',
    placeholder: j + 1,
    'aria-label': `${labelPrefix} number ${j + 1}`,
  }));
}

function build() {
  $('#bets').replaceChildren(...Array.from({ length: BET_SLOTS }, (_, i) =>
    el('div', { class: 'bet' }, [
      el('div', { class: 'betHead' }, [
        el('strong', {}, `Bet ${i + 1}`),
        el('div', { class: 'betBtns' }, [
          el('button', { class: 'luckyBet', type: 'button', 'data-i': i, 'aria-label': `Lucky Pick for Bet ${i + 1}` }, '🎲 LUCKY PICK'),
          el('button', { class: 'pickBet', type: 'button', 'data-i': i }, 'NUMBER BOARD'),
        ]),
      ]),
      el('div', { class: 'six' }, cellInputs(i, `Bet ${i + 1}`)),
      el('div', { class: 'hint', id: `hint${i}`, 'aria-live': 'polite' }),
      el('div', { class: 'result', id: `r${i}` }),
    ]),
  ));
  $('#wins').replaceChildren(...cellInputs('w', 'Winning'));
  $('#version').textContent = 'v' + APP_VERSION;
  wire();
}

// ---------------------------------------------------------------- render

function render() {
  const g = game();
  $$('.tab').forEach((t, i) => {
    t.classList.toggle('active', i === state.game);
    t.setAttribute('aria-pressed', String(i === state.game));
  });
  $('#gameLabel').textContent = `${g.name} • Valid numbers 1–${g.max}`;
  $('#drawDate').value = draw().date;
  $$('.cell').forEach(x => {
    const key = x.dataset.row === 'w' ? 'w' : Number(x.dataset.row);
    x.value = rowCells(key)[Number(x.dataset.j)];
  });
  clearResults();
  ['w', ...Array.from({ length: BET_SLOTS }, (_, i) => i)].forEach(liveValidate);
  showDateHint();
  applyDrawLock();
}

// ---------------------------------------------------------------- draw not held yet

/** Message when the selected draw hasn't happened yet (today before 9 PM or a later day), else null. */
const waitingForDraw = () => (draw().date ? notDrawnMessage(draw().date) : null);
let drawLocked = false;

/**
 * Bets can always be entered. Winning numbers stay locked until the draw has
 * taken place, because there are no official results before that.
 */
function applyDrawLock() {
  const msg = waitingForDraw();
  const wasLocked = drawLocked;
  drawLocked = !!msg;
  rowInputs('w').forEach(x => { x.disabled = drawLocked; });
  $('#pickWin').disabled = drawLocked;
  const box = $('#drawWait');
  box.hidden = !drawLocked;
  box.textContent = drawLocked ? `⏳ ${msg} Your bets are saved — come back after the draw.` : '';
  return { wasLocked, locked: drawLocked };
}

/** Re-check every so often so the lock lifts by itself at draw time. */
function refreshDrawLock() {
  const { wasLocked, locked } = applyDrawLock();
  if (wasLocked && !locked) {
    const auto = autoFillWinning();
    setStatus('success', 'The draw has taken place — you can now enter the winning numbers.' +
      (auto === 'filled' ? ' They were filled from your saved official results.' : ''));
  }
}

function liveValidate(key) {
  const { badIndexes, errors } = liveCheck(rowCells(key), game().max);
  rowInputs(key).forEach((x, j) => x.classList.toggle('invalid', badIndexes.includes(j)));
  const hint = rowHint(key);
  hint.className = 'hint';
  hint.textContent = errors.join(' ');
}

/** validateDrawDate, but a saved official PCSO result for that date overrides the draw-day guess. */
function checkDate(iso) {
  const r = validateDrawDate(iso, game());
  if (r.ok && findResult(results, state.game, iso)) r.warnings = r.warnings.filter(w => !w.includes('normally drawn'));
  return r;
}

function showDateHint() {
  const hint = $('#dateHint');
  const d = draw().date;
  const r = d ? checkDate(d) : { ok: true, warnings: [] };
  hint.className = 'hint' + (r.ok ? ' warn' : '');
  hint.textContent = r.ok ? r.warnings.join(' ') : r.error;
}

function clearResults() {
  $$('.cell').forEach(x => x.classList.remove('match'));
  $$('.result').forEach(x => { x.textContent = ''; x.className = 'result'; });
}

// ---------------------------------------------------------------- events

/** Several numbers pasted/scanned into one box: spread them across the row. */
function spreadAcrossRow(x) {
  const parts = splitNumbers(x.value, { expandRuns: true });
  if (parts.length < 2) return false;
  const key = x.dataset.row === 'w' ? 'w' : Number(x.dataset.row);
  const start = parts.length >= PICK_COUNT ? 0 : Number(x.dataset.j);
  const cells = rowCells(key);
  const inputs = rowInputs(key);
  parts.slice(0, PICK_COUNT - start).forEach((v, k) => {
    cells[start + k] = v;
    inputs[start + k].value = v;
  });
  if (start === 0 && parts.length >= PICK_COUNT) inputs.forEach((inp, j) => { if (j >= parts.length) { cells[j] = ''; inp.value = ''; } });
  persist();
  clearResults();
  liveValidate(key);
  const dated = key !== 'w' ? syncAutoDate({ quiet: true }) : null;
  const extra = parts.length - (PICK_COUNT - start);
  setStatus(extra > 0 ? 'warn' : 'info',
    `Filled ${Math.min(parts.length, PICK_COUNT - start)} numbers into ${key === 'w' ? 'the winning numbers' : 'Bet ' + (key + 1)}.` +
    (extra > 0 ? ` ${extra} extra number${extra > 1 ? 's were' : ' was'} ignored.` : '') +
    (dated ? ' ' + autoDateNote(dated) : ''));
  inputs[Math.min(start + parts.length, PICK_COUNT) - 1]?.blur();
  return true;
}

function onCellInput(e) {
  const x = e.target;
  if (spreadAcrossRow(x)) return;
  const clean = sanitizeInput(x.value);
  if (clean !== x.value) x.value = clean;

  const key = x.dataset.row === 'w' ? 'w' : Number(x.dataset.row);
  rowCells(key)[Number(x.dataset.j)] = clean;
  persist();
  clearResults();
  liveValidate(key);
  // a finished bet row with no draw date yet → fill in the next draw date
  if (key !== 'w' && rowCells(key).every(Boolean)) syncAutoDate();

  // jump to the next box once the number can't get any longer
  const typing = !e.inputType || e.inputType.startsWith('insert');
  if (typing && (clean.length === 2 || (clean.length === 1 && Number(clean) * 10 > game().max))) {
    const inputs = rowInputs(key);
    inputs[Number(x.dataset.j) + 1]?.focus();
  }
}

function hasAnyBet() { return draw().bets.flat().some(Boolean); }
function hasAnything() { return hasAnyBet() || draw().wins.some(Boolean) || !!draw().date; }

/**
 * A game that has bets but no draw date gets the game's next draw date.
 * A date you already set is never changed. Does not save or redraw — callers do.
 * @returns {string|null} the date that was set, or null if nothing changed
 */
function autoSetDate() {
  if (draw().date || !hasAnyBet()) return null;
  draw().date = nextDrawDate(game());
  return draw().date;
}

const autoDateNote = iso => `Draw date set to ${fmtDate(iso)} — the next ${game().name} draw. Change it if your ticket is for a different draw.`;

/**
 * Used while typing, where there is no full redraw: set the date and refresh only what depends on it.
 * `quiet` skips the status message when the caller shows its own.
 * @returns {string|null} the date that was set, or null
 */
function syncAutoDate({ quiet = false } = {}) {
  const iso = autoSetDate();
  if (!iso) return null;
  persist();
  $('#drawDate').value = iso;
  showDateHint();
  applyDrawLock();
  autoFillWinning();
  if (!quiet) setStatus('info', autoDateNote(iso));
  return iso;
}

function wire() {
  $$('.tab').forEach((t, i) => t.addEventListener('click', () => {
    if (i === state.game) return;
    state.game = i;
    const dated = autoSetDate(); // saved bets but no date yet → next draw date
    persist();
    render();
    const auto = autoFillWinning();
    setStatus('info', `${GAMES[i].name} selected. ` + (hasAnyBet() ? 'Its saved bets were loaded.' : 'No saved bets yet.') +
      (dated ? ' ' + autoDateNote(dated) : '') +
      (auto === 'filled' ? ' Winning numbers filled from saved official results.' : ''));
  }));

  $('#drawDate').addEventListener('change', e => {
    draw().date = e.target.value;
    persist();
    clearResults();
    showDateHint();
    applyDrawLock();
    if (autoFillWinning() === 'filled') setStatus('info', 'Winning numbers filled from saved official results.');
  });

  $('#saveResults').addEventListener('click', importResults);
  $('#resultsText').addEventListener('input', () => { $('#resultsHint').textContent = ''; });
  $('#clearResultsText').addEventListener('click', () => {
    $('#resultsText').value = '';
    $('#resultsHint').textContent = '';
    $('#resultsText').focus();
  });
  $('#savedList').addEventListener('click', e => {
    const b = e.target.closest('.savedItem');
    if (!b) return;
    state.game = Number(b.dataset.game);
    draw().date = b.dataset.date;
    persist();
    render();
    const auto = autoFillWinning();
    setStatus('info', `${game().name} draw ${b.dataset.date} selected.` + (auto === 'filled' ? ' Winning numbers filled.' : ''));
  });
  $('#useSaved').addEventListener('click', () => {
    const saved = findResult(results, state.game, draw().date);
    if (!saved) return;
    draw().wins = saved.map(String);
    $('#useSaved').hidden = true;
    afterEdit('Winning numbers replaced with the saved official result.');
  });

  document.addEventListener('input', e => { if (e.target.classList?.contains('cell')) onCellInput(e); });
  document.addEventListener('focusin', e => { if (e.target.classList?.contains('cell')) e.target.select?.(); });

  $('#bets').addEventListener('click', e => {
    const lucky = e.target.closest('.luckyBet');
    if (lucky) { luckyBet(Number(lucky.dataset.i)); return; }
    const b = e.target.closest('.pickBet');
    if (!b) return;
    const i = Number(b.dataset.i);
    picker.open({
      heading: `Select Numbers for Bet ${i + 1}`,
      numbers: draw().bets[i].filter(Boolean),
      max: game().max,
      onSave: nums => { draw().bets[i] = nums.map(String); afterEdit(`Bet ${i + 1} saved.`); },
    });
  });

  $('#pickWin').addEventListener('click', () => picker.open({
    heading: 'Select Winning Numbers',
    numbers: draw().wins.filter(Boolean),
    max: game().max,
    onSave: nums => { draw().wins = nums.map(String); afterEdit('Winning numbers saved.'); },
  }));

  $('#luckyEmpty').addEventListener('click', luckyEmptyBets);

  $('#clearBets').addEventListener('click', () => {
    if (hasAnyBet() && !confirm('Clear all bets for ' + game().name + '?')) return;
    draw().bets = blankBets();
    afterEdit('All bets cleared.');
  });

  $('#clearSaved').addEventListener('click', () => {
    results = {};
    const saved = saveResults(results);
    renderSavedList();
    $('#useSaved').hidden = true;
    showDateHint();
    setStatus(saved.ok ? 'info' : 'warn', saved.ok ? 'Saved official results cleared for all games.' : saved.error);
  });

  // Clears only the game that is selected — the other four games keep their bets, date and winning numbers.
  $('#newDraw').addEventListener('click', () => {
    if (hasAnything() && !confirm(`Clear the draw date, all bets and winning numbers for ${game().name}? Your other games are not affected.`)) return;
    state.byGame[state.game] = { date: '', bets: blankBets(), wins: blankRow() };
    afterEdit(`Ready for a new ${game().name} draw. Your other games were not changed.`);
  });

  // Clears every game's date, bets and winning numbers. Saved official results have their own button.
  $('#clearAllGames').addEventListener('click', () => {
    const used = GAMES.filter((_, i) => gameHasData(state.byGame[i]));
    if (!used.length) { setStatus('info', 'Nothing to clear — no game has a draw date, bets or winning numbers.'); return; }
    const bets = state.byGame.reduce((n, g) => n + countBets(g), 0);
    const names = used.map(g => g.id).join(', ');
    if (!confirm(`Clear the draw date, bets and winning numbers for ALL games?\n\nGames with entries: ${names} (${bets} bet${bets === 1 ? '' : 's'}).\nThis cannot be undone. Saved official results are kept.`)) return;
    state = clearAllGames(state);
    afterEdit(`Cleared all games (${names}). Saved official results were kept.`);
  });

  $('#copyBackup').addEventListener('click', copyBackup);
  $('#restoreBackup').addEventListener('click', restoreBackup);
  $('#backupText').addEventListener('input', () => { $('#backupHint').textContent = ''; });

  $('#compare').addEventListener('click', compare);

  $('#fillBets').addEventListener('click', fillFromTicket);
  $('#ticketText').addEventListener('input', () => { $('#ticketHint').textContent = ''; });
  $('#clearTicket').addEventListener('click', () => {
    $('#ticketText').value = '';
    $('#ticketHint').textContent = '';
    $('#ticketText').focus();
  });

  // keep two open tabs in sync
  window.addEventListener('storage', e => {
    if (e.key !== STORAGE_KEY) return;
    state = loadState().state;
    render();
    setStatus('info', 'Updated with changes made in another tab.');
  });
}

function fillFromTicket() {
  const text = $('#ticketText').value;
  const hint = $('#ticketHint');
  hint.className = 'hint';
  if (!text.trim()) { hint.textContent = 'Scan or paste your ticket first.'; return; }

  const r = parseTicket(text, state.game);
  if (!r.bets.length) {
    hint.textContent = 'No complete bets found. Each bet needs six numbers on one line.' +
      (r.rejected.length ? ' Problems: ' + r.rejected.join(' ') : '');
    return;
  }
  if (r.gameIndex !== state.game) {
    if (!confirm(`This ticket looks like ${GAMES[r.gameIndex].name}. Switch to that game?`)) {
      // stay on the current game, but only keep bets valid for it
      const again = parseTicket(text.replace(/6\s*\/\s*\d\d|ULTRA|GRAND|SUPER|MEGA/gi, ''), state.game);
      return applyBets(again, hint, state.game);
    }
  }
  applyBets(r, hint, r.gameIndex);
}

function applyBets(r, hint, gameIndex) {
  const target = state.byGame[gameIndex];
  const name = GAMES[gameIndex].name;
  if (!r.bets.length) { hint.textContent = 'No bets on this ticket fit ' + name + '.'; return; }
  if (target.bets.flat().some(Boolean) && !confirm(`Replace the current ${name} bets with the ${r.bets.length} from the ticket?`)) return;
  state.game = gameIndex;
  draw().bets = blankBets();
  r.bets.forEach((nums, i) => { draw().bets[i] = nums.map(String); });
  const dated = autoSetDate();
  persist();
  render();
  const notes = [...r.rejected];
  if (r.overflow) notes.push(`${r.overflow} more bet${r.overflow > 1 ? 's' : ''} did not fit (6 slots).`);
  hint.className = notes.length ? 'hint warn' : 'hint';
  hint.textContent = notes.length ? 'Skipped: ' + notes.join(' ') : '';
  setStatus(notes.length ? 'warn' : 'success',
    `Filled ${r.bets.length} bet${r.bets.length > 1 ? 's' : ''} for ${game().name}${r.gameDetected ? ' (game read from ticket)' : ''}. Please check them against your ticket.`,
    dated ? [...notes, autoDateNote(dated)] : notes);
}

// ---------------------------------------------------------------- saved PCSO results

const fmtNums = nums => nums.map(n => String(n).padStart(2, '0')).join('-');
const fmtDate = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};

/**
 * Fill the winning boxes from a saved result for the current game and date.
 * Never overwrites numbers the user typed: if they differ, offer a button instead.
 * @returns {'filled'|'same'|'differs'|'none'}
 */
function autoFillWinning() {
  const btn = $('#useSaved');
  btn.hidden = true;
  if (waitingForDraw()) return 'none';
  const saved = findResult(results, state.game, draw().date);
  if (!saved) return 'none';

  const current = draw().wins;
  if (current.every(v => !v)) {
    draw().wins = saved.map(String);
    persist();
    render();
    return 'filled';
  }
  const typed = validateSet(current, game().max);
  if (typed.status === 'ok' && typed.numbers.join() === saved.join()) return 'same';

  const hint = $('#winHint');
  hint.className = 'hint warn';
  hint.textContent = `The saved official result for this draw is ${fmtNums(saved)}, which is different from the numbers entered.`;
  btn.hidden = false;
  return 'differs';
}

function renderSavedList() {
  const items = GAMES.map((g, gi) => ({ g, gi, r: latestResult(results, gi) })).filter(x => x.r);
  const box = $('#savedList');
  $('#clearSaved').hidden = !items.length;
  if (!items.length) { box.replaceChildren(); return; }
  box.replaceChildren(
    el('div', { class: 'savedTitle' }, 'Latest saved results (tap to use):'),
    ...items.map(({ g, gi, r }) => el('button', { class: 'savedItem', type: 'button', 'data-game': gi, 'data-date': r.date }, [
      el('span', { class: 'savedGame' }, g.id),
      el('span', { class: 'savedDate' }, fmtDate(r.date)),
      el('span', { class: 'savedNums' }, fmtNums(r.numbers)),
    ])),
  );
}

function importResults() {
  const text = $('#resultsText').value;
  const hint = $('#resultsHint');
  hint.className = 'hint';
  if (!text.trim()) { hint.textContent = 'Paste or scan the official results first.'; return; }

  const parsed = parseResults(text, { fallbackDate: draw().date || null });
  // results can't exist for a draw that hasn't happened — almost always a wrong date
  parsed.results = parsed.results.filter(r => {
    if (resultsAvailable(r.date)) return true;
    parsed.rejected.push(`${GAMES[r.gameIndex].name} ${r.date}: that draw hasn't happened yet — check the draw date.`);
    return false;
  });
  if (!parsed.results.length) {
    hint.textContent = 'No 6-number lotto results found.' + (parsed.rejected.length ? ' ' + parsed.rejected.join(' ') : ' Copy the rows that show the game, combination and draw date.');
    return;
  }

  const merged = mergeResults(results, parsed.results);
  const saved = saveResults(merged.db);
  results = merged.db;

  // point the current game at the newest imported draw if no date is set yet
  if (!draw().date) {
    const mine = parsed.results.filter(r => r.gameIndex === state.game).map(r => r.date).sort();
    if (mine.length) { draw().date = mine[mine.length - 1]; persist(); render(); }
  }
  const auto = autoFillWinning();
  renderSavedList();

  const list = parsed.results.map(r => `${GAMES[r.gameIndex].id} ${fmtDate(r.date)}: ${fmtNums(r.numbers)}`);
  const notes = [...parsed.rejected];
  const guessed = parsed.results.filter(r => r.dateGuessed);
  if (guessed.length) notes.push(`The draw date was not in the pasted text, so ${guessed.length === parsed.results.length ? 'these were' : guessed.length + ' result(s) were'} saved under ${fmtDate(guessed[0].date)} from the Draw Date field. Make sure that is the actual draw date — the date in PCSO's search box is not always the draw date.`);
  if (merged.changed) notes.push(`${merged.changed} saved result${merged.changed > 1 ? 's were' : ' was'} replaced with the new numbers.`);
  if (!saved.ok) notes.push(saved.error);
  hint.className = notes.length ? 'hint warn' : 'hint';
  hint.textContent = notes.join(' ');
  setStatus(notes.length ? 'warn' : 'success',
    `Saved ${parsed.results.length} official result${parsed.results.length > 1 ? 's' : ''}` +
    (auto === 'filled' ? ' and filled the winning numbers.' : '.') + ' Please check them against the official results.',
    [...list, ...notes]);
}

// ---------------------------------------------------------------- back up / restore

async function copyBackup() {
  const text = makeBackup(state, results);
  const box = $('#backupText');
  const hint = $('#backupHint');
  box.value = text;
  hint.className = 'hint';
  try {
    await navigator.clipboard.writeText(text);
    hint.textContent = 'Backup copied. Open the other copy of the app, open this section, touch and hold the box, choose Paste, then tap RESTORE FROM BOX.';
  } catch {
    // clipboard blocked: leave the text selected so it can be copied by hand
    box.focus();
    box.select();
    box.setSelectionRange(0, text.length);
    hint.className = 'hint warn';
    hint.textContent = 'Could not copy automatically. The backup is selected in the box — touch and hold it and choose Copy.';
  }
}

function restoreBackup() {
  const hint = $('#backupHint');
  hint.className = 'hint';
  const r = parseBackup($('#backupText').value);
  if (!r.ok) { hint.className = 'hint warn'; hint.textContent = r.error; return; }

  const games = r.state.byGame.filter(gameHasData).length;
  const bets = r.state.byGame.reduce((n, g) => n + countBets(g), 0);
  const when = r.exportedAt && !Number.isNaN(Date.parse(r.exportedAt))
    ? ' made ' + new Date(r.exportedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';
  const hasData = state.byGame.some(gameHasData);
  // nothing here to lose (e.g. a fresh Home Screen copy) → no need to ask
  if (hasData && !confirm(`Restore the backup${when}?\n\nIt has ${bets} bet${bets === 1 ? '' : 's'} in ${games} game${games === 1 ? '' : 's'}. The bets, dates and winning numbers on this device will be replaced. Saved official results from the backup are added to the ones here.`)) return;

  state = r.state;
  const merged = mergeResults(results, resultsToList(r.results));
  results = merged.db;
  const saved = saveResults(results);
  persist();
  render();
  renderSavedList();
  autoFillWinning();
  $('#backupText').value = '';
  setStatus(saved.ok ? 'success' : 'warn',
    `Backup restored: ${bets} bet${bets === 1 ? '' : 's'} in ${games} game${games === 1 ? '' : 's'}` +
    (merged.added ? `, ${merged.added} saved official result${merged.added === 1 ? '' : 's'} added` : '') + '.' +
    (saved.ok ? '' : ' ' + saved.error));
}

// ---------------------------------------------------------------- Lucky Pick

const fmtPick = nums => nums.map(n => String(n).padStart(2, '0')).join('-');

function flashBet(i) {
  const row = $('#bets').children[i];
  row?.classList.remove('lucky');
  void row?.offsetWidth; // restart the animation
  row?.classList.add('lucky');
}

function makePick() {
  try { return luckyPick(game().max); }
  catch (e) { setStatus('error', 'Lucky Pick is not available: ' + e.message); return null; }
}

function luckyBet(i) {
  const has = draw().bets[i].some(Boolean);
  if (has && !confirm(`Replace Bet ${i + 1} with a Lucky Pick?`)) return;
  const nums = makePick();
  if (!nums) return;
  draw().bets[i] = nums.map(String);
  afterEdit(`🎲 Bet ${i + 1} Lucky Pick: ${fmtPick(nums)}`);
  flashBet(i);
}

function luckyEmptyBets() {
  const empty = draw().bets.map((b, i) => (b.some(Boolean) ? -1 : i)).filter(i => i >= 0);
  if (!empty.length) { setStatus('info', 'All six bets already have numbers. Use 🎲 on a bet to replace it.'); return; }
  const lines = [];
  for (const i of empty) {
    const nums = makePick();
    if (!nums) return;
    draw().bets[i] = nums.map(String);
    lines.push(`Bet ${i + 1}: ${fmtPick(nums)}`);
  }
  const dated = autoSetDate();
  persist();
  render();
  empty.forEach(flashBet);
  setStatus('success', `🎲 Lucky Pick filled ${empty.length} empty bet${empty.length > 1 ? 's' : ''}.`,
    dated ? [...lines, autoDateNote(dated)] : lines);
}

function afterEdit(message) {
  const dated = autoSetDate();
  persist();
  render();
  setStatus('info', dated ? `${message} ${autoDateNote(dated)}` : message);
}

// ---------------------------------------------------------------- compare

function markBad(key, indexes) {
  rowInputs(key).forEach((x, j) => x.classList.toggle('invalid', indexes.includes(j)));
}

function compare() {
  clearResults();
  const g = game();
  const d = draw();
  const problems = [];
  const warnings = [];

  const date = checkDate(d.date);
  if (!date.ok) problems.push(date.error);
  else warnings.push(...date.warnings);

  const bets = d.bets.map(b => validateSet(b, g.max, { allowEmpty: true }));
  const badBets = [];
  bets.forEach((r, i) => {
    if (r.status !== 'invalid') return;
    badBets.push(`Bet ${i + 1}: ${r.errors.join(' ')}`);
    markBad(i, r.badIndexes);
    const res = $(`#r${i}`);
    res.textContent = 'Not checked — fix this bet first.';
    res.className = 'result error';
  });

  // Draw not held yet: bets are fine to keep, but there is nothing to compare with.
  if (date.ok && !date.resultsReady) {
    const okBets = bets.filter(r => r.status === 'ok').length;
    setStatus(badBets.length ? 'warn' : 'info',
      `⏳ ${date.waiting} ${okBets ? `Your ${okBets} bet${okBets > 1 ? 's are' : ' is'} saved.` : ''}`.trim(),
      badBets);
    return;
  }

  const win = validateSet(d.wins, g.max);
  if (win.status !== 'ok') {
    problems.push('Winning numbers: ' + win.errors.join(' '));
    markBad('w', win.badIndexes);
  }

  const validBets = bets.map(r => (r.status === 'ok' ? r.numbers : null));
  const validCount = validBets.filter(Boolean).length;
  if (validCount === 0 && badBets.length === 0) problems.push('Enter at least one complete bet.');

  // Cannot compare at all: stop and list everything that is wrong.
  if (problems.length || validCount === 0) {
    setStatus('error', 'Please fix the following:', [...problems, ...badBets]);
    $('.cell.invalid')?.focus();
    return;
  }

  findDuplicateBets(validBets).forEach(group =>
    warnings.push(`Bets ${group.map(i => i + 1).join(' and ')} have the same numbers.`));

  let best = 0;
  let winners = 0;
  let jackpot = false;
  const matchedWinning = new Set();

  validBets.forEach((nums, i) => {
    if (!nums) return;
    const hits = matchNumbers(nums, win.numbers);
    hits.forEach(n => matchedWinning.add(n));
    best = Math.max(best, hits.length);

    rowInputs(i).forEach(x => x.classList.toggle('match', hits.includes(Number(x.value))));

    const tier = prizeTier(hits.length);
    const res = $(`#r${i}`);
    if (hits.length === PICK_COUNT) {
      res.textContent = '🎉 JACKPOT! 6/6 MATCH 🎉';
      res.className = 'result jackpot';
      jackpot = true;
    } else if (tier) {
      res.textContent = `${hits.length}/6 matches • ${tier}`;
      res.className = 'result prize';
    } else {
      res.textContent = `${hits.length}/6 matches • No prize`;
      res.className = 'result none';
    }
    if (tier) winners++;
  });

  rowInputs('w').forEach(x => x.classList.toggle('match', matchedWinning.has(Number(x.value))));

  const summary = jackpot
    ? 'JACKPOT! A bet matched all six winning numbers.'
    : `Checked ${validCount} bet${validCount > 1 ? 's' : ''}. Best result: ${best}/6. ` +
      (winners ? `${winners} winning bet${winners > 1 ? 's' : ''}.` : 'No winning bets.');

  const notes = [...badBets, ...warnings];
  setStatus(jackpot || winners ? (notes.length ? 'warn' : 'success') : (notes.length ? 'warn' : 'info'), summary, notes);
  if (jackpot) celebrate();
}

function celebrate() {
  document.body.classList.add('flash');
  setTimeout(() => document.body.classList.remove('flash'), 2600);
}

// ---------------------------------------------------------------- start

window.addEventListener('error', e => setStatus('error', 'Unexpected error: ' + (e.message || 'unknown') + '. Please reload the page.'));
window.addEventListener('unhandledrejection', e => setStatus('error', 'Unexpected error: ' + (e.reason?.message || e.reason || 'unknown') + '.'));

build();
if (autoSetDate()) persist(); // bets saved without a date (e.g. from an older version) → next draw date
render();
renderSavedList();
if (autoFillWinning() === 'filled') setStatus('info', 'Winning numbers filled from saved official results.');
if (initial.warning) {
  setStatus('warn', initial.warning);
  $('#saveState').textContent = '⚠ ' + initial.warning;
  $('#saveState').classList.add('warn');
}

setInterval(refreshDrawLock, 30 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDrawLock(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
