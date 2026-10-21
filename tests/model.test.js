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
  assert.equal(Model.rating({ w: 0, l: 0, t: 0, pf: 0, pa: 0 }).rating, 0);
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

test('last season gives a starting point that fades as games are played', () => {
  const start = Model.rating({ w: 0, l: 0, t: 0, pf: 0, pa: 0 }, 10).rating;
  assert.ok(Math.abs(start - 4) < 1e-9);
  const later = Model.rating({ w: 12, l: 0, t: 0, pf: 120, pa: 120 }, 10).rating;
  assert.ok(later > 0 && later < start);
});

test('injuries: a missing quarterback hurts far more than a kicker, and the total is capped', () => {
  const qb = Model.injuryPenalty([{ pos: 'QB', status: 'Out' }]);
  const k = Model.injuryPenalty([{ pos: 'K', status: 'Out' }]);
  assert.ok(qb > 10 * k);
  assert.equal(Model.injuryPenalty([{ pos: 'QB', status: 'Out' }, { pos: 'QB', status: 'Out' }]), Model.MAX_INJURY);
  assert.equal(Model.injuryPenalty([{ pos: 'QB', status: 'Injured Reserve' }]), 0);
  assert.equal(Model.injuryPenalty([]), 0);
  assert.ok(Model.winProb(0, 0, true, 0, -5).home > 0.5);
});

test('season simulation: a dominant team almost always makes the playoffs and odds add up', () => {
  const teams = {}, ids = [];
  const names = Object.keys(Model.DIVISIONS);
  names.forEach((d) => Model.DIVISIONS[d].forEach((ab, i) => { teams[ab] = { conf: d.slice(0, 3), div: d, w: 0, l: 0, t: 0, diff: 0 }; ids.push(ab); }));
  const games = [];
  ids.forEach((a, i) => { for (let k = 1; k <= 4; k++) games.push({ h: a, a: ids[(i + k * 3) % ids.length], p: a === 'KC' ? 0.97 : 0.5 }); });
  const o = Model.simulateSeason(teams, games, 600, 7);
  assert.ok(o.KC.playoff > 0.9);
  const afc = ids.filter((x) => teams[x].conf === 'AFC');
  assert.ok(Math.abs(afc.reduce((s, x) => s + o[x].playoff, 0) - 7) < 1e-9);
  assert.ok(Math.abs(afc.reduce((s, x) => s + o[x].division, 0) - 4) < 1e-9);
  assert.ok(Math.abs(afc.reduce((s, x) => s + o[x].topSeed, 0) - 1) < 1e-9);
});

test('backtest replays games in order and scores itself honestly', () => {
  const g = (d, h, a, hs, as) => ({ date: d, neutral: false, home: { id: h, score: hs }, away: { id: a, score: as } });
  const games = [g('1', 'A', 'B', 30, 10), g('2', 'A', 'C', 31, 3), g('3', 'B', 'C', 20, 17), g('4', 'A', 'B', 24, 20), g('5', 'C', 'A', 10, 10)];
  const r = Model.backtest(games, {});
  assert.equal(r.n, 4);
  assert.ok(r.accuracy >= 0 && r.accuracy <= 1);
  assert.ok(r.brier > 0 && r.brier < 0.5);
  assert.equal(r.bins.reduce((s, b) => s + b.n, 0), 4);
});

test('pctSim keeps honest extremes', () => {
  assert.equal(Model.pctSim(0), '0%'); assert.equal(Model.pctSim(1), '100%'); assert.equal(Model.pctSim(0.004), '<1%'); assert.equal(Model.pctSim(0.5), '50%');
});

