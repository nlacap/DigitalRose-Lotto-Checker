#!/usr/bin/env python3
"""
Records the "How to use" video for the user manual.

Drives the real app in a headless browser at iPhone size, adds captions and
tap markers, captures crisp frames and assembles them into docs/how-to-use.mp4.

    pip install playwright        # Chromium must be available
    python3 docs/make-video.py    # needs ffmpeg on PATH

Re-run after UI changes so the video matches the app.
"""
import http.server, os, shutil, socketserver, subprocess, sys, tempfile, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "how-to-use.mp4"
FPS = 15
W, H = 390, 844          # iPhone 14/15 viewport (CSS px)
SCALE = 2                # frames are 780 x 1688
READ = 1.35              # stretch caption hold times so they can be read

# --- demo data (Ultra Lotto 6/58 draw of 10/9/2026) --------------------------
TICKET = """ULTRA LOTTO 6/58
DRAW 10/09/26 FRI
A. 02 14 29 30 33 41
B. 05 14 22 30 41 49
C. 01 02 03 38 45 50
TOTAL P72.00"""
RESULTS = """LOTTO GAME\tCOMBINATIONS\tDRAW DATE\tJACKPOT (PHP)\tWINNERS
Ultra Lotto 6/58\t29-38-33-14-02-30\t10/9/2026\t377,056,593.95\t0
Megalotto 6/45\t30-24-32-26-35-25\t10/9/2026\t101,025,083.06\t0
4D Lotto\t7-1-7-9\t10/9/2026\t68,566.00\t13"""

OVERLAY_CSS = """
#demoCap{position:fixed;left:12px;right:12px;z-index:9999;background:rgba(3,10,25,.94);
 border:1px solid #39cfff88;border-radius:16px;padding:12px 14px;color:#fff;
 font:600 15px/1.35 -apple-system,Inter,Arial,sans-serif;box-shadow:0 8px 30px #000a;
 display:flex;gap:11px;align-items:flex-start}
#demoCap.bottom{bottom:18px}#demoCap.top{top:14px}
#demoCap b{display:block;font-size:17px;margin-bottom:3px;color:#6dd4ff}
#demoCap .n{flex:none;width:30px;height:30px;border-radius:50%;background:#347ff0;
 display:grid;place-items:center;font-weight:900;font-size:15px}
#demoTap{position:fixed;z-index:9998;border-radius:50%;pointer-events:none;
 border:3px solid #ffd84d;background:#ffd84d44;transform:translate(-50%,-50%)}
#demoCard{position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;
 align-items:center;justify-content:center;text-align:center;gap:14px;padding:30px;
 background:radial-gradient(circle at 50% 35%,#123a6e,#061126 70%);color:#fff;
 font:600 16px/1.45 -apple-system,Inter,Arial,sans-serif}
#demoCard img{width:150px;height:150px;border-radius:50%;box-shadow:0 0 40px #39cfff88}
#demoCard h1{font-size:30px;margin:6px 0 0}#demoCard p{margin:0;color:#afc0da}
#demoCard ul{text-align:left;margin:6px 0 0;padding-left:20px;color:#dbe6f7}
#demoCard li{margin:6px 0}
"""


