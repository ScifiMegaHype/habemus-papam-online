/* Habemus Papam - rules engine (revised rulebook). Pure logic; all player decisions go through the `ui` object. */
(function (root) {
  'use strict';

  const COLORS = [
    { id: 0, name: 'Red', hex: '#B3202F', dark: '#7A1520', light: '#D8454F', shape: 'circle' },
    { id: 1, name: 'Green', hex: '#2E7D4F', dark: '#1F5636', light: '#52A577', shape: 'square' },
    { id: 2, name: 'Blue', hex: '#2F5D9E', dark: '#1F4170', light: '#5588C8', shape: 'triangle' },
    { id: 3, name: 'Orange', hex: '#D9822B', dark: '#A85F1A', light: '#F0A55C', shape: 'diamond' },
    { id: 4, name: 'Purple', hex: '#7D4FA8', dark: '#573578', light: '#A582CC', shape: 'star' },
    { id: 5, name: 'Teal', hex: '#1E8A8A', dark: '#146060', light: '#4BB5B5', shape: 'hexagon' },
  ];
  const BALLOT = { 3: [7, 6, 4], 4: [6, 5, 4, 2], 5: [6, 4, 3, 2, 2], 6: [5, 4, 3, 2, 2, 1] };

  // 30 designs, two copies each (text uses {s} = Influence in the Conclave, votes in the Final Phase)
  const CARDS = [
    ['Humility', 'anti', 'Move 2 {s} from the leader to last place.'],
    ['Discernment', 'anti', 'Move 1 {s} from the leader to second place.'],
    ['Unity', 'anti', 'Move 1 {s} from the leader to each candidate behind them.'],
    ['Unexpected Consensus', 'anti', 'Move 3 {s} from the leader to second place.'],
    ['Charity', 'anti', 'Move 1 {s} from the leader and 1 from second place to last place.'],
    ['Contrition', 'anti', 'Move 2 {s} from the leader to second place.'],
    ['Sacrifice', 'anti', 'Move 3 {s} from the leader to last place.'],
    ['Mercy', 'anti', 'Move 2 {s} from the leader to any other candidate chosen by the Dean.'],
    ['Generosity', 'anti', 'The leader chooses another candidate and moves 2 {s} to them.'],
    ['Renunciation', 'anti', 'The leader gives 2 {s} to the next remaining candidate clockwise.'],
    ['Penance', 'anti', 'Move 2 {s} from the leader to second place and 1 from the leader to last place.'],
    ['Succession', 'anti', 'Every candidate except last place moves 1 {s} to the candidate ranked directly behind them, all at once.'],
    ['Tradition', 'pro', 'Move 2 {s} from last place to the leader.'],
    ['Perseverance', 'pro', 'Move 1 {s} from second place to the leader.'],
    ['Authority', 'pro', 'Move 1 {s} from every other candidate to the leader.'],
    ['Majesty', 'pro', 'Move 2 {s} from second place to the leader.'],
    ['Coronation', 'pro', 'Move 3 {s} from last place to the leader.'],
    ['Conviction', 'pro', 'The leader takes 2 {s} from one other candidate of the leader\u2019s choice.'],
    ['Reverence', 'pro', 'The leader takes 1 {s} from each of two other candidates of the leader\u2019s choice.'],
    ['Zeal', 'pro', 'The next remaining candidate clockwise from the leader gives 2 {s} to the leader.'],
    ['Ascent', 'pro', 'Every candidate except the leader moves 1 {s} to the candidate ranked directly ahead of them, all at once.'],
    ['Wisdom', 'wild', 'In Dean order, each remaining candidate may move 1 {s} from one candidate to another.'],
    ['Fellowship', 'wild', 'Each remaining candidate passes 1 {s} to the next remaining candidate clockwise, all at once.'],
    ['Brotherhood', 'wild', 'Each remaining candidate passes 1 {s} to the next remaining candidate counter-clockwise, all at once.'],
    ['Silence', 'wild', 'No effect.'],
    ['Arbitration', 'wild', 'The Dean moves 2 {s} from one candidate to another candidate of the Dean\u2019s choice.'],
    ['Gratitude', 'wild', 'In Dean order, each remaining candidate gives 1 of their own {s} to another candidate of their choice.'],
    ['Hospitality', 'wild', 'The next remaining candidate clockwise from the Dean moves 2 {s} from one candidate to another of their choice.'],
    ['Restraint', 'wild', 'Each candidate who played Converse this round passes 1 {s} to the next remaining candidate clockwise.'],
    ['Pentecost', 'wild', 'Immediately draw and resolve another Holy Spirit card.'],
  ].map((c, i) => ({ name: c[0], type: c[1], text: c[2], design: i + 1 }));

  const ACTIONS = {
    converse: { name: 'Converse', tagC: 'BUILD', tagF: 'TAKE',
      textC: 'Gain 3 Influence: place 2 on yourself and 1 on another candidate.',
      textF: 'Take up to 2 unprotected votes from a single candidate of your choice.' },
    reflect: { name: 'Reflect', tagC: 'PROTECT', tagF: 'CLOISTER',
      textC: 'Name yourself and one rival. The first Influence disc each of you receives this round goes straight into the protected zone.',
      textF: 'Protect all the votes you hold and all the votes held by one other candidate of your choice.' },
    call: { name: 'Call for Discussion', tagC: 'REDIRECT', tagF: '',
      textC: 'Move 1 unprotected Influence disc from one candidate to another. If no other candidate has unprotected Influence, place 1 Influence from the supply on yourself.',
      textF: null },
    seek: { name: 'Seek Consensus', tagC: '', tagF: 'COMPROMISE', textC: null,
      textF: 'Take up to 2 unprotected votes from each candidate who has strictly more votes than you.' },
  };

  class GameOver extends Error {}

  class Game {
    constructor(opts, ui) {
      this.ui = ui;
      this.n = opts.n;
      this.rng = opts.rng || Math.random;
      this.reflectPlus = !!opts.reflectPlus;
      this.parallel = !!opts.parallelSelect;   // online play: everyone chooses their secret action at the same time
      this.p = [];
      for (let i = 0; i < this.n; i++) {
        this.p.push({ id: i, name: (opts.names && opts.names[i]) || COLORS[i].name, c: COLORS[i],
          votes: 0, pv: 0, infl: 0, pi: 0, out: false, last: null, act: null, shown: false });
      }
      this.pool = 102; this.supply = 18;
      this.dean = Math.floor(this.rng() * this.n); this.firstDean = this.dean;
      this.round = 0; this.phase = 'C';
      this.deck = this.shuffle(CARDS.concat(CARDS));
      this.used = []; this.cardShown = null;
      this.pending = new Set(); this.hold = 0;
      this.winner = null; this.elimOrder = []; this.log = [];
      this.stage = 'setup'; this.current = null;
    }

    // ---------------------------------------------------------------- helpers
    shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
    rem() { return this.p.filter((q) => !q.out).map((q) => q.id); }
    order() { const r = this.rem(), out = []; for (let k = 0; k < this.n; k++) { const i = (this.dean + k) % this.n; if (r.includes(i)) out.push(i); } return out; }
    nextCW(i) { const r = this.rem(); for (let k = 1; k <= this.n; k++) { const j = (i + k) % this.n; if (r.includes(j)) return j; } return i; }
    nextCCW(i) { const r = this.rem(); for (let k = 1; k <= this.n; k++) { const j = ((i - k) % this.n + this.n) % this.n; if (r.includes(j)) return j; } return i; }
    name(i) { return this.p[i].name; }
    unit() { return this.phase === 'C' ? 'Influence' : 'votes'; }
    val(i) { return this.phase === 'C' ? this.p[i].infl : this.p[i].votes; }
    unprot(i) { const q = this.p[i]; return this.phase === 'C' ? q.infl - q.pi : q.votes - q.pv; }
    roundName() { return this.round === 1 ? 'Extra Omnes' : this.round === 6 ? 'The Final Round' : this.round >= 7 ? 'Final Phase' : 'Conclave'; }
    actionsFor() { return this.phase === 'C' ? ['converse', 'reflect', 'call'] : ['converse', 'reflect', 'seek']; }
    async note(msg, wait) { this.log.push({ round: this.round, msg }); if (this.ui.note) await this.ui.note(msg, !!wait, this); }
    refresh() { if (this.ui.render) this.ui.render(this); }

    // ---------------------------------------------------------------- mutators
    addInfl(i, n, fromSupply) {
      const q = this.p[i];
      for (let k = 0; k < n; k++) {
        q.infl++; if (fromSupply) this.supply--;
        if (this.pending.has(i)) { q.pi++; this.pending.delete(i); }
      }
    }
    moveInfl(a, b, n) {
      if (a === b) return 0;
      const m = Math.min(n, this.unprot(a)); if (m <= 0) return 0;
      this.p[a].infl -= m; this.addInfl(b, m, false); return m;
    }
    moveVotes(a, b, n) {
      if (a === b) return 0;
      const m = Math.min(n, this.unprot(a)); if (m <= 0) return 0;
      this.p[a].votes -= m; this.p[b].votes += m; this.checkWin(); return m;
    }
    mv(a, b, n) { return this.phase === 'C' ? this.moveInfl(a, b, n) : this.moveVotes(a, b, n); }
    checkWin() {
      if (this.hold > 0) return;
      for (const i of this.rem()) if (this.p[i].votes >= 68) { this.winner = i; throw new GameOver(); }
    }
    async batch(fn) { this.hold++; try { await fn(); } finally { this.hold--; } this.checkWin(); }
    simulPass(pairs) {
      const gives = pairs.filter(([a, b]) => a !== b && this.unprot(a) >= 1);
      this.hold++;
      try {
        for (const [a] of gives) { if (this.phase === 'C') this.p[a].infl -= 1; else this.p[a].votes -= 1; }
        for (const [, b] of gives) { if (this.phase === 'C') this.addInfl(b, 1, false); else this.p[b].votes += 1; }
      } finally { this.hold--; }
      this.checkWin();
      return gives;
    }

    // ---------------------------------------------------------------- UI-backed decisions
    async pickCand(who, title, ids, extra) {
      if (ids.length === 1 && !(extra && extra.always)) return ids[0];
      const r = await this.ui.pick({ who, title, ids, unit: this.unit(), skip: extra && extra.skip, game: this });
      return r;
    }
    async orderCands(who, title, ids, kind, value) {
      if (ids.length <= 1) return ids.slice();
      let r = await this.ui.order({ who, title, ids, kind, value, game: this });
      if (!Array.isArray(r) || r.length !== ids.length || ids.some((x) => !r.includes(x))) r = ids.slice();
      return r;
    }
    async ranking() {
      const ids = this.rem(), vals = {};
      ids.forEach((i) => { vals[i] = this.val(i); });
      const groups = {};
      ids.forEach((i) => { (groups[vals[i]] = groups[vals[i]] || []).push(i); });
      const keys = Object.keys(groups).map(Number).sort((a, b) => b - a);
      const out = [];
      for (const k of keys) {
        const g = groups[k];
        if (g.length > 1) {
          const ord = await this.orderCands(this.dean, 'Tie at ' + k + ' ' + this.unit() + ' \u2014 the Dean rules the order (highest first)', g, 'tie', k);
          out.push(...ord);
        } else out.push(g[0]);
      }
      return out;
    }

    // ---------------------------------------------------------------- actions
    async doAction(i) {
      const q = this.p[i], act = q.act, nm = q.name, others = this.rem().filter((x) => x !== i);
      this.current = { who: i, act };
      this.refresh();
      if (this.phase === 'C') {
        if (act === 'reflect') {
          const r = await this.pickCand(i, nm + ' Reflects \u2014 name a rival (their first Influence disc this round will be protected, and so will yours)', others);
          this.pending.add(i); this.pending.add(r);
          let extra = '';
          if (this.reflectPlus) { this.addInfl(i, 1, true); extra = ' ' + nm + ' also places 1 Influence on themselves (protected).'; }
          await this.note(nm + ' Reflects, naming ' + this.name(r) + '. The first Influence disc each receives this round will be protected.' + extra);
        } else if (act === 'converse') {
          const t = await this.pickCand(i, nm + ' Converses \u2014 place 1 Influence disc on which other candidate? (2 go on yourself)', others);
          this.addInfl(i, 2, true); this.addInfl(t, 1, true);
          await this.note(nm + ' Converses: 2 Influence on themselves and 1 on ' + this.name(t) + '.');
        } else if (act === 'call') {
          const othersHave = others.some((x) => this.unprot(x) > 0);
          if (!othersHave) {
            this.addInfl(i, 1, true);
            await this.note(nm + ' calls for Discussion: no other candidate has unprotected Influence, so ' + nm + ' places 1 Influence from the supply on themselves.');
          } else {
            const srcs = this.rem().filter((x) => this.unprot(x) > 0);
            const s = await this.pickCand(i, nm + ' calls for Discussion \u2014 take 1 unprotected Influence disc FROM which candidate?', srcs, { always: true });
            const d = await this.pickCand(i, 'Move it TO which candidate?', this.rem().filter((x) => x !== s), { always: true });
            this.moveInfl(s, d, 1);
            await this.note(nm + ' calls for Discussion: 1 Influence moves from ' + this.name(s) + ' to ' + this.name(d) + '.');
          }
        }
      } else {
        if (act === 'reflect') {
          const r = await this.pickCand(i, nm + ' Reflects \u2014 which other candidate\u2019s votes will also be protected?', others);
          this.p[i].pv = this.p[i].votes; this.p[r].pv = this.p[r].votes;
          await this.note(nm + ' Reflects: all ' + this.p[i].votes + ' of their votes and all ' + this.p[r].votes + ' of ' + this.name(r) + '\u2019s votes are protected this round.');
        } else if (act === 'converse') {
          const targets = others.filter((x) => this.unprot(x) > 0);
          if (!targets.length) { await this.note(nm + ' Converses, but there are no unprotected votes to take. No effect.'); }
          else {
            const t = await this.pickCand(i, nm + ' Converses \u2014 take up to 2 unprotected votes from which candidate?', targets);
            const m = this.moveVotes(t, i, 2);
            await this.note(nm + ' Converses: takes ' + m + ' vote' + (m === 1 ? '' : 's') + ' from ' + this.name(t) + '.');
          }
        } else if (act === 'seek') {
          const ahead = others.filter((x) => this.p[x].votes > this.p[i].votes);
          if (!ahead.length) { await this.note(nm + ' Seeks Consensus, but nobody has more votes. No effect.'); }
          else {
            const parts = [];
            await this.batch(async () => { for (const x of ahead) { const m = this.moveVotes(x, i, 2); parts.push(m + ' from ' + this.name(x)); } });
            await this.note(nm + ' Seeks Consensus: takes ' + parts.join(', ') + '.');
          }
        }
      }
      this.current = null; this.refresh();
    }

    // ---------------------------------------------------------------- Holy Spirit
    drawCard() { if (!this.deck.length) { this.deck = this.shuffle(this.used); this.used = []; } return this.deck.pop(); }
    async holySpirit() {
      this.stage = 'spirit';
      const card = this.drawCard();
      await this.revealAndResolve(card, false);
    }
    async revealAndResolve(card, nested) {
      this.cardShown = card; this.refresh();
      if (this.ui.cardReveal) await this.ui.cardReveal(card, this, nested);
      await this.resolveCard(card);
      this.used.push(card);
    }
    async resolveCard(card) {
      const S = this.unit(), n = this.rem().length;
      if (card.name === 'Pentecost') { await this.note('Spirit of Pentecost: another card is drawn at once.'); await this.revealAndResolve(this.drawCard(), true); return; }
      if (card.name === 'Silence') { await this.note('Spirit of Silence: nothing happens.'); return; }
      const rk = await this.ranking();
      const L = rk[0], Sd = rk.length > 1 ? rk[1] : rk[0], La = rk[rk.length - 1];
      const nm = (i) => this.name(i);
      const moves = [];
      const un = (m) => (S === 'votes' ? (m === 1 ? 'vote' : 'votes') : 'Influence');
      const mv = (a, b, k) => { const m = this.mv(a, b, k); moves.push(nm(a) + ' \u2192 ' + nm(b) + ': ' + m + ' ' + un(m)); return m; };
      const done = async (extra) => { await this.note((moves.length ? moves.join('   \u00B7   ') + '.' : 'Nothing could be moved \u2014 no effect.') + (extra ? ' ' + extra : '')); };
      const dealUnits = async (src, units, label) => {
        // give one unit at a time; when there is not enough, the Dean chooses who receives
        let avail = this.unprot(src);
        const want = units.slice();
        if (avail >= want.length) { want.forEach((r) => mv(src, r, 1)); return; }
        let left = want.slice();
        while (avail > 0 && left.length) {
          const distinct = Array.from(new Set(left));
          const r = distinct.length === 1 ? distinct[0] : await this.pickCand(this.dean, 'Not enough ' + S + ' to go round \u2014 the Dean chooses who receives the next one', distinct, { always: true });
          mv(src, r, 1); left.splice(left.indexOf(r), 1); avail--;
        }
      };
      const nmL = nm(L);
      await this.note('Leader: ' + nmL + '   \u00B7   Second: ' + nm(Sd) + '   \u00B7   Last: ' + nm(La) + '   (ranked by ' + S + ')');
      switch (card.name) {
        case 'Humility': mv(L, La, 2); break;
        case 'Discernment': mv(L, Sd, 1); break;
        case 'Unity': await dealUnits(L, rk.slice(1)); break;
        case 'Unexpected Consensus': mv(L, Sd, 3); break;
        case 'Charity': mv(L, La, 1); mv(Sd, La, 1); break;
        case 'Contrition': mv(L, Sd, 2); break;
        case 'Sacrifice': mv(L, La, 3); break;
        case 'Mercy': { const t = await this.pickCand(this.dean, 'Spirit of Mercy \u2014 the Dean chooses which other candidate receives 2 ' + S + ' from ' + nmL, this.rem().filter((x) => x !== L), { always: true }); mv(L, t, 2); break; }
        case 'Generosity': { const t = await this.pickCand(L, 'Spirit of Generosity \u2014 ' + nmL + ' chooses who receives 2 ' + S, this.rem().filter((x) => x !== L), { always: true }); mv(L, t, 2); break; }
        case 'Renunciation': mv(L, this.nextCW(L), 2); break;
        case 'Penance': await dealUnits(L, [Sd, Sd, La]); break;
        case 'Succession': { const pairs = []; for (let k = 0; k < rk.length - 1; k++) pairs.push([rk[k], rk[k + 1]]); const g = this.simulPass(pairs); g.forEach(([a, b]) => moves.push(nm(a) + ' \u2192 ' + nm(b) + ': 1 ' + un(1))); break; }
        case 'Tradition': mv(La, L, 2); break;
        case 'Perseverance': mv(Sd, L, 1); break;
        case 'Authority': await this.batch(async () => { rk.slice(1).forEach((a) => mv(a, L, 1)); }); break;
        case 'Majesty': mv(Sd, L, 2); break;
        case 'Coronation': mv(La, L, 3); break;
        case 'Conviction': { const t = await this.pickCand(L, 'Spirit of Conviction \u2014 ' + nmL + ' takes 2 ' + S + ' from which other candidate?', this.rem().filter((x) => x !== L), { always: true }); mv(t, L, 2); break; }
        case 'Reverence': {
          let pool = this.rem().filter((x) => x !== L); const picks = [];
          for (let k = 0; k < 2 && pool.length; k++) { const t = await this.pickCand(L, 'Spirit of Reverence \u2014 ' + nmL + ' takes 1 ' + S + ' from a candidate (' + (k + 1) + ' of ' + Math.min(2, this.rem().length - 1) + ')', pool, { always: true }); picks.push(t); pool = pool.filter((x) => x !== t); }
          await this.batch(async () => { picks.forEach((t) => mv(t, L, 1)); }); break;
        }
        case 'Zeal': mv(this.nextCW(L), L, 2); break;
        case 'Ascent': { const pairs = []; for (let k = 1; k < rk.length; k++) pairs.push([rk[k], rk[k - 1]]); const g = this.simulPass(pairs); g.forEach(([a, b]) => moves.push(nm(a) + ' \u2192 ' + nm(b) + ': 1 ' + un(1))); break; }
        case 'Wisdom': {
          for (const i of this.order()) {
            const srcs = this.rem().filter((x) => this.unprot(x) > 0);
            if (!srcs.length) break;
            const s = await this.pickCand(i, nm(i) + ' (Spirit of Wisdom) \u2014 you may move 1 ' + S + '. Take it FROM which candidate?', srcs, { always: true, skip: 'Do not move anything' });
            if (s == null) { moves.push(nm(i) + ' passes'); continue; }
            const d = await this.pickCand(i, 'Move it TO which candidate?', this.rem().filter((x) => x !== s), { always: true });
            mv(s, d, 1);
          }
          break;
        }
        case 'Fellowship': { const g = this.simulPass(this.rem().map((i) => [i, this.nextCW(i)])); g.forEach(([a, b]) => moves.push(nm(a) + ' \u2192 ' + nm(b) + ': 1 ' + un(1))); break; }
        case 'Brotherhood': { const g = this.simulPass(this.rem().map((i) => [i, this.nextCCW(i)])); g.forEach(([a, b]) => moves.push(nm(a) + ' \u2192 ' + nm(b) + ': 1 ' + un(1))); break; }
        case 'Arbitration': {
          const s = await this.pickCand(this.dean, 'Spirit of Arbitration \u2014 the Dean moves 2 ' + S + ' FROM which candidate?', this.rem(), { always: true });
          const d = await this.pickCand(this.dean, 'Move them TO which candidate?', this.rem().filter((x) => x !== s), { always: true });
          mv(s, d, 2); break;
        }
        case 'Gratitude': {
          for (const i of this.order()) {
            if (this.unprot(i) < 1) { moves.push(nm(i) + ' has none to give'); continue; }
            const d = await this.pickCand(i, nm(i) + ' (Spirit of Gratitude) \u2014 give 1 of your own ' + S + ' to which candidate?', this.rem().filter((x) => x !== i), { always: true });
            mv(i, d, 1);
          }
          break;
        }
        case 'Hospitality': {
          const w = this.nextCW(this.dean);
          const s = await this.pickCand(w, 'Spirit of Hospitality \u2014 ' + nm(w) + ' moves 2 ' + S + ' FROM which candidate?', this.rem(), { always: true });
          const d = await this.pickCand(w, 'Move them TO which candidate?', this.rem().filter((x) => x !== s), { always: true });
          mv(s, d, 2); break;
        }
        case 'Restraint': { const conv = this.rem().filter((i) => this.p[i].act === 'converse'); const g = this.simulPass(conv.map((i) => [i, this.nextCW(i)])); g.forEach(([a, b]) => moves.push(nm(a) + ' \u2192 ' + nm(b) + ': 1 ' + un(1))); if (!conv.length) moves.push('nobody played Converse'); break; }
        default: break;
      }
      await done();
    }

    // ---------------------------------------------------------------- ballot / elimination
    async ballot() {
      this.stage = 'ballot';
      const rk = await this.ranking();
      const aw = BALLOT[this.n];
      const parts = [];
      rk.forEach((i, idx) => { this.p[i].votes += aw[idx]; this.pool -= aw[idx]; parts.push(this.name(i) + ' +' + aw[idx]); });
      this.ballotResult = rk.map((i, idx) => ({ id: i, infl: this.p[i].infl, award: aw[idx] }));
      await this.note('BALLOT \u2014 17 votes are awarded by Influence rank:   ' + parts.join('   \u00B7   ') + '.', true);
      this.p.forEach((q) => { this.supply += q.infl; q.infl = 0; q.pi = 0; });
      this.pending.clear();
    }

    async elimination() {
      this.stage = 'elimination';
      const cands = this.rem();
      const low = Math.min(...cands.map((i) => this.p[i].votes));
      const tied = cands.filter((i) => this.p[i].votes === low);
      let e = tied[0];
      if (tied.length > 1) e = await this.pickCand(this.dean, 'Tie for fewest votes (' + low + ') \u2014 the Dean rules who is eliminated', tied, { always: true });
      const others = cands.filter((x) => x !== e);
      const n = this.p[e].votes;
      await this.note(this.name(e) + ' has the fewest votes (' + n + ') and is ELIMINATED. They now rank the remaining candidates and deal out their votes.', true);
      let ranked = others;
      if (others.length > 1) ranked = await this.orderCands(e, this.name(e) + ' is eliminated \u2014 rank the remaining candidates, first choice first. Votes are dealt ' + others.length + ', ' + (others.length - 1) + ', \u2026, 1 down your ranking, and again, until you have none.', others, 'elim', n);
      const m = ranked.length, got = {};
      ranked.forEach((i) => { got[i] = 0; });
      let left = n;
      while (left > 0) { for (let idx = 0; idx < m && left > 0; idx++) { const g = Math.min(m - idx, left); got[ranked[idx]] += g; left -= g; } }
      this.hold++;
      try {
        ranked.forEach((i) => { this.p[i].votes += got[i]; });
        this.p[e].votes = 0; this.p[e].pv = 0;
      } finally { this.hold--; }
      this.p[e].out = true; this.elimOrder.push(e);
      this.lastDeal = { from: e, ranked: ranked.slice(), got: Object.assign({}, got), total: n };
      const parts = ranked.map((i) => this.name(i) + ' +' + got[i]).join('   \u00B7   ');
      await this.note(n ? this.name(e) + ' deals ' + n + ' votes:   ' + parts + '.' : this.name(e) + ' has no votes to deal.', true);
      this.dean = e;
      this.checkWin();
    }

    // ---------------------------------------------------------------- the round
    async playRound() {
      this.round++;
      if (this.round === 7) { this.phase = 'F'; this.p.forEach((q) => { if (q.last === 'call') q.last = null; }); }
      this.stage = 'start'; this.pending.clear();
      this.p.forEach((q) => { q.act = null; q.shown = false; });
      this.refresh();
      if (this.ui.roundStart) await this.ui.roundStart(this);
      // 1. select (secret)
      this.stage = 'select';
      const choose = async (i) => {
        const q = this.p[i];
        const avail = this.actionsFor().filter((a) => a !== q.last);
        const a = await this.ui.selectAction(this, i, avail);
        q.act = avail.includes(a) ? a : avail[0];
        this.refresh();
      };
      if (this.parallel) await Promise.all(this.rem().map(choose));
      else for (const i of this.rem()) await choose(i);
      // 2. reveal
      this.stage = 'reveal'; this.refresh();
      if (this.ui.reveal) await this.ui.reveal(this);
      this.p.forEach((q) => { if (!q.out) q.shown = true; });
      this.refresh();
      if (this.ui.afterReveal) await this.ui.afterReveal(this);
      // 3. resolve: Reflects first, then everything else, clockwise from the Dean
      this.stage = 'resolve';
      const ord = this.order();
      for (const i of ord) if (this.p[i].act === 'reflect') await this.doAction(i);
      for (const i of ord) if (this.p[i].act !== 'reflect') await this.doAction(i);
      // 4. Holy Spirit
      await this.holySpirit();
      this.cardShown = null;
      // 5. ballot or elimination
      if (this.phase === 'C') await this.ballot(); else await this.elimination();
      // 6. end of round
      this.p.forEach((q) => { q.pv = 0; q.last = q.act; });
      this.pending.clear();
      if (this.phase === 'C') this.dean = (this.dean + 1) % this.n;
      this.stage = 'end'; this.refresh();
    }

    async run() {
      try { while (this.winner === null) await this.playRound(); }
      catch (e) { if (!(e instanceof GameOver)) throw e; }
      this.stage = 'over'; this.refresh();
      if (this.ui.gameOver) await this.ui.gameOver(this);
      return this.winner;
    }
  }

  const API = { Game, COLORS, BALLOT, CARDS, ACTIONS, GameOver };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.HP = API;
})(typeof window !== 'undefined' ? window : globalThis);
