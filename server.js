/* Habemus Papam - online multiplayer server (zero dependencies, Node 18+).
 * One authoritative game engine per room. Clients receive live updates over Server-Sent Events
 * and send decisions with small JSON POST requests. Runs as-is on Render (or any Node host).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const HP = require('./engine.js');

const PORT = Number(process.env.PORT) || 3000;
const SERVE_STATIC = process.env.SERVE_STATIC !== '0';          // set SERVE_STATIC=0 to run API only (front end on Vercel)
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';           // e.g. https://your-app.vercel.app
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 300;
const PACE = process.env.PACE === undefined ? 1 : Number(process.env.PACE);   // delay multiplier (tests use a small value)
const rooms = new Map();

// ------------------------------------------------------------------ helpers
const now = () => Date.now();
const rid = (n) => crypto.randomBytes(n).toString('hex');
const sleep = (room, ms) => new Promise((res) => { const t = setTimeout(res, ms * PACE); room.timers.add(t); });
const cleanName = (s, fallback) => {
  s = String(s == null ? '' : s).replace(/[<>&"'`\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
  return s || fallback;
};
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let k = 0; k < 200; k++) {
    let c = ''; for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ------------------------------------------------------------------ rooms
function createRoom(hostName) {
  const code = newCode(); if (!code) return null;
  const room = {
    code, created: now(), last: now(), status: 'lobby', options: { reflectPlus: false },
    seats: [], game: null, prompts: new Map(), log: [], chat: [], ticker: '', timers: new Set(), dead: false, push: null, nextPrompt: 1, winnerSeat: null,
  };
  const seat = addSeat(room, hostName, false);
  rooms.set(code, room);
  return { room, seat };
}
function addSeat(room, name, bot) {
  const idx = room.seats.length;
  const fallback = bot ? 'Cardinal ' + (idx + 1) : HP.COLORS[idx].name;
  const used = room.seats.map((s) => s.name);
  let nm = cleanName(name, fallback), base = nm, k = 2;
  while (used.includes(nm)) nm = base.slice(0, 11) + ' ' + k++;
  const s = { name: nm, token: rid(16), bot: !!bot, res: new Set(), connected: !!bot };
  room.seats.push(s);
  return s;
}
const seatOf = (room, token) => room.seats.findIndex((s) => s.token === token);

// ------------------------------------------------------------------ state sent to clients
function snapshot(room) {
  const g = room.game; if (!g) return null;
  return {
    n: g.n, round: g.round, phase: g.phase, stage: g.stage, dean: g.dean, pool: g.pool, supply: g.supply,
    deckCount: g.deck.length, usedCount: g.used.length, usedTop: g.used.length ? g.used[g.used.length - 1] : null,
    cardShown: g.cardShown, current: g.current, order: g.order(), reflectPlus: g.reflectPlus, winner: g.winner,
    roundName: g.roundName(),
    p: g.p.map((q, i) => ({
      id: i, name: q.name, votes: q.votes, pv: q.pv, infl: q.infl, pi: q.pi, out: q.out, last: q.last, shown: q.shown,
      act: q.shown ? q.act : (q.act ? '?' : null),
      connected: room.seats[i].connected, bot: room.seats[i].bot,
    })),
  };
}
function promptView(room, seat) {
  const mine = [], waiting = [];
  for (const pr of room.prompts.values()) {
    const forMe = pr.to === 'all' || pr.to.includes(seat);
    if (forMe) mine.push(pr);
    else waiting.push({ seat: pr.to[0], kind: pr.kind, title: pr.kind === 'select' ? null : pr.title, who: pr.who });
  }
  const pr = mine[0] || null;
  return { prompt: pr ? Object.assign({ id: pr.id }, pr.data) : null, waiting };
}
function stateFor(room, seat) {
  const pv = promptView(room, seat);
  return {
    room: room.code, you: seat, status: room.status, options: room.options, ticker: room.ticker,
    seats: room.seats.map((s, i) => ({ name: s.name, bot: s.bot, connected: s.connected, host: i === 0 })),
    game: snapshot(room), prompt: pv.prompt, waiting: pv.waiting,
  };
}
function send(res, event, data) { try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch (e) { /* closed */ } }
function pushState(room) {
  room.push = null;
  room.seats.forEach((s, i) => { if (s.res.size) { const st = stateFor(room, i); s.res.forEach((r) => send(r, 'state', st)); } });
}
function schedule(room) { if (!room.push) room.push = setTimeout(() => pushState(room), 25); }
function broadcast(room, event, data) { room.seats.forEach((s) => s.res.forEach((r) => send(r, event, data))); }

