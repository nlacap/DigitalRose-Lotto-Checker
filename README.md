# DigitalRose Lotto Checker

Offline iPhone web app for checking Philippine 6-number lotto bets
(6/42, 6/45, 6/49, 6/55, 6/58) against the official winning numbers.

**Live:** https://nlacap.github.io/DigitalRose-Lotto-Checker/
Current version is shown in the page footer (v2.7.0).

▶ **[How-to video](https://nlacap.github.io/DigitalRose-Lotto-Checker/docs/how-to-use.mp4)** (80 s) — also linked
from the app footer. It walks through every step below with the real app.

## Using it on iPhone

1. **Pick the game and draw date.** Each game (6/42, 6/45, 6/49, 6/55, 6/58) keeps its own bets, draw
   date and winning numbers, so switching games brings back what you saved for that game. If a game has
   bets but no date yet, the app fills in that game's **next draw date** (Philippine time; today counts
   until the 9:00 PM draw). A date you already set is never changed.
2. **Enter your bets** (up to 6) — any of:
   - type the numbers (the cursor jumps to the next box automatically),
   - tap **🎲 LUCKY PICK** on a bet for six random numbers, or **🎲 LUCKY PICK EMPTY BETS** to fill
     every empty bet at once (inside the number board, *Lucky Pick the rest* keeps the numbers you
     tapped and picks the others),
   - tap **NUMBER BOARD**,
   - open **📷 Scan or paste your ticket**, tap the box, choose **Scan Text**, point the camera
     at the ticket, then **FILL BETS**.
3. **Get the winning numbers** — any of:
   - open **📋 Scan or paste official results**, paste the results table, tap **SAVE RESULTS**
     (see below),
   - paste all six at once (e.g. `05-12-23-34-40-41`) into the first winning box,
   - type them or use the board.
4. After the 9:00 PM draw, tap **COMPARE ALL BETS**. Each bet shows its matches and prize tier (3, 4, 5 or 6 numbers).
5. Clearing, from smallest to largest:
   - **Clear Bets** — the bets of the selected game only.
   - **NEW DRAW / CLEAR ALL** — the draw date, bets and winning numbers of the **selected game only**;
     the other four games and your saved official results are not touched.
   - **CLEAR ALL GAMES** — the draw date, bets and winning numbers of **all five games**. It asks first,
     listing the games and number of bets it will remove. Saved official results are kept.
   - **Clear saved results** (under *Scan or paste official results*) — the saved official results for
     all games.

Everything is saved automatically on the phone and works offline once loaded.
Add it to the Home Screen from Safari's Share menu for an app-like icon.

### Saving official results

1. On pcso.gov.ph, open the lotto results search and find the draw.
2. Either select and **Copy** the results table in Safari, **or** take a screenshot, open it in
   Photos, press and hold on the text, select all, and **Copy**.
   Include the **DRAW DATE** column if you can.
3. In the checker, open **📋 Scan or paste official results**, paste, tap **SAVE RESULTS**.

What happens:

- Every 6/42–6/58 row is read and checked; 2D/3D/4D/6D rows are skipped.
- Results are stored **on this phone only** (newest 60 draws per game).
- Picking a game + draw date fills the winning numbers from a saved result.
- Numbers you typed are never overwritten — if they differ, a **USE SAVED OFFICIAL RESULT** button appears.
- The **Latest saved results** list under the paste box is tappable: it switches to that game and draw.
- If the pasted text has no draw date (e.g. the date column was cut off), results are saved under
  the app's Draw Date and a warning asks you to confirm it — PCSO's search-box date is not always
  the draw date.

Always confirm a winning ticket with PCSO before claiming a prize.

### About Lucky Pick

Numbers come from the iPhone's cryptographically secure random generator (`crypto.getRandomValues`),
not `Math.random()`, with rejection sampling so every number in the game has exactly the same chance.
A test checks the spread over 300,000 draws. Random numbers are as likely to win as any others —
no more, no less.

## Validation rules

- Each box accepts digits only; letters, signs and decimals are stripped as you type.
- Out-of-range and duplicate numbers turn red immediately, with a message under the row.
- Compare checks the draw date, the winning numbers and every bet, and lists **all** problems at once.
  Valid bets are still checked when another bet has an error.
- **Draw not held yet:** PCSO draws at 9:00 PM Philippine time. For today's draw before 9:00 PM,
  or any later date, bets can still be entered and are saved, but the winning numbers are locked,
  Compare explains that the draw hasn't happened, and pasted PCSO results for that date are rejected.
  The lock lifts by itself at 9:00 PM. Philippine time is used even if the phone is set to another zone.
