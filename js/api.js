/**
 * Data layer: fetches ESPN's public (unofficial) NFL endpoints straight from the
 * browser and turns the responses into small plain objects. Every parser is
 * defensive, because the feed has no published contract and fields come and go.
 */
(function (root) {
  'use strict';

  var BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
  var BASE_V2 = 'https://site.api.espn.com/apis/v2/sports/football/nfl';
  var TTL_MS = 5 * 60 * 1000;
  var memory = {};

  function cacheGet(url) {
    var hit = memory[url];
    if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
    try {
      var raw = sessionStorage.getItem('gl:' + url);
      if (raw) {
        var obj = JSON.parse(raw);
        if (Date.now() - obj.at < TTL_MS) { memory[url] = obj; return obj.data; }
      }
    } catch (e) { /* storage can be unavailable */ }
    return null;
  }
  function cacheSet(url, data) {
    var obj = { at: Date.now(), data: data };
    memory[url] = obj;
    try { sessionStorage.setItem('gl:' + url, JSON.stringify(obj)); } catch (e) { /* ignore */ }
  }

  function getJSON(url) {
    var cached = cacheGet(url);
    if (cached) return Promise.resolve(cached);
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('The data service answered ' + r.status);
      return r.json();
    }).then(function (j) { cacheSet(url, j); return j; });
  }

  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }
  function str(v) { return v === undefined || v === null ? '' : String(v); }

  /** Value of a named stat in a list of {name, value, displayValue}. */
  function statOf(list, name) {
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === name) return list[i];
    return null;
  }
  function statNum(list, name) { var s = statOf(list, name); return s ? num(s.value) : 0; }

  function logoOf(team) {
    if (!team) return '';
    if (team.logo) return team.logo;
    var l = team.logos && team.logos[0];
    return l && l.href ? l.href : '';
  }

  /* ---------- parsers ---------- */

  function parseTeams(j) {
    var out = {};
    var leagues = (j.sports && j.sports[0] && j.sports[0].leagues) || [];
    var list = (leagues[0] && leagues[0].teams) || [];
    list.forEach(function (w) {
      var t = w.team || w;
      if (!t || !t.id) return;
      out[t.id] = {
        id: str(t.id), name: str(t.displayName), short: str(t.shortDisplayName || t.name), abbr: str(t.abbreviation),
        location: str(t.location), nick: str(t.name), color: t.color ? '#' + t.color : '', alt: t.alternateColor ? '#' + t.alternateColor : '', logo: logoOf(t),
      };
    });
    return out;
  }

  function parseStandings(j) {
    var teams = {};
    (j.children || []).forEach(function (conf) {
      var entries = (conf.standings && conf.standings.entries) || [];
      entries.forEach(function (e) {
        var t = e.team || {};
        if (!t.id) return;
        var st = e.stats || [];
        var overall = statOf(st, 'overall');
        var home = statOf(st, 'Home') || statOf(st, 'home');
        var road = statOf(st, 'Road') || statOf(st, 'road');
        var streak = statOf(st, 'streak');
        var seed = statOf(st, 'playoffSeed');
        teams[t.id] = {
          id: str(t.id), name: str(t.displayName), short: str(t.shortDisplayName || t.name), abbr: str(t.abbreviation), logo: logoOf(t),
          conf: str(conf.abbreviation || conf.name),
          w: statNum(st, 'wins'), l: statNum(st, 'losses'), t: statNum(st, 'ties'),
          pct: statOf(st, 'winPercent') ? str(statOf(st, 'winPercent').displayValue) : '',
          pf: statNum(st, 'pointsFor'), pa: statNum(st, 'pointsAgainst'),
          diff: statOf(st, 'differential') ? num(statOf(st, 'differential').value) : (statNum(st, 'pointsFor') - statNum(st, 'pointsAgainst')),
          streak: streak ? str(streak.displayValue) : '', seed: seed ? num(seed.value, 99) : 99,
          overall: overall ? str(overall.summary || overall.displayValue) : '',
          home: home ? str(home.summary || home.displayValue) : '', road: road ? str(road.summary || road.displayValue) : '',
        };
      });
    });
    return teams;
  }

  function parseCompetitor(c) {
    var team = c.team || {};
    var rec = (c.records || []).filter(function (r) { return r.type === 'total' || r.name === 'overall'; })[0];
    var score = c.score;
    if (score && typeof score === 'object') score = score.displayValue !== undefined ? score.displayValue : score.value;
    return {
      id: str(team.id), abbr: str(team.abbreviation), name: str(team.displayName), short: str(team.shortDisplayName || team.name), logo: logoOf(team),
      score: score === undefined || score === '' ? null : num(score, null), record: rec ? str(rec.summary) : '', winner: c.winner === true,
      homeAway: str(c.homeAway),
    };
  }

  function parseEvent(ev) {
    var comp = (ev.competitions && ev.competitions[0]) || {};
    var comps = (comp.competitors || []).map(parseCompetitor);
    var home = comps.filter(function (c) { return c.homeAway === 'home'; })[0] || comps[0];
    var away = comps.filter(function (c) { return c.homeAway === 'away'; })[0] || comps[1];
    var type = (ev.status && ev.status.type) || (comp.status && comp.status.type) || {};
    var status = comp.status || ev.status || {};
    return {
      id: str(ev.id), date: str(ev.date), name: str(ev.name), week: ev.week && ev.week.number ? num(ev.week.number) : null,
      state: str(type.state) || 'pre', completed: !!type.completed, detail: str(type.shortDetail || type.detail || type.description),
      clock: str(status.displayClock), period: num(status.period),
      neutral: !!comp.neutralSite, venue: comp.venue && comp.venue.fullName ? str(comp.venue.fullName) : '',
      home: home, away: away,
    };
  }

  function parseScoreboard(j) {
    var wk = j.week || {};
    var lg = (j.leagues && j.leagues[0]) || {};
    var cal = lg.calendar || [];
    return {
      week: num(wk.number, null), seasonType: num((j.season || {}).type, 2), year: num((j.season || {}).year, null),
      games: (j.events || []).map(parseEvent),
      byes: (wk.teamsOnBye || []).map(function (t) { return { id: str(t.id), abbr: str(t.abbreviation), name: str(t.displayName), logo: logoOf(t) }; }),
      calendar: cal,
    };
  }

  function parseRoster(j) {
    var groups = [];
    var raw = j.athletes || [];
    function player(p) {
      var inj = (p.injuries && p.injuries[0]) || null;
      return {
        id: str(p.id), name: str(p.fullName || p.displayName), jersey: str(p.jersey), pos: p.position ? str(p.position.abbreviation) : '',
        age: p.age ? num(p.age) : '', height: str(p.displayHeight), weight: str(p.displayWeight), exp: p.experience && p.experience.years !== undefined ? num(p.experience.years) : '',
        college: p.college && p.college.name ? str(p.college.name) : '', head: p.headshot && p.headshot.href ? p.headshot.href : '',
        injury: inj ? str(inj.status) : '', status: p.status && p.status.name ? str(p.status.name) : '',
      };
    }
    if (raw.length && raw[0] && raw[0].items) {
      raw.forEach(function (g) {
        groups.push({ name: str(g.position || ''), players: (g.items || []).map(player) });
      });
    } else {
      groups.push({ name: 'roster', players: raw.map(player) });
    }
    return { groups: groups, coach: j.coach && j.coach[0] ? str((j.coach[0].firstName || '') + ' ' + (j.coach[0].lastName || '')).trim() : '' };
  }

  function parseStats(j) {
    var res = j.results || {};
    var cats = (res.stats && res.stats.categories) || [];
    var opp = res.opponent || [];
    function mapCat(c) {
      return { name: str(c.name), title: str(c.displayName || c.name), stats: (c.stats || []).map(function (s) {
        return { name: str(s.name), title: str(s.displayName || s.name), value: num(s.value), shown: str(s.displayValue), perGame: s.perGameDisplayValue ? str(s.perGameDisplayValue) : '', rank: s.rank ? num(s.rank) : null, rankText: str(s.rankDisplayValue) };
      }) };
    }
    return { team: cats.map(mapCat), opponent: opp.map(mapCat) };
  }

  function parseSchedule(j) {
    return (j.events || []).map(parseEvent);
  }

  /* ---------- public calls ---------- */

  var api = {
    teams: function () { return getJSON(BASE + '/teams?limit=40').then(parseTeams); },
    standings: function () { return getJSON(BASE_V2 + '/standings').then(parseStandings); },
    scoreboard: function (week, seasonType) {
      var q = week ? '?week=' + week + '&seasontype=' + (seasonType || 2) : '';
      return getJSON(BASE + '/scoreboard' + q).then(parseScoreboard);
    },
    roster: function (id) { return getJSON(BASE + '/teams/' + encodeURIComponent(id) + '/roster').then(parseRoster); },
    teamStats: function (id) { return getJSON(BASE + '/teams/' + encodeURIComponent(id) + '/statistics').then(parseStats); },
    schedule: function (id) { return getJSON(BASE + '/teams/' + encodeURIComponent(id) + '/schedule').then(parseSchedule); },
    // exposed for tests
    _parse: { teams: parseTeams, standings: parseStandings, scoreboard: parseScoreboard, roster: parseRoster, stats: parseStats, schedule: parseSchedule },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Api = api;
})(typeof self !== 'undefined' ? self : this);
