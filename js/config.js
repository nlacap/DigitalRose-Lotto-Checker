// Static configuration. Nothing in here touches the DOM or storage.

export const APP_VERSION = '2.7.0';

export const STORAGE_KEY = 'pcso-lotto-checker-v1'; // kept so existing saved bets still load
export const BACKUP_KEY = STORAGE_KEY + '.backup';
export const RESULTS_KEY = 'pcso-lotto-results-v1'; // official winning numbers saved on this device
export const RESULTS_KEEP = 60;                     // draws kept per game
export const SCHEMA_VERSION = 2;

export const PICK_COUNT = 6; // numbers per bet / per draw
export const BET_SLOTS = 6;  // bet rows shown on screen

// drawDays: 0 = Sunday … 6 = Saturday. Used only for a soft warning, never to block.
export const GAMES = Object.freeze([
  { id: '6/42', name: 'Lotto 6/42',       max: 42, drawDays: [2, 4, 6] },
  { id: '6/45', name: 'Mega Lotto 6/45',  max: 45, drawDays: [1, 3, 5] },
  { id: '6/49', name: 'Super Lotto 6/49', max: 49, drawDays: [0, 2, 4] },
  { id: '6/55', name: 'Grand Lotto 6/55', max: 55, drawDays: [1, 3, 6] },
  { id: '6/58', name: 'Ultra Lotto 6/58', max: 58, drawDays: [0, 2, 5] },
]);

export const MAX_NUMBER = Math.max(...GAMES.map(g => g.max));

// PCSO draws are held at 9:00 PM Philippine time. Winning numbers for a draw
// can only be entered/compared once that time has passed.
export const DRAW_TIMEZONE = 'Asia/Manila';
export const DRAW_HOUR = 21;
export const DRAW_TIME_LABEL = '9:00 PM';

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// PCSO 6-number games pay for 3, 4, 5 and 6 matches.
export const PRIZE_TIERS = Object.freeze({
  6: 'JACKPOT',
  5: 'Winner – 5 numbers',
  4: 'Winner – 4 numbers',
  3: 'Winner – 3 numbers',
});
