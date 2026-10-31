// Persistence: load/save with schema checks, migration and safe failure.
// `store` is injectable so the logic can be tested without a browser.

import { STORAGE_KEY, BACKUP_KEY, RESULTS_KEY, RESULTS_KEEP, SCHEMA_VERSION, GAMES, BET_SLOTS, PICK_COUNT } from './config.js';
import { validateSet, parseIsoDate } from './validation.js';

const defaultStore = () => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

export const blankRow = () => Array(PICK_COUNT).fill('');
export const blankBets = () => Array.from({ length: BET_SLOTS }, blankRow);
export const blankGame = () => ({ date: '', bets: blankBets(), wins: blankRow() });
export const defaultState = () => ({
  v: SCHEMA_VERSION,
  game: 0,
  byGame: GAMES.map(blankGame),
});

/** Does one game's saved entry hold anything — a date, a bet or winning numbers? */
export const gameHasData = g =>
  !!g?.date || (g?.bets ?? []).some(row => row.some(Boolean)) || (g?.wins ?? []).some(Boolean);

/** Number of bet rows with at least one number in one game's saved entry. */
export const countBets = g => (g?.bets ?? []).filter(row => row.some(Boolean)).length;

/** The same state with every game blanked. Which game is selected is kept. Pure. */
export const clearAllGames = state => ({ ...state, byGame: GAMES.map(blankGame) });

const cleanCell = c => {
  const s = String(c ?? '').trim();
  return /^\d{1,2}$/.test(s) ? s : '';
};
const cleanRow = r => Array.from({ length: PICK_COUNT }, (_, i) => cleanCell(Array.isArray(r) ? r[i] : ''));
const cleanDate = d => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '');
const cleanGame = g => ({
  date: cleanDate(g?.date),
  bets: Array.from({ length: BET_SLOTS }, (_, i) => cleanRow(Array.isArray(g?.bets) ? g.bets[i] : null)),
  wins: cleanRow(g?.wins),
});

/**
 * Coerce anything read from storage into a valid state object.
 * Accepts the current shape, the earlier multi-game shape (no `v`),
 * and the original single-game shape {game, date, bets, wins}.
 */
export function sanitizeState(raw) {
  const s = defaultState();
  if (!raw || typeof raw !== 'object') return s;

  const gameIdx = Number.isInteger(raw.game) && raw.game >= 0 && raw.game < GAMES.length ? raw.game : 0;
  s.game = gameIdx;

  if (Array.isArray(raw.byGame)) {
    s.byGame = GAMES.map((_, i) => cleanGame(raw.byGame[i]));
  } else if (Array.isArray(raw.bets) || Array.isArray(raw.wins)) {
    s.byGame[gameIdx] = cleanGame(raw); // legacy single-game format
  }
  return s;
}

/** @returns {{state:object, warning:string|null}} */
export function loadState(store = defaultStore()) {
  if (!store) return { state: defaultState(), warning: 'Storage is not available (Private Browsing?). Entries will not be saved.' };

  let text;
  try { text = store.getItem(STORAGE_KEY); }
  catch { return { state: defaultState(), warning: 'Could not read saved data. Starting fresh.' }; }
  if (text == null) return { state: defaultState(), warning: null };

  try {
    return { state: sanitizeState(JSON.parse(text)), warning: null };
  } catch {
    try { store.setItem(BACKUP_KEY, text); } catch { /* ignore */ }
    return { state: defaultState(), warning: 'Saved data was damaged and has been reset. A backup copy was kept.' };
  }
}

/** @returns {{ok:boolean, error:string|null}} */
export function saveState(state, store = defaultStore()) {
  if (!store) return { ok: false, error: 'Storage is not available — changes are not being saved.' };
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ ...state, v: SCHEMA_VERSION }));
    return { ok: true, error: null };
  } catch (e) {
    const full = e && (e.name === 'QuotaExceededError' || e.code === 22);
    return { ok: false, error: full ? 'Device storage is full — changes are not being saved.' : 'Could not save — changes are not being saved.' };
  }
}

// ---------------------------------------------------------------- official results
// Shape: { "<gameIndex>": { "YYYY-MM-DD": [n1..n6 sorted] } }

/** Keep only well-formed entries, newest RESULTS_KEEP per game. */
export function sanitizeResults(raw) {
  const out = {};
  GAMES.forEach((g, gi) => {
    const src = raw && typeof raw === 'object' ? raw[gi] : null;
    if (!src || typeof src !== 'object') return;
    const entries = Object.entries(src)
      .filter(([date, nums]) => parseIsoDate(date) && Array.isArray(nums) &&
        validateSet(nums.map(String), g.max).status === 'ok')
      .map(([date, nums]) => [date, validateSet(nums.map(String), g.max).numbers])
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, RESULTS_KEEP);
    if (entries.length) out[gi] = Object.fromEntries(entries);
  });
  return out;
}

/** Merge parsed results into the saved set. Pure. */
export function mergeResults(db, results) {
  const next = JSON.parse(JSON.stringify(db || {}));
  const counts = { added: 0, changed: 0, same: 0 };
  results.forEach(({ gameIndex, date, numbers }) => {
    next[gameIndex] ??= {};
    const old = next[gameIndex][date];
    if (!old) counts.added++;
    else if (old.join() === numbers.join()) counts.same++;
    else counts.changed++;
    next[gameIndex][date] = numbers;
  });
  return { db: sanitizeResults(next), ...counts };
}

/** Saved result for a game and date, or null. */
export function findResult(db, gameIndex, date) {
  return db?.[gameIndex]?.[date] ?? null;
}

/** Newest saved draw for a game: {date, numbers} or null. */
export function latestResult(db, gameIndex) {
  const dates = Object.keys(db?.[gameIndex] ?? {}).sort();
  const date = dates[dates.length - 1];
  return date ? { date, numbers: db[gameIndex][date] } : null;
}

export function loadResults(store = defaultStore()) {
  try {
    const text = store?.getItem(RESULTS_KEY);
    return text ? sanitizeResults(JSON.parse(text)) : {};
  } catch { return {}; }
}

export function saveResults(db, store = defaultStore()) {
  if (!store) return { ok: false, error: 'Storage is not available — results were not saved.' };
  try { store.setItem(RESULTS_KEY, JSON.stringify(db)); return { ok: true, error: null }; }
  catch { return { ok: false, error: 'Could not save the results on this device.' }; }
}
