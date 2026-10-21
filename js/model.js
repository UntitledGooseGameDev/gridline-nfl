/**
 * The prediction model. Pure functions, no network, no DOM, so it can be tested
 * in Node and used unchanged in the page.
 *
 * Strength: a team's average scoring margin per game, blended with a small share
 * of last season's margin and pulled toward zero while few games have been played.
 * A game: expected home margin = strength difference + home field, and the chance
 * of winning is the normal curve of that margin (NFL results land around a
 * prediction with a spread of about 13 points).
 */
(function (root) {
  'use strict';

  var HOME_FIELD = 2.0;     // points of advantage for the home team
  var SIGMA = 13.2;         // typical spread of NFL game margins around a prediction
  var PRIOR_GAMES = 6;      // how many games' worth of prior a team starts with
  var CARRYOVER = 0.4;      // share of last season's margin assumed to carry into this one
  var MAX_INJURY = 8;       // cap on points lost to injuries in one game

  /** The 32 teams by division, keyed by abbreviation. */
  var DIVISIONS = {
    'AFC East': ['BUF', 'MIA', 'NE', 'NYJ'], 'AFC North': ['BAL', 'CIN', 'CLE', 'PIT'],
    'AFC South': ['HOU', 'IND', 'JAX', 'TEN'], 'AFC West': ['DEN', 'KC', 'LV', 'LAC'],
    'NFC East': ['DAL', 'NYG', 'PHI', 'WSH'], 'NFC North': ['CHI', 'DET', 'GB', 'MIN'],
    'NFC South': ['ATL', 'CAR', 'NO', 'TB'], 'NFC West': ['ARI', 'LAR', 'SF', 'SEA'],
  };
  function divisionOf(abbr) {
    for (var d in DIVISIONS) if (DIVISIONS[d].indexOf(abbr) >= 0) return d;
    return '';
  }

  /** Standard normal cumulative distribution (Abramowitz-Stegun 7.1.26 on erf). */
  function normCdf(x) {
    var t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
    return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  }

  /**
   * Strength in points above an average team, from a season record.
   * priorMov is last season's average margin (optional); a share of it is the
   * starting point that this season's games gradually replace.
   */
  function rating(rec, priorMov) {
    var gp = (rec.w || 0) + (rec.l || 0) + (rec.t || 0);
    var prior = (priorMov || 0) * CARRYOVER;
    var mov = gp ? ((rec.pf || 0) - (rec.pa || 0)) / gp : 0;
    return { rating: (mov * gp + prior * PRIOR_GAMES) / (gp + PRIOR_GAMES), gp: gp, mov: mov, prior: prior };
  }

  /** Chance the home team wins, with an optional points adjustment for each side. */
  function winProb(homeRating, awayRating, neutral, homeAdj, awayAdj) {
    var spread = homeRating - awayRating + (neutral ? 0 : HOME_FIELD) + (homeAdj || 0) - (awayAdj || 0);
    var home = normCdf(spread / SIGMA);
    return { home: home, away: 1 - home, spread: spread };
  }

  /* ---------- injuries ---------- */
  var POS_WEIGHT = {
    QB: 5.0, RB: 0.7, FB: 0.1, WR: 0.6, TE: 0.5, T: 0.6, OT: 0.6, G: 0.5, OG: 0.5, C: 0.5, OL: 0.5,
    DE: 0.6, DT: 0.5, NT: 0.4, DL: 0.5, LB: 0.4, OLB: 0.5, ILB: 0.4, MLB: 0.4, CB: 0.5, S: 0.4, FS: 0.4, SS: 0.4, DB: 0.4, K: 0.3, P: 0.1, LS: 0.05,
  };
  var STATUS_WEIGHT = { out: 1, 'injured reserve': 0, ir: 0, doubtful: 0.85, questionable: 0.25, 'day-to-day': 0.2 };

  /** Points a team loses to injuries (positive number). */
  function injuryPenalty(list) {
    var total = 0;
    (list || []).forEach(function (p) {
      var sw = STATUS_WEIGHT[String(p.status || '').toLowerCase()];
      if (!sw) return;
      var pw = POS_WEIGHT[String(p.pos || '').toUpperCase()];
      total += sw * (pw === undefined ? 0.3 : pw);
    });
    return Math.min(total, MAX_INJURY);
  }

  /* ---------- records and display ---------- */
  function projectRecord(rec, chances) {
    var ew = 0;
    for (var i = 0; i < chances.length; i++) ew += chances[i];
    return {
      wins: (rec.w || 0) + (rec.t || 0) * 0.5 + ew,
      losses: (rec.l || 0) + (rec.t || 0) * 0.5 + (chances.length - ew),
      remaining: chances.length,
    };
  }
  function pct(p) {
    var v = Math.round(p * 100);
    if (v <= 0) v = 1;
    if (v >= 100) v = 99;
    return v + '%';
  }
  /** Percent for a season outcome, where 0 and 100 are honest answers after simulation. */
  function pctSim(p) {
    if (p <= 0) return '0%';
    if (p >= 1) return '100%';
    var v = Math.round(p * 100);
    if (v <= 0) return '<1%';
    if (v >= 100) return '>99%';
    return v + '%';
  }
  function spreadText(spread, homeAbbr, awayAbbr) {
    var s = Math.abs(spread);
    if (s < 0.5) return "Pick'em";
    return (spread > 0 ? homeAbbr : awayAbbr) + ' by ' + (Math.round(s * 2) / 2).toFixed(1);
  }

  /* ---------- season simulation ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /**
   * Order a conference into playoff seeds. info[id] = { conf, div, diff }; wins[id] = wins.
   * Four division winners take seeds 1-4, the next three best records take 5-7.
   * Tiebreaks are simplified: point differential, then luck.
   */
  function seedConference(ids, info, wins, rnd) {
    var key = {};
    ids.forEach(function (id) { key[id] = wins[id] + (info[id].diff || 0) * 0.0005 + rnd() * 0.01; });
    var byDiv = {};
    ids.forEach(function (id) { (byDiv[info[id].div] = byDiv[info[id].div] || []).push(id); });
    var winners = [];
    Object.keys(byDiv).forEach(function (d) {
      byDiv[d].sort(function (a, b) { return key[b] - key[a]; });
      winners.push(byDiv[d][0]);
    });
    winners.sort(function (a, b) { return key[b] - key[a]; });
    var rest = ids.filter(function (id) { return winners.indexOf(id) < 0; }).sort(function (a, b) { return key[b] - key[a]; });
    return { seeds: winners.slice(0, 4).concat(rest.slice(0, 3)), winners: winners };
  }

  /**
   * Monte Carlo the rest of the regular season.
   * teams: id -> { conf, div, w, l, t, diff }; games: [{ h, a, p }] with p = home win chance.
   * Returns id -> { division, playoff, topSeed, wins } as fractions / averages.
   */
  function simulateSeason(teams, games, sims, seed) {
    var rnd = mulberry32(seed || 1);
    var ids = Object.keys(teams);
    var confs = {};
    ids.forEach(function (id) { (confs[teams[id].conf] = confs[teams[id].conf] || []).push(id); });
    var out = {};
    ids.forEach(function (id) { out[id] = { division: 0, playoff: 0, topSeed: 0, wins: 0 }; });
    for (var s = 0; s < sims; s++) {
      var wins = {};
      ids.forEach(function (id) { wins[id] = (teams[id].w || 0) + (teams[id].t || 0) * 0.5; });
      for (var g = 0; g < games.length; g++) {
        var game = games[g];
        if (wins[game.h] === undefined || wins[game.a] === undefined) continue;
        if (rnd() < game.p) wins[game.h] += 1; else wins[game.a] += 1;
      }
      ids.forEach(function (id) { out[id].wins += wins[id]; });
      Object.keys(confs).forEach(function (c) {
        var r = seedConference(confs[c], teams, wins, rnd);
        r.winners.forEach(function (id) { out[id].division += 1; });
        r.seeds.forEach(function (id) { out[id].playoff += 1; });
        if (r.seeds[0]) out[r.seeds[0]].topSeed += 1;
      });
    }
    ids.forEach(function (id) {
      var o = out[id];
      o.division /= sims; o.playoff /= sims; o.topSeed /= sims; o.wins /= sims;
    });
    return out;
  }

  /* ---------- report card ---------- */
  /**
   * Replay finished games in date order, predicting each one with only what was
   * known before it. games: [{ date, neutral, home: {id, score}, away: {id, score} }].
   * prior: id -> last season's average margin (optional).
   */
  function backtest(games, prior) {
    prior = prior || {};
    var rec = {};
    function get(id) { return rec[id] || (rec[id] = { w: 0, l: 0, t: 0, pf: 0, pa: 0 }); }
    var list = games.filter(function (g) { return g.home.score !== null && g.away.score !== null; })
      .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    var n = 0, correct = 0, brier = 0, logloss = 0;
    var bins = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 1.01]].map(function (b) { return { lo: b[0], hi: Math.min(b[1], 1), n: 0, pred: 0, hits: 0 }; });
    list.forEach(function (g) {
      var h = get(g.home.id), a = get(g.away.id);
      var p = winProb(rating(h, prior[g.home.id]).rating, rating(a, prior[g.away.id]).rating, g.neutral).home;
      var hs = g.home.score, as = g.away.score;
      if (hs !== as) {
        var homeWon = hs > as ? 1 : 0;
        n++;
        var fav = p >= 0.5 ? p : 1 - p, favWon = (p >= 0.5) === (homeWon === 1);
        if (favWon) correct++;
        brier += Math.pow(p - homeWon, 2);
        var pr = homeWon ? p : 1 - p;
        logloss += -Math.log(Math.max(pr, 1e-6));
        for (var i = 0; i < bins.length; i++) if (fav >= bins[i].lo && fav < bins[i].hi + (i === bins.length - 1 ? 1e-9 : 0)) { bins[i].n++; bins[i].pred += fav; if (favWon) bins[i].hits++; break; }
      }
      h.pf += hs; h.pa += as; a.pf += as; a.pa += hs;
      if (hs > as) { h.w++; a.l++; } else if (as > hs) { a.w++; h.l++; } else { h.t++; a.t++; }
    });
    return {
      n: n, correct: correct, accuracy: n ? correct / n : 0, brier: n ? brier / n : 0, logloss: n ? logloss / n : 0,
      bins: bins.map(function (b) { return { lo: b.lo, hi: b.hi, n: b.n, pred: b.n ? b.pred / b.n : 0, actual: b.n ? b.hits / b.n : 0 }; }),
    };
  }

  var api = {
    HOME_FIELD: HOME_FIELD, SIGMA: SIGMA, PRIOR_GAMES: PRIOR_GAMES, CARRYOVER: CARRYOVER, MAX_INJURY: MAX_INJURY, DIVISIONS: DIVISIONS,
    divisionOf: divisionOf, normCdf: normCdf, rating: rating, winProb: winProb, injuryPenalty: injuryPenalty,
    projectRecord: projectRecord, pct: pct, pctSim: pctSim, spreadText: spreadText,
    mulberry32: mulberry32, seedConference: seedConference, simulateSeason: simulateSeason, backtest: backtest,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Model = api;
})(typeof self !== 'undefined' ? self : this);