// ------------------------------------------------------------------ prompts (engine -> players)
function validAnswer(pr, ans) {
  const d = pr.data;
  if (pr.kind === 'continue') return true;
  if (pr.kind === 'pick') return ans === null ? !!d.skip : d.ids.includes(ans);
  if (pr.kind === 'order') return Array.isArray(ans) && ans.length === d.ids.length && d.ids.every((x) => ans.includes(x)) && new Set(ans).size === ans.length;
  if (pr.kind === 'select') return d.avail.includes(ans);
  return false;
}
function botAnswer(pr) {
  const d = pr.data;
  if (pr.kind === 'pick') return d.skip && Math.random() < 0.3 ? null : d.ids[Math.floor(Math.random() * d.ids.length)];
  if (pr.kind === 'order') return shuffle(d.ids);
  if (pr.kind === 'select') return d.avail[Math.floor(Math.random() * d.avail.length)];
  return undefined;
}
function ask(room, kind, to, data) {
  if (room.dead) throw new Error('room closed');
  return new Promise((resolve) => {
    const id = room.nextPrompt++;
    const pr = { id, kind, to, who: data.who, title: data.title, data: Object.assign({ kind }, data), resolve };
    room.prompts.set(id, pr);
    schedule(room);
    if (to !== 'all') {
      to.forEach((seat) => {
        if (room.seats[seat] && room.seats[seat].bot) {
          const t = setTimeout(() => answerPrompt(room, id, seat, botAnswer(pr)), (700 + Math.random() * 900) * PACE);
          room.timers.add(t);
        }
      });
    }
  });
}
function answerPrompt(room, id, seat, ans) {
  const pr = room.prompts.get(id); if (!pr) return false;
  if (pr.to !== 'all' && !pr.to.includes(seat)) return false;
  if (!validAnswer(pr, ans)) return false;
  room.prompts.delete(id); room.last = now();
  pr.resolve(ans); schedule(room);
  return true;
}

function makeUI(room) {
  return {
    render() { schedule(room); },
    async note(msg, wait) {
      room.ticker = msg;
      const e = { round: room.game.round, msg };
      room.log.push(e); if (room.log.length > 500) room.log.shift();
      broadcast(room, 'log', e); schedule(room);
      if (wait) await ask(room, 'continue', 'all', { label: 'Continue', ctx: 'note' });
      else await sleep(room, Math.min(2400, 600 + msg.length * 12));
    },
    roundStart() { return ask(room, 'continue', 'all', { label: 'Begin: select actions', ctx: 'roundStart' }); },
    selectAction(g, i, avail) { return ask(room, 'select', [i], { who: i, avail, phase: g.phase, last: g.p[i].last, dean: g.dean === i }); },
    reveal() { return ask(room, 'continue', 'all', { label: 'Reveal the cards', ctx: 'reveal' }); },
    afterReveal() { return sleep(room, 1300); },
    async cardReveal(card, g, nested) { await sleep(room, 200); await ask(room, 'continue', 'all', { label: 'Resolve the card', ctx: 'card', card: { name: card.name, type: card.type, text: card.text }, nested: !!nested, dean: g.dean }); },
    pick({ who, title, ids, unit, skip }) { return ask(room, 'pick', [who], { who, title, ids, unit, skip: skip || null }); },
    order({ who, title, ids, kind, value }) { return ask(room, 'order', [who], { who, title, ids, orderKind: kind, value }); },
    async gameOver(g) { room.status = 'over'; room.winnerSeat = g.winner; schedule(room); },
  };
}

