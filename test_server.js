process.env.PACE = '0.02';
const http = require('http');
const { server, rooms } = require('./server.js');
const assert = require('assert');

function req(port, method, path, body) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ port, method, path, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (rs) => {
      let b = ''; rs.on('data', (c) => (b += c)); rs.on('end', () => { try { res({ status: rs.statusCode, body: JSON.parse(b), headers: rs.headers }); } catch (e) { res({ status: rs.statusCode, body: b, headers: rs.headers }); } });
    });
    r.on('error', rej); if (data) r.write(data); r.end();
  });
}
class Client {
  constructor(port, name) { this.port = port; this.name = name; this.state = null; this.logs = []; this.chats = []; this.whispers = []; this.violations = []; this.states = 0; }
  async create() { const r = await req(this.port, 'POST', '/api/create', { name: this.name }); Object.assign(this, r.body); return r; }
  async join(room) { const r = await req(this.port, 'POST', '/api/join', { room, name: this.name }); if (r.status === 200) Object.assign(this, r.body); return r; }
  api(type, body) { return req(this.port, 'POST', '/api/' + type, Object.assign({ room: this.room, token: this.token }, body)); }
  open() {
    return new Promise((resolve) => {
      this.req = http.get({ port: this.port, path: '/api/stream?room=' + this.room + '&token=' + this.token }, (rs) => {
        let buf = ''; this.res = rs;
        rs.on('data', (c) => {
          buf += c.toString();
          let i; while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            const m = /event: (\w+)\ndata: (.*)/s.exec(chunk); if (!m) continue;
            this.on(m[1], JSON.parse(m[2]));
          }
        });
        resolve();
      });
    });
  }
  on(ev, d) {
    if (ev === 'state') {
      this.state = d; this.states++;
      const g = d.game;
      if (g) g.p.forEach((q, i) => { // privacy: nobody may see another player's unrevealed action
        if (i !== d.you && !q.shown && q.act !== null && q.act !== '?') this.violations.push('leaked act of ' + i);
        if (q.act && q.act !== '?' && !q.shown) this.violations.push('revealed too early');
      });
      if (d.prompt) this.act(d.prompt);
    } else if (ev === 'logs') this.logs.push(...d); else if (ev === 'log') this.logs.push(d);
    else if (ev === 'chat' || ev === 'chats') this.chats.push(...[].concat(d));
    else if (ev === 'whisper') this.whispers.push(d);
  }
  act(p) {
    if (this.answered === p.id) return; this.answered = p.id;
    let a;
    if (p.kind === 'continue') a = true;
    else if (p.kind === 'pick') a = p.skip && Math.random() < 0.3 ? null : p.ids[Math.floor(Math.random() * p.ids.length)];
    else if (p.kind === 'order') a = p.ids.slice().sort(() => Math.random() - 0.5);
    else if (p.kind === 'select') a = p.avail[Math.floor(Math.random() * p.avail.length)];
    setTimeout(() => this.api('answer', { promptId: p.id, answer: a }).catch(() => {}), 5 + Math.random() * 20);
  }
  close() { try { this.req.destroy(); } catch (e) {} }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, label) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await wait(25); } throw new Error('timeout: ' + label); }