test('new parsers: injuries, leaders, overview, summary survive real-looking and empty input', () => {
  const inj = Api._parse.injuries({ injuries: [{ id: '12', injuries: [{ status: 'Out', athlete: { displayName: 'Pat Q', position: { abbreviation: 'QB' } }, details: { type: 'Knee', detail: 'Not Specified' }, shortComment: 'x' }] }] });
  assert.equal(inj['12'][0].pos, 'QB'); assert.equal(inj['12'][0].detail, 'Knee');
  assert.deepEqual(Api._parse.injuries({}), {});
  const lead = Api._parse.leaders({ categories: [{ name: 'passing', labels: ['CMP', 'YDS'] }], athletes: [{ athlete: { id: '9', displayName: 'A B', position: { abbreviation: 'QB' }, teamShortName: 'KC', teamId: '12' }, categories: [{ name: 'passing', totals: ['10', '200'] }] }] }, 'passing');
  assert.equal(lead.rows[0].values[1], '200'); assert.equal(lead.labels[0], 'CMP');
  assert.equal(Api._parse.leaders({}, 'passing').rows.length, 0);
  const ov = Api._parse.overview({ statistics: { displayName: '2026 Season', labels: ['GP'], splits: [{ displayName: 'Regular Season', stats: ['6'] }] } });
  assert.equal(ov.splits[0].stats[0], '6');
  assert.equal(Api._parse.summary({}).available, false);
  assert.equal(Api._parse.summary({}).state, 'pre');
});

test('live win chance: leaders gain as the clock runs, a tie late is a coin flip, the final lead is decisive', () => {
  assert.equal(Model.secondsLeft(1, '15:00'), 3600); assert.equal(Model.secondsLeft(2, '0:00'), 1800); assert.equal(Model.secondsLeft(4, '1:30'), 90); assert.equal(Model.secondsLeft(5, '12:00'), 600);
  const early = Model.liveWinProb(0, 7, 3000, 0).home, late = Model.liveWinProb(0, 7, 300, 0).home;
  assert.ok(late > early && early > 0.5);
  assert.ok(Math.abs(Model.liveWinProb(0, 0, 100, 0).home - 0.5) < 1e-9);
  assert.ok(Model.liveWinProb(0, 3, 0, 0).home > 0.95);
  assert.ok(Model.liveWinProb(0, 0, 600, 1).home > 0.5);
  const kickoff = Model.liveWinProb(4, 0, 3600, 0).home;
  assert.ok(Math.abs(kickoff - Model.winProb(4, 0, true).home) < 0.02 || kickoff > 0.5);
});

test('parsers read broadcasts and the live situation', () => {
  assert.deepEqual(Api._parse.broadcasts({ broadcasts: [{ names: ['CBS', 'Paramount+'] }], geoBroadcasts: [{ media: { shortName: 'CBS' } }] }), ['CBS', 'Paramount+']);
  assert.deepEqual(Api._parse.broadcasts({ broadcast: 'FOX' }), ['FOX']);
  assert.deepEqual(Api._parse.broadcasts({}), []);
  const s = Api._parse.situation({ down: 2, distance: 7, possession: '25', shortDownDistanceText: '2nd & 7', possessionText: 'SF 35', isRedZone: false, lastPlay: { text: 'Pass for 5 yards' } });
  assert.equal(s.shortText, '2nd & 7'); assert.equal(s.possession, '25'); assert.equal(s.where, 'SF 35');
  assert.equal(Api._parse.situation(null), null);
});

test('betting line and news parsers', () => {
  const o = Api._parse.odds({ odds: [{ details: 'KC -3.5', overUnder: 47.5, provider: { name: 'ESPN BET' } }] }, 'KC');
  assert.equal(o.homeMargin, 3.5); assert.equal(o.overUnder, 47.5);
  assert.equal(Api._parse.odds({ odds: [{ details: 'KC -3.5' }] }, 'BUF').homeMargin, -3.5);
  assert.equal(Api._parse.odds({ odds: [{ details: 'EVEN' }] }, 'BUF').homeMargin, 0);
  assert.equal(Api._parse.odds({}, 'KC'), null);
  const n = Api._parse.news({ articles: [{ headline: 'Hi', description: 'd', published: '2026-10-20T10:00Z', links: { web: { href: 'https://espn.com/x' } }, images: [{ url: 'https://a/b.jpg' }] }, { headline: 'bad link', links: { web: { href: 'javascript:alert(1)' } } }] });
  assert.equal(n.length, 1); assert.equal(n[0].link, 'https://espn.com/x');
  assert.equal(Api._parse.news({}).length, 0);
});
