const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../js/model.js');
const Api = require('../js/api.js');
const fx = require('./fixtures.js');

test('normal curve matches known values', () => {
  assert.ok(Math.abs(Model.normCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(Model.normCdf(1) - 0.8413447) < 1e-4);
  assert.ok(Math.abs(Model.normCdf(-1.96) - 0.025) < 1e-3);
});

test('rating shrinks small samples toward zero', () => {
  const one = Model.rating({ w: 1, l: 0, t: 0, pf: 40, pa: 10 });
  const many = Model.rating({ w: 10, l: 0, t: 0, pf: 400, pa: 100 });
  assert.equal(one.mov, 30);
  assert.ok(one.rating < 30 && one.rating > 0);
  assert.ok(many.rating > one.rating);
  assert.deepEqual(Model.rating({ w: 0, l: 0, t: 0, pf: 0, pa: 0 }), { rating: 0, gp: 0, mov: 0 });
});

test('equal teams: home field gives about 56%, neutral gives exactly 50%', () => {
  const h = Model.winProb(0, 0, false);
  assert.ok(h.home > 0.55 && h.home < 0.6);
  assert.ok(Math.abs(h.home + h.away - 1) < 1e-12);
  assert.ok(Math.abs(Model.winProb(0, 0, true).home - 0.5) < 1e-9);
});

test('a stronger team is favoured, and swapping sides mirrors the answer on neutral ground', () => {
  const a = Model.winProb(8, 0, true).home;
  const b = Model.winProb(0, 8, true).home;
  assert.ok(a > 0.7);
  assert.ok(Math.abs(a + b - 1) < 1e-9);
});

test('projected record adds expected wins to the current record', () => {
  const p = Model.projectRecord({ w: 4, l: 2, t: 0 }, [0.5, 0.75, 0.25]);
  assert.equal(p.wins, 5.5);
  assert.equal(p.losses, 3.5);
  assert.equal(p.remaining, 3);
});

test('display helpers never show a sure thing', () => {
  assert.equal(Model.pct(0.999), '99%');
  assert.equal(Model.pct(0.001), '1%');
  assert.equal(Model.pct(0.634), '63%');
  assert.equal(Model.spreadText(3.2, 'CHI', 'NE'), 'CHI by 3.0');
  assert.equal(Model.spreadText(-6.9, 'CHI', 'NE'), 'NE by 7.0');
  assert.equal(Model.spreadText(0.2, 'CHI', 'NE'), "Pick'em");
});

test('standings parser reads records, points and the conference', () => {
  const t = Api._parse.standings(fx.standingsJson());
  assert.equal(Object.keys(t).length, fx.TEAMS.length);
  assert.equal(t['12'].w, 5);
  assert.equal(t['12'].conf, 'AFC');
  assert.equal(t['12'].diff, 60);
  assert.equal(t['17'].t, 1);
  assert.equal(t['12'].overall, '5-1');
});

test('scoreboard parser handles scheduled, live and final games', () => {
  const sb = Api._parse.scoreboard(fx.scoreboardJson(7));
  assert.equal(sb.week, 7);
  assert.equal(sb.games.length, 4);
  assert.equal(sb.byes[0].abbr, 'CIN');
  const [pre, live, post] = sb.games;
  assert.equal(pre.state, 'pre'); assert.equal(pre.home.abbr, 'CHI'); assert.equal(pre.home.score, null);
  assert.equal(live.state, 'in'); assert.equal(live.home.score, 7);
  assert.equal(post.state, 'post'); assert.equal(post.home.winner, true); assert.equal(post.away.score, 20);
});

test('scores can arrive as objects too', () => {
  const j = fx.scoreboardJson(1);
  j.events[2].competitions[0].competitors[0].score = { value: 27, displayValue: '27' };
  assert.equal(Api._parse.scoreboard(j).games[2].home.score, 27);
});

test('roster parser keeps groups, injuries and rookies', () => {
  const r = Api._parse.roster(fx.rosterJson());
  assert.deepEqual(r.groups.map((g) => g.name), ['offense', 'defense', 'specialTeam']);
  assert.equal(r.groups[0].players[0].injury, 'Questionable');
  assert.equal(r.groups[0].players[1].exp, 0);
  assert.equal(r.coach, 'Sam Sideline');
});

test('stats parser exposes team and opponent categories', () => {
  const s = Api._parse.stats(fx.statsJson());
  assert.equal(s.team[0].name, 'scoring');
  assert.equal(s.opponent[0].stats[0].rankText, '3rd');
});

test('parsers survive empty responses', () => {
  assert.deepEqual(Api._parse.standings({}), {});
  assert.deepEqual(Api._parse.teams({}), {});
  assert.equal(Api._parse.scoreboard({}).games.length, 0);
  assert.equal(Api._parse.roster({}).groups[0].players.length, 0);
  assert.equal(Api._parse.stats({}).team.length, 0);
  assert.equal(Api._parse.schedule({}).length, 0);
});