- Warnings (not blocking): date not on the game's usual draw day (silenced when a saved official
  result exists for that date), two identical bets.
- Scanned/pasted tickets and results are validated line by line; rejected lines are listed, never
  silently kept.
- Saved data is checked and repaired on load; damaged data is reset with a backup copy kept
  (`pcso-lotto-checker-v1.backup`). Save failures (Private Browsing, storage full) are shown, not hidden.

## Project structure

```
index.html            page markup only
css/styles.css        all styling
js/config.js          games, number ranges, draw days, prize tiers, version, storage keys
js/validation.js      pure validation + matching logic (no DOM)          — unit tested
js/ticketParser.js    reads bets from scanned/pasted ticket text         — unit tested
js/resultsParser.js   reads official results copied/scanned from PCSO    — unit tested
js/luckyPick.js       secure, unbiased random numbers for Lucky Pick     — unit tested
js/storage.js         bets + saved results: load/save, repair, migration — unit tested
js/picker.js          number-board overlay
js/status.js          status message box
js/dom.js             small DOM helpers
js/app.js             controller: builds the page, wires events, runs Compare
sw.js                 offline cache
icons/                favicon, home-screen and PWA icons
docs/how-to-use.mp4   user-manual video (generated)
docs/make-video.py    records the video from the real app
tests/                node:test unit tests
```

Data on the phone (localStorage):

| Key | Contents |
|---|---|
| `pcso-lotto-checker-v1` | bets, winning numbers and draw date per game |
| `pcso-lotto-checker-v1.backup` | copy of damaged data, if it ever had to be reset |
| `pcso-lotto-results-v1` | saved official PCSO results |

## Development

```
npm test        # 46 unit tests, also run by GitHub Actions on every push
```

To preview locally, serve the folder over HTTP (ES modules don't load from `file://`):

```
python3 -m http.server 8000   # then open http://localhost:8000
```

### Updating the how-to video

After UI changes, regenerate it so it matches the app (needs Playwright + Chromium and ffmpeg):

```
python3 docs/make-video.py
```

The script drives the real app at iPhone size with demo data, adds captions and tap markers,
and writes `docs/how-to-use.mp4`. The iPhone *Scan Text* camera step can't be recorded, so the
video shows the scanned text appearing in the box.

### Releasing

1. Bump `APP_VERSION` in `js/config.js` (shown in the footer).
2. Bump `CACHE` in `sw.js`, and add any new file to its `ASSETS` list.
3. Push to `main`; GitHub Pages updates within a minute or two. On the phone, reload once.

## Changelog

- **2.7.0** — A game with saved bets but no draw date now gets its next draw date automatically (when you
  switch to the game, finish typing a bet, scan a ticket, Lucky Pick or use the number board). A date you
  already set is never changed. **NEW DRAW / CLEAR ALL** now names the game it clears and says the other
  games are not affected. New **CLEAR ALL GAMES** button clears every game's date, bets and winning
  numbers after a confirmation (saved official results are kept).
- **2.6.0** — New **Clear saved results** button (under *Scan or paste official results*) empties the
  saved official results for all games, no prompt. Removed the redundant **Clear Winning** button.
- **2.5.0** — Renamed to DigitalRose Lotto Checker (repo, header, title, app name); “PCSO results”
  wording changed to “official results”; not-affiliated notice in the footer.
- **2.4.0** — 🎲 Lucky Pick: per bet, for all empty bets, and to finish a pick on the number board.
- **2.3.0** — Winning numbers and Compare wait until the draw has happened (9:00 PM Philippine time);
  bets can be entered any time.
- **2.2.1** — How-to video for the user manual, linked from the app footer.
- **2.2.0** — Scan or paste official PCSO results; saved on the phone and auto-filled by game and
  draw date; warning when a draw date had to be assumed.
- **2.1.0** — Scan or paste your ticket (iPhone Live Text); paste six numbers into any row.
- **2.0.0** — Split into modules; live per-box validation; Compare lists every problem; prize tiers;
  safer storage and offline cache; unit tests and GitHub Actions.
- **1.x** — Original single-file checker; logo fixes.

## Disclaimer

DigitalRose Lotto Checker is an independent personal project. It is not affiliated with,
endorsed by or connected to the Philippine Charity Sweepstakes Office (PCSO). Game names are used
only to identify the draws being checked. Always confirm winning tickets with PCSO.
