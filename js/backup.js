// Back up and restore: turn the bets and saved official results into one piece of text and back,
// so the data can be moved to another copy of the app (Safari ↔ Home Screen icon, another iPhone).
// Pure — no DOM, no storage. Covered by tests/backup.test.js.

import { APP_VERSION } from './config.js';
import { sanitizeState, sanitizeResults } from './storage.js';

export const BACKUP_APP = 'DigitalRose Lotto Checker';
export const BACKUP_FORMAT = 1;

/** One line of text holding everything worth moving. */
export function makeBackup(state, results, now = new Date()) {
  return JSON.stringify({
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    appVersion: APP_VERSION,
    exportedAt: now.toISOString(),
    state,
    results: results ?? {},
  });
}

/**
 * Read a backup back. Forgiving about how the text got here: curly quotes (Notes/Messages can swap
 * them in), extra words around it, stray spaces. Strict about what it accepts: anything that is not
 * clearly one of our backups is refused, and accepted data is repaired the same way as saved data.
 * @returns {{ok:true, state:object, results:object, exportedAt:string|null} | {ok:false, error:string}}
 */
export function parseBackup(text) {
  const s = String(text ?? '').replace(/[“”„‟]/g, '"').trim();
  if (!s) return { ok: false, error: 'Paste your backup into the box first.' };

  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, error: 'That does not look like a backup. Copy the whole backup again from the other copy of the app.' };

  let obj;
  try { obj = JSON.parse(s.slice(start, end + 1)); }
  catch { return { ok: false, error: 'The backup text is incomplete or was changed. Copy the whole backup again from the other copy of the app.' }; }

  if (!obj || obj.app !== BACKUP_APP || !obj.state || typeof obj.state !== 'object') {
    return { ok: false, error: `This is not a ${BACKUP_APP} backup.` };
  }
  if (typeof obj.format === 'number' && obj.format > BACKUP_FORMAT) {
    return { ok: false, error: 'This backup was made by a newer version of the app. Update this copy first, then try again.' };
  }
  return {
    ok: true,
    state: sanitizeState(obj.state),
    results: sanitizeResults(obj.results),
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : null,
  };
}

/** Saved results as the list form that mergeResults() takes: [{gameIndex, date, numbers}]. */
export function resultsToList(db) {
  return Object.entries(db ?? {}).flatMap(([gi, byDate]) =>
    Object.entries(byDate).map(([date, numbers]) => ({ gameIndex: Number(gi), date, numbers })));
}