(async () => {
  await new Promise((r) => server.listen(0, r)); const port = server.address().port;
  // health + CORS
  const h = await req(port, 'GET', '/api/health'); assert(h.body.ok); assert.strictEqual(h.headers['access-control-allow-origin'], '*');
  // lobby rules
  const A = new Client(port, 'Anna'), B = new Client(port, 'Ben'), C = new Client(port, 'Cleo');
  assert.strictEqual((await A.create()).status, 200); assert.strictEqual(A.seat, 0);
  assert.strictEqual((await req(port, 'POST', '/api/join', { room: 'ZZZZ', name: 'x' })).status, 404);
  assert.strictEqual((await B.join(A.room)).status, 200); assert.strictEqual(B.seat, 1);
  assert.strictEqual((await C.join(A.room)).status, 200);
  const dup = new Client(port, 'Ben'); await dup.join(A.room); assert.notStrictEqual(rooms.get(A.room).seats[3].name, 'Ben');
  await dup.api('lobby', { action: 'remove', index: 3 }).catch(() => {});
  await A.api('lobby', { action: 'remove', index: 3 });
  assert.strictEqual(rooms.get(A.room).seats.length, 3);
  assert.strictEqual((await B.api('lobby', { action: 'start' })).status, 403);           // host only
  assert.strictEqual((await req(port, 'POST', '/api/lobby', { room: A.room, token: 'bad', action: 'start' })).status, 404);
  await A.api('lobby', { action: 'options', options: { reflectPlus: true } });
  await A.api('lobby', { action: 'addBot' }); await A.api('lobby', { action: 'addBot' }); await A.api('lobby', { action: 'addBot' });
  assert.strictEqual(rooms.get(A.room).seats.length, 6);
  const sev = new Client(port, 'Seventh'); assert.strictEqual((await sev.join(A.room)).status, 409);   // full
  await A.api('lobby', { action: 'remove', index: 5 }); await A.api('lobby', { action: 'remove', index: 4 });  // 4 players: 3 humans + 1 bot
  assert.strictEqual(rooms.get(A.room).seats.length, 4);
  await Promise.all([A.open(), B.open(), C.open()]);
  await waitFor(() => A.state && B.state && C.state, 2000, 'initial state');
  assert.strictEqual(A.state.status, 'lobby'); assert.strictEqual(A.state.seats.length, 4); assert(A.state.options.reflectPlus);
  // chat + whisper privacy
  await A.api('chat', { to: 'all', text: 'Hello cardinals' }); await B.api('chat', { to: 2, text: 'psst, Cleo' });
  await waitFor(() => C.chats.length >= 2, 2000, 'chat');
  assert(C.chats.some((m) => m.text === 'psst, Cleo')); assert(!A.chats.some((m) => m.text === 'psst, Cleo'), 'whisper leaked');
  assert(A.whispers.some((w) => w.from === 1 && w.to === 2));
  // start and play a full game with 3 humans + 1 bot
  assert.strictEqual((await A.api('lobby', { action: 'start' })).status, 200);
  const t0 = Date.now();
  await waitFor(() => A.state.status === 'over', 90000, 'game to finish (round ' + (A.state.game && A.state.game.round) + ', stage ' + (A.state.game && A.state.game.stage) + ', prompt ' + JSON.stringify(A.state.prompt && A.state.prompt.kind) + ')');
  const g = A.state.game;
  console.log('game finished in', ((Date.now() - t0) / 1000).toFixed(1) + 's; round', g.round, 'winner seat', g.winner, 'votes', g.p.map((q) => q.votes).join('/'));
  assert(g.p[g.winner].votes >= 68);
  assert.strictEqual(g.pool + g.p.reduce((a, q) => a + q.votes, 0), 102);
  [A, B, C].forEach((c) => assert.deepStrictEqual(c.violations, [], c.name + ' saw hidden info: ' + c.violations.slice(0, 3)));
  assert(A.logs.length > 20);
  // invalid / stale answers are rejected
  const stale = await A.api('answer', { promptId: 99999, answer: 1 }); assert.strictEqual(stale.body.ok, false);
  // play again returns to the lobby with the same seats
  await B.api('lobby', { action: 'playAgain' }); await waitFor(() => A.state.status === 'lobby', 2000, 'lobby again');
  assert.strictEqual(A.state.seats.length, 4); assert.strictEqual(A.state.game, null);
  // reconnect with the same token resumes
  A.close(); await wait(100); const A2 = Object.assign(new Client(port, 'Anna'), { room: A.room, token: A.token }); await A2.open(); await waitFor(() => A2.state, 2000, 'resume');
  assert.strictEqual(A2.state.you, 0);
  console.log('SERVER TESTS PASSED  (states received per client:', A.states, B.states, C.states + ')');
  [B, C, A2].forEach((c) => c.close()); server.close(); process.exit(0);
})().catch((e) => { console.error('FAIL', e.stack || e); process.exit(1); });
