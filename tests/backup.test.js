import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBackup, parseBackup, resultsToList, BACKUP_APP } from '../js/backup.js';
import { defaultState, sanitizeState, mergeResults, gameHasData } from '../js/storage.js';

const sample = () => {
  const st = defaultState();
  st.game = 2;
  st.byGame[0].date = '2026-10-31';
  st.byGame[0].bets[0] = ['4', '8', '15', '16', '23', '42'];
  st.byGame[2].bets[1] = ['01', '02', '03', '04', '05', '06'];
  st.byGame[2].wins = ['7', '14', '21', '28', '35', '42'];
  const results = { 0: { '2026-10-29': [3, 9, 14, 22, 31, 40] }, 4: { '2026-10-30': [1, 2, 3, 4, 5, 6] } };
  return { st, results };
};

test('round trip keeps bets, dates, winning numbers, selected game and results', () => {
  const { st, results } = sample();
  const text = makeBackup(st, results, new Date('2026-10-31T12:10:00Z'));
  const r = parseBackup(text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.state, sanitizeState(st));
  assert.deepEqual(r.results, results);
  assert.equal(r.exportedAt, '2026-10-31T12:10:00.000Z');
  assert.equal(r.state.game, 2);
});

test('making a backup does not change what it is given', () => {
  const { st, results } = sample();
  const before = JSON.stringify([st, results]);
  makeBackup(st, results);
  assert.equal(JSON.stringify([st, results]), before);
});

test('survives curly quotes, extra words and stray spaces from Notes/Messages', () => {
  const { st, results } = sample();
  const text = makeBackup(st, results);
  const mangled = '  Here is my backup:\n' + text.replace(/"/g, '“') + '\n\nThanks!  ';
  const r = parseBackup(mangled);
  assert.equal(r.ok, true);
  assert.deepEqual(r.state, sanitizeState(st));
});

test('refuses anything that is not clearly one of our backups', () => {
  const good = makeBackup(sample().st, {});
  const refused = [
    '',
    '   ',
    'hello',
    '{"a":1}',
    good.slice(0, good.length - 40),                      // cut off
    JSON.stringify({ app: 'Something Else', state: {} }), // someone else's JSON
    JSON.stringify({ app: BACKUP_APP }),                  // no state
    JSON.stringify({ app: BACKUP_APP, format: 99, state: {} }), // from the future
  ];
  for (const t of refused) {
    const r = parseBackup(t);
    assert.equal(r.ok, false, `should refuse: ${t.slice(0, 40)}`);
    assert.ok(r.error.length > 10);
  }
});

test('damaged content is repaired, not trusted', () => {
  const text = JSON.stringify({
    app: BACKUP_APP, format: 1,
    state: { game: 99, byGame: [{ date: 'not a date', bets: [['abc', '5', '', '', '', '777']], wins: null }] },
    results: { 0: { '2026-10-29': [1, 2, 3], '2026-10-30': [3, 9, 14, 22, 31, 40] } }, // first is not six numbers
  });
  const r = parseBackup(text);
  assert.equal(r.ok, true);
  assert.equal(r.state.game, 0);
  assert.equal(r.state.byGame[0].date, '');
  assert.deepEqual(r.state.byGame[0].bets[0], ['', '5', '', '', '', '']);
  assert.deepEqual(Object.keys(r.results[0]), ['2026-10-30']);
});

test('a backup with no results restores fine', () => {
  const r = parseBackup(makeBackup(defaultState(), undefined));
  assert.equal(r.ok, true);
  assert.deepEqual(r.results, {});
  assert.equal(r.state.byGame.some(gameHasData), false);
});

test('resultsToList feeds mergeResults', () => {
  const { results } = sample();
  const list = resultsToList(results);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { gameIndex: 0, date: '2026-10-29', numbers: [3, 9, 14, 22, 31, 40] });
  const merged = mergeResults({ 0: { '2026-10-22': [1, 2, 3, 4, 5, 6] } }, list);
  assert.equal(Object.keys(merged.db[0]).length, 2); // existing result kept, backup's added
  assert.equal(merged.db[4]['2026-10-30'].join(), '1,2,3,4,5,6');
  assert.equal(merged.added, 2);
  assert.deepEqual(resultsToList(null), []);
});
