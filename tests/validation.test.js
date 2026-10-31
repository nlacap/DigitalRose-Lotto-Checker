import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeInput, parseCell, validateSet, liveCheck, parseIsoDate,
  validateDrawDate, matchNumbers, prizeTier, findDuplicateBets,
  manilaNow, drawStatus, resultsAvailable, nextDrawDate,
} from '../js/validation.js';
import { GAMES } from '../js/config.js';

const g642 = GAMES[0];

test('sanitizeInput keeps at most two digits', () => {
  assert.equal(sanitizeInput('4a2'), '42');
  assert.equal(sanitizeInput('-5'), '5');
  assert.equal(sanitizeInput('1.5'), '15');
  assert.equal(sanitizeInput('123'), '12');
  assert.equal(sanitizeInput(null), '');
});

test('parseCell', () => {
  assert.deepEqual(parseCell('', 42), { kind: 'empty' });
  assert.deepEqual(parseCell(' 7 ', 42), { kind: 'ok', value: 7 });
  assert.deepEqual(parseCell('07', 42), { kind: 'ok', value: 7 });
  assert.equal(parseCell('0', 42).kind, 'invalid');
  assert.equal(parseCell('43', 42).kind, 'invalid');
  assert.equal(parseCell('43', 45).kind, 'ok');
  assert.equal(parseCell('e', 42).kind, 'invalid');
  assert.equal(parseCell('4.5', 42).kind, 'invalid');
});

test('validateSet: valid row is sorted', () => {
  const r = validateSet(['30', '2', '15', '42', '1', '9'], 42);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.numbers, [1, 2, 9, 15, 30, 42]);
});

test('validateSet: empty row', () => {
  assert.equal(validateSet(Array(6).fill(''), 42, { allowEmpty: true }).status, 'empty');
  assert.equal(validateSet(Array(6).fill(''), 42).status, 'invalid');
});

test('validateSet: reports every problem and the cells involved', () => {
  const r = validateSet(['5', '5', '50', '', '1', '2'], 42);
  assert.equal(r.status, 'invalid');
  assert.deepEqual(r.badIndexes, [0, 1, 2, 3]);
  assert.ok(r.errors.some(e => e.includes('outside 1–42')));
  assert.ok(r.errors.some(e => e.includes('more than once')));
  assert.ok(r.errors.some(e => e.includes('5 of 6')));
});

test('liveCheck ignores cells not typed yet', () => {
  assert.deepEqual(liveCheck(['1', '2', '', '', '', ''], 42), { badIndexes: [], errors: [] });
  const r = liveCheck(['1', '1', '', '', '', ''], 42);
  assert.deepEqual(r.badIndexes, [0, 1]);
});

test('parseIsoDate rejects impossible dates', () => {
  assert.ok(parseIsoDate('2026-10-08'));
  assert.equal(parseIsoDate('2026-02-30'), null);
  assert.equal(parseIsoDate('10/08/2026'), null);
});

// 13:00 and 21:30 Philippine time on Fri 9 Oct 2026 (UTC+8)
const afternoon = new Date('2026-10-09T05:00:00Z');
const night = new Date('2026-10-09T13:30:00Z');

test('manilaNow uses Philippine time regardless of the phone zone', () => {
  assert.deepEqual(manilaNow(afternoon), { date: '2026-10-09', minutes: 13 * 60 });
  assert.deepEqual(manilaNow(new Date('2026-10-09T16:30:00Z')), { date: '2026-10-10', minutes: 30 });
});

test('drawStatus and resultsAvailable', () => {
  assert.equal(drawStatus('2026-10-08', afternoon), 'past');
  assert.equal(drawStatus('2026-10-09', afternoon), 'tonight');
  assert.equal(drawStatus('2026-10-09', night), 'drawn');
  assert.equal(drawStatus('2026-10-10', night), 'future');
  assert.equal(resultsAvailable('2026-10-09', afternoon), false);
  assert.equal(resultsAvailable('2026-10-09', new Date('2026-10-09T13:00:00Z')), true); // exactly 9:00 PM
  assert.equal(resultsAvailable('2026-10-08', afternoon), true);
  assert.equal(resultsAvailable('2026-10-12', night), false);
});

