/**
 * The win-likelihood model. Pure functions, no network, no DOM, so it can be
 * tested in Node and used unchanged in the page.
 *
 * Idea: a team's strength is its average scoring margin per game, pulled toward
 * zero while few games have been played. The expected margin of a game is the
 * difference of the two strengths plus a home-field bonus, and the chance of
 * winning is the normal curve of that margin, because NFL margins around a
 * prediction spread out roughly like a bell curve with a standard deviation of
 * about 13 points.
 */
(function (root) {
  'use strict';

  var HOME_FIELD = 2.0;     // points of advantage for the home team
  var SIGMA = 13.2;         // typical spread of NFL game margins around a prediction
  var PRIOR_GAMES = 6;      // how many "average" games a team starts with

  /** Standard normal cumulative distribution (Abramowitz-Stegun 7.1.26 on erf). */
  function normCdf(x) {
    var t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
    return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  }

  /** Strength in points above an average team, from a season record. */
  function rating(rec) {
    var gp = (rec.w || 0) + (rec.l || 0) + (rec.t || 0);
    if (!gp) return { rating: 0, gp: 0, mov: 0 };
    var mov = ((rec.pf || 0) - (rec.pa || 0)) / gp;
    return { rating: mov * gp / (gp + PRIOR_GAMES), gp: gp, mov: mov };
  }

  /**
   * Chance the home team wins. Pass neutral = true for a neutral site.
   * Returns { home, away, spread } where spread is the expected home margin.
   */
  function winProb(homeRating, awayRating, neutral) {
    var spread = homeRating - awayRating + (neutral ? 0 : HOME_FIELD);
    var home = normCdf(spread / SIGMA);
    return { home: home, away: 1 - home, spread: spread };
  }

  /** Expected final record from the current one plus the win chances of games left. */
  function projectRecord(rec, chances) {
    var ew = 0;
    for (var i = 0; i < chances.length; i++) ew += chances[i];
    return {
      wins: (rec.w || 0) + (rec.t || 0) * 0.5 + ew,
      losses: (rec.l || 0) + (rec.t || 0) * 0.5 + (chances.length - ew),
      remaining: chances.length,
    };
  }

  /** "63%" for display, never showing 0% or 100% for a game that is not over. */
  function pct(p) {
    var v = Math.round(p * 100);
    if (v <= 0) v = 1;
    if (v >= 100) v = 99;
    return v + '%';
  }

  /** A plain sentence about the spread: "CHI by 3.5" or "Pick'em". */
  function spreadText(spread, homeAbbr, awayAbbr) {
    var s = Math.abs(spread);
    if (s < 0.5) return "Pick'em";
    return (spread > 0 ? homeAbbr : awayAbbr) + ' by ' + (Math.round(s * 2) / 2).toFixed(1);
  }

  var api = { HOME_FIELD: HOME_FIELD, SIGMA: SIGMA, PRIOR_GAMES: PRIOR_GAMES, normCdf: normCdf, rating: rating, winProb: winProb, projectRecord: projectRecord, pct: pct, spreadText: spreadText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Model = api;
})(typeof self !== 'undefined' ? self : this);