class Recorder:
    def __init__(self, page, frames_dir):
        self.page, self.dir, self.items, self.n = page, Path(frames_dir), [], 0

    # ---- frames
    def shot(self, dur=1 / FPS):
        path = self.dir / f"f{self.n:05d}.png"
        self.n += 1
        self.page.screenshot(path=str(path))
        self.items.append((path, dur))

    def hold(self, sec):
        self.shot(sec * READ)

    # ---- overlays
    def caption(self, step, title, text, pos="bottom"):
        self.page.evaluate(
            """([s,t,x,p])=>{let c=document.getElementById('demoCap');
            if(!c){c=document.createElement('div');c.id='demoCap';document.body.appendChild(c)}
            c.className=p;c.innerHTML=(s?'<div class=n>'+s+'</div>':'')+'<div><b>'+t+'</b>'+x+'</div>'}""",
            [step, title, text, pos])

    def no_caption(self):
        self.page.evaluate("document.getElementById('demoCap')?.remove()")

    def card(self, html):
        self.page.evaluate("""h=>{let c=document.getElementById('demoCard');
            if(!c){c=document.createElement('div');c.id='demoCard';document.body.appendChild(c)}c.innerHTML=h}""", html)

    def no_card(self):
        self.page.evaluate("document.getElementById('demoCard')?.remove()")

    # ---- motion
    def scroll_to(self, selector, frac=0.30, steps=10):
        target = self.page.evaluate(
            """([s,f])=>{const r=document.querySelector(s).getBoundingClientRect();
            return Math.max(0, Math.min(scrollY + r.top - innerHeight*f, document.documentElement.scrollHeight-innerHeight))}""",
            [selector, frac])
        start = self.page.evaluate("scrollY")
        for i in range(1, steps + 1):
            t = i / steps
            ease = t * t * (3 - 2 * t)
            self.page.evaluate("y=>scrollTo(0,y)", start + (target - start) * ease)
            self.shot()

    def tap(self, selector, click=True):
        box = self.page.locator(selector).first.bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        for size, alpha in [(18, 1), (30, 1), (42, .9), (52, .8)]:
            self.page.evaluate("""([x,y,s,a])=>{let d=document.getElementById('demoTap');
                if(!d){d=document.createElement('div');d.id='demoTap';document.body.appendChild(d)}
                Object.assign(d.style,{left:x+'px',top:y+'px',width:s+'px',height:s+'px',opacity:a})}""",
                [x, y, size, alpha])
            self.shot()
        if click:
            self.page.locator(selector).first.click()
        self.page.evaluate("document.getElementById('demoTap')?.remove()")
        self.shot()

    def type_cells(self, row, values, per_char=2):
        for j, v in enumerate(values):
            sel = f'.cell[data-row="{row}"][data-j="{j}"]'
            self.page.locator(sel).click()
            for ch in v:
                self.page.keyboard.type(ch)
                for _ in range(per_char):
                    self.shot()

    def type_text(self, selector, text, chunk="line"):
        loc = self.page.locator(selector)
        loc.fill("")
        parts = text.split("\n")
        acc = []
        for p in parts:
            acc.append(p)
            loc.fill("\n".join(acc))
            self.page.evaluate("s=>document.querySelector(s).scrollTop=0", selector)
            for _ in range(4):
                self.shot()

    # ---- output
    def encode(self, out):
        lst = self.dir / "list.txt"
        with lst.open("w") as f:
            for p, d in self.items:
                f.write(f"file '{p.name}'\nduration {d:.4f}\n")
            f.write(f"file '{self.items[-1][0].name}'\n")
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
            "-vf", f"fps={FPS},format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "24",
            "-movflags", "+faststart", str(out)], check=True, cwd=self.dir)


