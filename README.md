# Habemus Papam — play online (3–6 players)

The same game and the same look as the one-laptop version, but every player uses their own device.
One player creates a room and shares a 4-letter code; friends join from any browser. Action cards are chosen in secret
on each player's own screen, there is a lobby, optional computer players, and Table Talk with private whispers.

## How it works
* `server.js` — a small Node server with **no dependencies**. It holds the authoritative game (`engine.js`), so nobody can cheat,
  and it never sends other players' hidden action cards to your browser.
* `public/index.html` — the whole game page (art included). It talks to the server with live updates (Server-Sent Events) and small POST requests.
* Rooms live in the server's memory. Idle rooms are removed after 30 minutes with nobody connected (6 hours at most).

## Run it on your computer
```
node server.js          # needs Node 18 or newer
```
Open http://localhost:3000, press **Create room**, then open the page in other tabs or on other devices on the same network
(`http://YOUR-IP:3000`) and **Join** with the code.  `npm test` runs the server self-test.

## Deploy on Render (simplest: everything in one place)
1. Put this folder in a GitHub repository.
2. On Render: **New +  →  Blueprint** and choose the repository (it reads `render.yaml`), or **New +  →  Web Service** with
   *Build command* empty, *Start command* `node server.js`, *Health check path* `/api/health`.
3. Open the URL Render gives you (for example `https://habemus-papam.onrender.com`) and share it.
   Nothing else to configure: the page and the game server are served together.

## Deploy the page on Vercel (with the game server on Render)
Vercel runs short-lived serverless functions. They cannot keep a live game in memory or hold open connections, so **Vercel can
host the web page but not the game server**. The server must run on a host that stays running, such as Render.
1. Deploy to Render first (above) and copy its URL.
2. Edit `public/config.js` and set `window.HP_SERVER = "https://habemus-papam.onrender.com";`
3. On Vercel: **Add New → Project**, import the repository. `vercel.json` already tells Vercel there is no build and that
   the site is the `public` folder.
4. Optional but recommended: in Render set the environment variable `ALLOW_ORIGIN` to your Vercel address
   (for example `https://habemus-papam.vercel.app`) so only your page can use the server.

You can also pass the server in a link instead of editing the file: `https://your-app.vercel.app/?server=https://habemus-papam.onrender.com`.
The in-game **Copy invite link** button includes it automatically.

## Good to know
* **Render's free plan sleeps** after about 15 minutes without traffic; the first visit afterwards takes up to a minute to wake the
  server, and a restart clears all rooms. A paid instance stays awake. Run a **single instance** (rooms are held in memory).
* If a player's connection drops they can reload the page and are put back in their seat automatically.
  If someone leaves for good, the host can press **Computer plays for them** on their mat.
* Environment variables: `PORT` (set by Render), `ALLOW_ORIGIN` (default `*`), `SERVE_STATIC=0` (API only, when the page is on Vercel),
  `MAX_ROOMS` (default 300), `PACE` (delay multiplier, default 1).
* No accounts, no database, no data is stored after a room closes.
* To change the page, edit `src/client_template.html` (or `src/client_css.txt`) and run `python3 build.py`.

## Rules
The game follows the revised rulebook: 6 Conclave rounds with ballots (17 votes each), then a Final Phase where one candidate is eliminated
every round and deals out their votes down a ranking (5-4-3-2-1 style, repeating until none remain). First to 68 votes is elected Pope.
The optional "Reflect gives Influence" rule is a checkbox in the lobby.