test('validateDrawDate', () => {
  assert.equal(validateDrawDate('', g642, afternoon).ok, false);
  assert.equal(validateDrawDate('2026-13-01', g642, afternoon).ok, false);
  // Thu 8 Oct is a 6/42 draw day
  const thu = validateDrawDate('2026-10-08', g642, afternoon);
  assert.deepEqual(thu.warnings, []);
  assert.equal(thu.resultsReady, true);
  // Wed 7 Oct is not
  assert.equal(validateDrawDate('2026-10-07', g642, afternoon).warnings.length, 1);
  // today before 9 PM / future: valid for bets, but no results yet
  const tonight = validateDrawDate('2026-10-09', GAMES[1], afternoon);
  assert.equal(tonight.ok, true);
  assert.equal(tonight.resultsReady, false);
  assert.match(tonight.waiting, /9:00 PM/);
  assert.equal(validateDrawDate('2026-10-09', GAMES[1], night).resultsReady, true);
  assert.equal(validateDrawDate('2026-10-13', g642, night).resultsReady, false);
});

test('matching and prizes', () => {
  assert.deepEqual(matchNumbers([1, 2, 3, 4, 5, 6], [4, 5, 6, 7, 8, 9]), [4, 5, 6]);
  assert.equal(prizeTier(6), 'JACKPOT');
  assert.ok(prizeTier(3));
  assert.equal(prizeTier(2), null);
});

test('findDuplicateBets', () => {
  const a = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(findDuplicateBets([a, null, [6, 5, 4, 3, 2, 1], [1, 2, 3, 4, 5, 7]]), [[0, 2]]);
});

test('nextDrawDate: today counts only until the 9 PM draw', () => {
  // Fri 9 Oct 2026. 6/45 and 6/58 draw on Fridays; 6/42 does not (Tue/Thu/Sat).
  assert.equal(nextDrawDate(GAMES[1], afternoon), '2026-10-09'); // 6/45, Friday before 9 PM → tonight
  assert.equal(nextDrawDate(GAMES[1], night), '2026-10-12');     // after 9 PM → Monday
  assert.equal(nextDrawDate(GAMES[4], afternoon), '2026-10-09'); // 6/58 (Sun/Tue/Fri)
  assert.equal(nextDrawDate(GAMES[4], night), '2026-10-11');     // → Sunday
  assert.equal(nextDrawDate(g642, afternoon), '2026-10-10');     // 6/42 → Saturday
});

test('nextDrawDate: month rollover and every game lands on its own draw day', () => {
  const satEvening = new Date('2026-10-31T12:00:00Z'); // Sat 31 Oct, 8:00 PM Manila
  const satNight = new Date('2026-10-31T14:00:00Z');   // Sat 31 Oct, 10:00 PM Manila
  assert.equal(nextDrawDate(g642, satEvening), '2026-10-31');
  assert.equal(nextDrawDate(g642, satNight), '2026-11-03'); // Tuesday, next month
  for (const g of GAMES) {
    const iso = nextDrawDate(g, satNight);
    assert.ok(g.drawDays.includes(parseIsoDate(iso).getDay()), `${g.id} → ${iso}`);
    assert.ok(iso > '2026-10-31');
  }
});

test('nextDrawDate uses Philippine time, not the phone zone', () => {
  // 16:30 UTC Fri = 00:30 Sat in Manila → 6/42 draws tonight (Saturday), not next Tuesday
  assert.equal(nextDrawDate(g642, new Date('2026-10-09T16:30:00Z')), '2026-10-10');
});

test('nextDrawDate falls back to today for a game with no draw days', () => {
  assert.equal(nextDrawDate({ id: 'x' }, afternoon), '2026-10-09');
});