def serve(root):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = lambda *a, **k: Quiet(*a, directory=str(root), **k)
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main():
    httpd = serve(ROOT)
    url = f"http://127.0.0.1:{httpd.server_address[1]}/index.html"
    tmp = Path(tempfile.mkdtemp(prefix="demo-frames-"))
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=SCALE,
                                  is_mobile=True, has_touch=True)
        page = ctx.new_page()
        page.on("dialog", lambda d: d.accept())
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(url)
        page.evaluate("localStorage.clear()")
        page.reload()
        page.add_style_tag(content=OVERLAY_CSS)
        page.evaluate("navigator.serviceWorker?.getRegistrations().then(r=>r.forEach(x=>x.unregister()))")
        page.wait_for_timeout(400)
        version = page.inner_text("#version")
        r = Recorder(page, tmp)

        # ---- intro
        r.card(f"""<img src="icons/logo-512.png" alt=""><h1>DigitalRose Lotto Checker</h1>
            <p>How to use · {version}</p><p style="margin-top:18px;color:#7ee6b1">Check all your bets against the official
            results in under a minute — even offline.</p>""")
        page.wait_for_timeout(300)
        r.hold(3.2)
        r.no_card()
        r.hold(0.4)

        # ---- 1. game & date
        r.caption(1, "Choose your lotto game", "Tap the game printed on your ticket.")
        r.hold(1.6)
        r.tap(".tab:nth-child(5)")
        r.hold(1.2)
        r.caption(1, "Set the draw date", "Use the date of the draw you are checking.")
        r.tap("#drawDate", click=False)
        page.fill("#drawDate", "2026-10-09")
        page.dispatch_event("#drawDate", "change")
        r.hold(2.2)

        # ---- 2. scan ticket
        r.scroll_to("#quickFill", 0.18)
        r.caption(2, "Scan your ticket", "Open <i>Scan or paste your ticket</i>.")
        r.hold(1.6)
        r.tap("#quickFill summary")
        r.hold(0.8)
        r.caption(2, "Tap the box → Scan Text",
                  "Point your iPhone camera at the ticket and tap <i>Insert</i>. The numbers appear as text.")
        r.tap("#ticketText", click=False)
        r.hold(1.0)
        r.type_text("#ticketText", TICKET)
        r.hold(2.2)
        r.caption(2, "Tap FILL BETS", "Each line with six numbers becomes a bet. Check them against your ticket.")
        r.tap("#fillBets")
        r.hold(0.6)
        r.scroll_to("#bets .bet:nth-child(1)", 0.12)
        r.hold(2.8)

        # ---- 3. type a bet
        r.scroll_to("#bets .bet:nth-child(4)", 0.22)
        r.caption(3, "Or type your numbers", "The cursor jumps to the next box by itself.")
        r.hold(1.4)
        r.type_cells(3, ["10", "20", "29", "33", "38", "55"])
        r.hold(1.6)

        # ---- 4. mistakes + number board
        r.scroll_to("#bets .bet:nth-child(5)", 0.22)
        r.caption(4, "Mistakes turn red right away", "Here 14 was entered twice.")
        r.type_cells(4, ["14", "14"])
        r.hold(2.6)
        r.caption(4, "Or pick on the number board", "Tap NUMBER BOARD.")
        r.tap('.pickBet[data-i="4"]')
        r.caption(4, "Tap six numbers, then SAVE", "Numbers outside the game's range are hidden.", pos="top")
        r.tap("#pickerClear")
        for n in [2, 14, 29, 30, 7, 21]:
            r.tap(f'.num[data-n="{n}"]')
        r.hold(0.8)
        r.tap("#pickerSave")
        r.hold(1.8)

        # ---- 4b. Lucky Pick
        r.caption(4, "Or let it pick for you", "🎲 LUCKY PICK draws six truly random numbers.")
        r.scroll_to("#bets .bet:nth-child(6)", 0.22)
        r.hold(1.4)
        r.tap('.luckyBet[data-i="5"]')
        r.hold(2.4)

        # ---- 5. official results
        r.scroll_to("#resultsFill", 0.14)
        r.caption(5, "Get the winning numbers", "Open <i>Scan or paste official results</i>.")
        r.hold(1.4)
        r.tap("#resultsFill summary")
        r.hold(0.6)
        r.caption(5, "Paste the official results",
                  "On pcso.gov.ph copy the results table — or copy the text from a screenshot in Photos — and paste it here.")
        r.scroll_to("#resultsText", 0.30, steps=6)
        r.tap("#resultsText", click=False)
        page.fill("#resultsText", RESULTS)
        page.evaluate("document.querySelector('#resultsText').scrollTop = 0")
        r.hold(2.8)
        r.caption(5, "Tap SAVE RESULTS", "They're saved on your phone and fill the winning numbers for this game and date.")
        r.tap("#saveResults")
        r.scroll_to("#wins", 0.40)
        r.hold(2.8)

        # ---- 6. compare
        r.scroll_to("#compare", 0.30)
        r.caption(6, "Tap COMPARE ALL BETS", "")
        r.hold(0.8)
        r.tap("#compare")
        r.hold(0.6)
        r.caption(6, "See every result", "Green numbers matched. Each bet shows its matches and prize.")
        r.scroll_to("#bets .bet:nth-child(1)", 0.06, steps=14)
        r.hold(3.6)
        r.scroll_to("#status", 0.30, steps=14)
        r.caption(6, "Summary", "Best result and number of winning bets.", pos="top")
        r.hold(3.2)

        # ---- 7. date auto-fill, clearing, backup
        r.scroll_to("#newDraw", 0.30, steps=10)
        r.caption(7, "Dates fill themselves", "Enter bets and the next draw date for that game is set for you. Each game keeps its own bets.")
        r.hold(2.6)
        r.caption(7, "Clearing", "NEW DRAW clears only this game. CLEAR ALL GAMES wipes every game, after you confirm.")
        r.scroll_to("#clearAllGames", 0.30, steps=6)
        r.hold(3.0)
        r.scroll_to("#backupFill", 0.20, steps=10)
        r.caption(7, "Back up or move your data", "Open this section, tap COPY BACKUP, then paste it into RESTORE FROM BOX on another copy, e.g. Safari to the Home Screen icon.")
        r.hold(2.0)
        r.tap("#backupFill summary")
        r.scroll_to("#copyBackup", 0.40, steps=6)
        r.hold(2.0)
        r.tap("#copyBackup")
        r.hold(2.4)

        # ---- outro
        r.no_caption()
        r.card("""<img src="icons/logo-512.png" alt=""><h1>Good luck!</h1><ul>
            <li>Everything is saved on your iPhone.</li>
            <li>Works offline once loaded.</li>
            <li>Add to Home Screen: <b>Share → Add to Home Screen</b>.</li>
            <li>Always confirm a winning ticket with PCSO.</li></ul>""")
        r.hold(4.5)

        browser.close()
        if errors:
            sys.exit("page errors: " + "; ".join(errors))
    r.encode(OUT)
    httpd.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB, {r.n} frames)")


if __name__ == "__main__":
    main()