function startGame(room) {
  const n = room.seats.length;
  room.log = []; room.ticker = ''; room.prompts.clear();
  room.game = new HP.Game({ n, names: room.seats.map((s) => s.name), reflectPlus: room.options.reflectPlus, parallelSelect: true }, makeUI(room));
  room.status = 'playing'; room.winnerSeat = null;
  room.game.run().catch((e) => { if (!room.dead) { console.error('game error in room', room.code, e); room.ticker = 'The game hit an unexpected error.'; room.status = 'error'; schedule(room); } });
  schedule(room);
}
function killRoom(room) {
  room.dead = true; rooms.delete(room.code);
  room.timers.forEach(clearTimeout);
  room.seats.forEach((s) => s.res.forEach((r) => { try { r.end(); } catch (e) { /* */ } }));
}

// ------------------------------------------------------------------ HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}
function json(res, code, obj) { cors(res); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 8192) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const createHits = new Map();
function limited(ip) {
  const t = now(), arr = (createHits.get(ip) || []).filter((x) => t - x < 60000); arr.push(t); createHits.set(ip, arr); return arr.length > 12;
}

async function api(req, res, url) {
  const route = url.pathname.slice(5);
  if (req.method === 'GET' && route === 'health') return json(res, 200, { ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) });
  if (req.method === 'GET' && route === 'ping') {
    const room = rooms.get(String(url.searchParams.get('room') || '').toUpperCase());
    return room && seatOf(room, url.searchParams.get('token')) >= 0 ? json(res, 200, { ok: true }) : json(res, 404, { ok: false });
  }
  if (req.method === 'GET' && route === 'stream') {
    const room = rooms.get(String(url.searchParams.get('room') || '').toUpperCase());
    const token = url.searchParams.get('token');
    const seat = room ? seatOf(room, token) : -1;
    if (!room || seat < 0) return json(res, 404, { error: 'Room not found or you are no longer seated.' });
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    const s = room.seats[seat]; s.res.add(res); s.connected = true; room.last = now();
    send(res, 'state', stateFor(room, seat));
    send(res, 'logs', room.log.slice(-80)); send(res, 'chats', room.chat.slice(-60).filter((m) => m.to === 'all' || m.to === seat || m.from === seat));
    schedule(room);
    const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* */ } }, 15000);
    req.on('close', () => { clearInterval(hb); s.res.delete(res); s.connected = s.bot || s.res.size > 0; schedule(room); });
    return;
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  let body; try { body = await readBody(req); } catch (e) { return json(res, 400, { error: 'Bad request' }); }
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?';

  if (route === 'create') {
    if (rooms.size >= MAX_ROOMS) return json(res, 503, { error: 'The server is full. Try again later.' });
    if (limited(String(ip))) return json(res, 429, { error: 'Too many rooms created. Wait a minute.' });
    const r = createRoom(body.name); if (!r) return json(res, 503, { error: 'Could not create a room.' });
    return json(res, 200, { room: r.room.code, token: r.seat.token, seat: 0 });
  }
  if (route === 'join') {
    const room = rooms.get(String(body.room || '').toUpperCase());
    if (!room) return json(res, 404, { error: 'No room with that code.' });
    if (room.status !== 'lobby') return json(res, 409, { error: 'That game has already started.' });
    if (room.seats.length >= 6) return json(res, 409, { error: 'The room is full (6 players).' });
    const s = addSeat(room, body.name, false); room.last = now(); schedule(room);
    return json(res, 200, { room: room.code, token: s.token, seat: room.seats.length - 1 });
  }
  const room = rooms.get(String(body.room || '').toUpperCase());
  const seat = room ? seatOf(room, body.token) : -1;
  if (!room || seat < 0) return json(res, 404, { error: 'Room not found or you are no longer seated.' });
  room.last = now();

  if (route === 'answer') {
    const ok = answerPrompt(room, Number(body.promptId), seat, body.answer === undefined ? null : body.answer);
    return json(res, 200, { ok });          // a stale or duplicate answer is harmless (e.g. two players press Continue together)
  }
  if (route === 'chat') {
    const text = String(body.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 240); if (!text) return json(res, 400, { error: 'Empty message' });
    const to = body.to === 'all' ? 'all' : Number(body.to);
    if (to !== 'all' && !(room.seats[to] && to !== seat)) return json(res, 400, { error: 'Bad recipient' });
    const m = { from: seat, to, text, t: now() };
    room.chat.push(m); if (room.chat.length > 200) room.chat.shift();
    room.seats.forEach((s, i) => {
      if (to === 'all' || i === to || i === seat) s.res.forEach((r) => send(r, 'chat', m));
      else s.res.forEach((r) => send(r, 'whisper', { from: seat, to, t: m.t }));   // others only learn that a whisper happened
    });
    return json(res, 200, { ok: true });
  }
  if (route === 'lobby') {
    const a = body.action;
    if (a === 'playAgain') {
      if (room.status === 'over' || room.status === 'error') { room.status = 'lobby'; room.game = null; room.prompts.clear(); room.log = []; room.ticker = ''; schedule(room); }
      return json(res, 200, { ok: true });
    }
    if (seat !== 0) return json(res, 403, { error: 'Only the host can do that.' });
    if (room.status !== 'lobby') return json(res, 409, { error: 'The game has started.' });
    if (a === 'options') { room.options.reflectPlus = !!(body.options && body.options.reflectPlus); }
    else if (a === 'addBot') { if (room.seats.length < 6) addSeat(room, '', true); }
    else if (a === 'remove') {
      const k = Number(body.index);
      if (k > 0 && k < room.seats.length) { const s = room.seats[k]; s.res.forEach((r) => { send(r, 'kicked', {}); try { r.end(); } catch (e) { /* */ } }); room.seats.splice(k, 1); }
    } else if (a === 'start') {
      if (room.seats.length < 3) return json(res, 409, { error: 'You need at least 3 players (add computer players if you like).' });
      startGame(room);
    }
    schedule(room);
    return json(res, 200, { ok: true });
  }
  if (route === 'botTakeover') {      // host: let a computer play a disconnected player's seat
    if (seat !== 0) return json(res, 403, { error: 'Only the host can do that.' });
    const k = Number(body.index);
    if (room.seats[k] && !room.seats[k].connected && !room.seats[k].bot) {
      room.seats[k].bot = true; room.seats[k].connected = true;
      for (const pr of room.prompts.values()) if (pr.to !== 'all' && pr.to.includes(k)) { const id = pr.id; const t = setTimeout(() => answerPrompt(room, id, k, botAnswer(pr)), 900); room.timers.add(t); }
      schedule(room);
    }
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'Unknown route' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname === '/health') return json(res, 200, { ok: true });
    if (!SERVE_STATIC) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Habemus Papam API server. The web page is hosted elsewhere.'); }
    let p = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const file = path.normalize(path.join(PUBLIC_DIR, p));
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' });
      res.end(data);
    });
  } catch (e) {
    console.error(e); try { json(res, 500, { error: 'Server error' }); } catch (e2) { /* */ }
  }
});
server.keepAliveTimeout = 65000;

// idle rooms are removed so memory never grows
setInterval(() => {
  const t = now();
  for (const room of rooms.values()) {
    const humansOnline = room.seats.some((s) => !s.bot && s.res.size > 0);
    if ((!humansOnline && t - room.last > 30 * 60000) || t - room.last > 6 * 3600000) killRoom(room);
  }
}, 60000).unref();

if (require.main === module) server.listen(PORT, () => console.log('Habemus Papam server listening on :' + PORT + (SERVE_STATIC ? ' (serving the web page too)' : ' (API only)')));
module.exports = { server, rooms };
