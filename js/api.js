/**
 * Data layer: fetches ESPN's public (unofficial) NFL endpoints straight from the
 * browser and turns the responses into small plain objects. Every parser is
 * defensive, because the feed has no published contract and fields come and go.
 *
 * Saved copies: small, important responses are also kept in localStorage, so the
 * site can still show the last data it saw when the network is down.
 */
(function (root) {
  'use strict';

  var S1 = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
  var S2 = 'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl';
  var V1 = 'https://site.api.espn.com/apis/v2/sports/football/nfl';
  var V2 = 'https://site.web.api.espn.com/apis/v2/sports/football/nfl';
  var C3 = 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl';
  var TTL_MS = 5 * 60 * 1000;
  var memory = {};
  var meta = { stale: false, staleAt: 0, updatedAt: 0 };

  function both(a, b, path) { return [a + path, b + path]; }
  function site(path) { return both(S1, S2, path); }
  function v2(path) { return both(V1, V2, path); }

  function stored(key) { try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
  function store(key, obj) { try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { /* full or unavailable */ } }

  function cacheGet(url, ttl) {
    var hit = memory[url];
    if (hit && Date.now() - hit.at < ttl) return hit.data;
    return null;
  }

  /**
   * Fetch JSON, trying each address in turn. opts.ttl: how long a cached copy counts as fresh;
   * opts.keep: also save it for offline use.
   */
  function getJSON(urls, opts) {
    opts = opts || {};
    if (typeof urls === 'string') urls = [urls];
    var ttl = opts.ttl === undefined ? TTL_MS : opts.ttl;
    var cached = cacheGet(urls[0], ttl);
    if (cached) return Promise.resolve(cached);
    var lastErr = null;
    function attempt(i) {
      if (i >= urls.length) {
        var saved = opts.keep ? stored('glk:' + urls[0]) : null;
        if (saved) { meta.stale = true; meta.staleAt = Math.max(meta.staleAt, saved.at); return Promise.resolve(saved.data); }
        var path = urls[0].replace(/^https?:\/\/[^/]+/, '').split('?')[0];
        return Promise.reject(new Error('Could not reach ESPN for ' + path + (lastErr ? ' (' + lastErr + ')' : '') + '. Open #/debug to see which feeds your browser can reach.'));
      }
      return fetch(urls[i]).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) {
        var obj = { at: Date.now(), data: j };
        memory[urls[0]] = obj; meta.updatedAt = obj.at;
        if (opts.keep) store('glk:' + urls[0], obj);
        return j;
      }).catch(function (err) { lastErr = err && err.message ? err.message : String(err); return attempt(i + 1); });
    }
    return attempt(0);
  }

  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }
  function str(v) { return v === undefined || v === null ? '' : String(v); }
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
    var rec = (c.records || c.record || []).filter(function (r) { return r.type === 'total' || r.name === 'overall'; })[0];
    var score = c.score;
    if (score && typeof score === 'object') score = score.displayValue !== undefined ? score.displayValue : score.value;
    return {
      id: str(team.id), abbr: str(team.abbreviation), name: str(team.displayName), short: str(team.shortDisplayName || team.name), logo: logoOf(team),
      score: score === undefined || score === '' ? null : num(score, null), record: rec ? str(rec.summary || rec.displayValue) : '', winner: c.winner === true,
      homeAway: str(c.homeAway),
    };
  }

  /** TV / streaming names for a game (national first), from either broadcast shape ESPN uses. */
  function parseBroadcasts(comp) {
    var names = [];
    function add(n) { n = str(n).trim(); if (n && names.indexOf(n) < 0) names.push(n); }
    (comp.broadcasts || []).forEach(function (b) { (b.names || []).forEach(add); if (b.name) add(b.name); });
    (comp.geoBroadcasts || []).forEach(function (b) { if (b.media) add(b.media.shortName); });
    if (!names.length && comp.broadcast) add(comp.broadcast);
    return names;
  }

  /** Down, distance and ball position for a live game. */
  function parseSituation(s) {
    if (!s || typeof s !== 'object') return null;
    var lp = s.lastPlay || {};
    var out = {
      down: num(s.down, 0), distance: num(s.distance, 0), possession: str(s.possession || (lp.team && lp.team.id)),
      shortText: str(s.shortDownDistanceText || s.downDistanceText), where: str(s.possessionText), redZone: !!s.isRedZone,
      lastPlay: str(lp.text),
    };
    return out.shortText || out.where || out.lastPlay ? out : null;
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
      clock: str(status.displayClock || (ev.status || {}).displayClock), period: num(status.period || (ev.status || {}).period),
      neutral: !!comp.neutralSite, venue: comp.venue && comp.venue.fullName ? str(comp.venue.fullName) : '',
      home: home, away: away, broadcasts: parseBroadcasts(comp), situation: parseSituation(comp.situation),
    };
  }

  /** The postseason rounds with their week numbers, from the season calendar. */
  function parseCalendar(cal) {
    var post = [];
    (cal || []).forEach(function (c) {
      if (str(c.value) === '3' || /post/i.test(str(c.label))) {
        (c.entries || []).forEach(function (e) { post.push({ week: num(e.value, 0), label: str(e.label) }); });
      }
    });
    return post.filter(function (p) { return p.week; });
  }

  function parseScoreboard(j) {
    var wk = j.week || {};
    var lg = (j.leagues && j.leagues[0]) || {};
    return {
      week: num(wk.number, null), seasonType: num((j.season || {}).type, 2), year: num((j.season || {}).year, null),
      games: (j.events || []).map(parseEvent),
      byes: (wk.teamsOnBye || []).map(function (t) { return { id: str(t.id), abbr: str(t.abbreviation), name: str(t.displayName), logo: logoOf(t) }; }),
      postseason: parseCalendar(lg.calendar),
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
      raw.forEach(function (g) { groups.push({ name: str(g.position || ''), players: (g.items || []).map(player) }); });
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

  function parseSchedule(j) { return (j.events || []).map(parseEvent); }

  /** League injury report: team id -> [{ name, pos, status, detail, returnDate, comment }]. */
  function parseInjuries(j) {
    var out = {};
    (j.injuries || []).forEach(function (t) {
      var list = (t.injuries || []).map(function (i) {
        var a = i.athlete || {};
        return {
          name: str(a.displayName), pos: a.position ? str(a.position.abbreviation) : '', status: str(i.status || (i.type && i.type.description)),
          detail: i.details ? str((i.details.type || '') + (i.details.detail && i.details.detail !== 'Not Specified' ? ' (' + i.details.detail + ')' : '')) : '',
          returnDate: i.details ? str(i.details.returnDate) : '', comment: str(i.shortComment),
        };
      }).filter(function (i) { return i.name; });
      if (t.id) out[str(t.id)] = list;
    });
    return out;
  }

  /** One game in detail: scores, team stats, player stats, scoring plays. */
  function parseSummary(j) {
    var hc = (j.header && j.header.competitions && j.header.competitions[0]) || {};
    var comps = (hc.competitors || []).map(parseCompetitor);
    var home = comps.filter(function (c) { return c.homeAway === 'home'; })[0] || comps[0] || {};
    var away = comps.filter(function (c) { return c.homeAway === 'away'; })[0] || comps[1] || {};
    var type = (hc.status && hc.status.type) || {};
    var box = j.boxscore || {};
    var teamStats = (box.teams || []).map(function (t) {
      return { id: str(t.team && t.team.id), homeAway: str(t.homeAway), stats: (t.statistics || []).map(function (s) { return { name: str(s.name), label: str(s.label || s.displayName || s.name), value: str(s.displayValue) }; }) };
    });
    var players = (box.players || []).map(function (t) {
      return { id: str(t.team && t.team.id), categories: (t.statistics || []).map(function (c) {
        return { name: str(c.name), labels: (c.labels || []).map(str), athletes: (c.athletes || []).map(function (a) { return { id: str(a.athlete && a.athlete.id), name: str(a.athlete && (a.athlete.displayName || a.athlete.shortName)), stats: (a.stats || []).map(str) }; }) };
      }) };
    });
    var plays = (j.scoringPlays || []).map(function (p) {
      return { period: p.period && p.period.number ? num(p.period.number) : null, clock: p.clock ? str(p.clock.displayValue) : '', text: str(p.text), teamId: str(p.team && p.team.id), teamAbbr: str(p.team && p.team.abbreviation), home: p.homeScore, away: p.awayScore, kind: p.scoringType ? str(p.scoringType.displayName || p.scoringType.name) : '' };
    });
    return {
      id: str(j.header && j.header.id), state: str(type.state) || 'pre', detail: str(type.shortDetail || type.detail || type.description),
      home: home, away: away, date: str(hc.date), venue: j.gameInfo && j.gameInfo.venue && j.gameInfo.venue.fullName ? str(j.gameInfo.venue.fullName) : '',
      broadcasts: parseBroadcasts(hc), situation: parseSituation(j.situation || (j.drives && j.drives.current && j.drives.current.situation)),
      teamStats: teamStats, players: players, plays: plays, available: teamStats.some(function (t) { return t.stats.length; }) || plays.length > 0,
    };
  }

  /** League leaders table. wantCat is the stat category name (passing, rushing...). */
  function parseLeaders(j, wantCat) {
    var def = null;
    (j.categories || []).forEach(function (c) { if (c.name === wantCat) def = c; });
    var labels = def ? (def.labels || []) : [];
    var rows = (j.athletes || []).map(function (e) {
      var a = e.athlete || {};
      var cat = (e.categories || []).filter(function (c) { return c.name === wantCat; })[0];
      return {
        id: str(a.id), name: str(a.displayName), pos: a.position ? str(a.position.abbreviation) : '', teamId: str(a.teamId), teamAbbr: str(a.teamShortName),
        head: a.headshot && a.headshot.href ? a.headshot.href : '', values: cat ? (cat.totals || []).map(str) : [],
      };
    });
    return { labels: labels, rows: rows };
  }

  /** A player's season stats from the athlete overview feed. */
  function parseOverview(j) {
    var st = j.statistics || {};
    var splits = (st.splits || []).map(function (s) { return { name: str(s.displayName), stats: (s.stats || []).map(str) }; });
    return {
      title: str(st.displayName), labels: (st.labels || []).map(str), names: (st.displayNames || st.names || []).map(str), splits: splits,
      categories: (st.categories || []).map(function (c) { return { name: str(c.name), title: str(c.displayName || c.name), count: num(c.count) }; }),
    };
  }

  function parseAthlete(j) {
    var a = j.athlete || j;
    return {
      id: str(a.id), name: str(a.displayName || a.fullName), pos: a.position ? str(a.position.abbreviation) : '', jersey: str(a.jersey),
      team: a.team ? str(a.team.displayName) : '', teamId: a.team ? str(a.team.id) : '', age: a.age || '', height: str(a.displayHeight), weight: str(a.displayWeight),
      college: a.college && a.college.name ? str(a.college.name) : '', exp: a.displayExperience ? str(a.displayExperience) : '',
    };
  }

  /* ---------- public calls ---------- */
  var LEADER_SORT = {
    passing: ['passing', 'passing.passingYards'], rushing: ['rushing', 'rushing.rushingYards'], receiving: ['receiving', 'receiving.receivingYards'],
    sacks: ['defensive', 'defensive.sacks'], interceptions: ['defensiveInterceptions', 'defensiveInterceptions.interceptions'],
  };

  var api = {
    meta: meta,
    teams: function () { return getJSON(site('/teams').concat(site('/teams?limit=40')), { keep: true }).then(parseTeams); },
    standings: function () { return getJSON(v2('/standings'), { keep: true }).then(parseStandings); },
    /** week/seasonType optional; year lets you ask for a past season; fresh skips the cache (for live games). */
    scoreboard: function (week, seasonType, year, fresh) {
      var q = [];
      if (year) q.push('dates=' + year);
      if (week) q.push('week=' + week);
      if (week || seasonType) q.push('seasontype=' + (seasonType || 2));
      var path = '/scoreboard' + (q.length ? '?' + q.join('&') : '');
      return getJSON(site(path), { ttl: fresh ? 0 : 60 * 1000, keep: !week && !year }).then(parseScoreboard);
    },
    roster: function (id) { return getJSON(site('/teams/' + encodeURIComponent(id) + '/roster')).then(parseRoster); },
    teamStats: function (id) { return getJSON(site('/teams/' + encodeURIComponent(id) + '/statistics')).then(parseStats); },
    schedule: function (id) { return getJSON(site('/teams/' + encodeURIComponent(id) + '/schedule')).then(parseSchedule); },
    injuries: function () { return getJSON(site('/injuries'), { keep: true }).then(parseInjuries); },
    summary: function (id, fresh) { return getJSON(site('/summary?event=' + encodeURIComponent(id)), { ttl: fresh ? 0 : 60 * 1000 }).then(parseSummary); },
    leaders: function (kind, year) {
      var spec = LEADER_SORT[kind] || LEADER_SORT.passing;
      var path = '/statistics/byathlete?region=us&lang=en&contentorigin=espn&isqualified=true&page=1&limit=15&sort=' + encodeURIComponent(spec[1] + ':desc') + '&season=' + (year || '') + '&seasontype=2';
      return getJSON([C3 + path], { ttl: TTL_MS }).then(function (j) { return parseLeaders(j, spec[0]); });
    },
    overview: function (id) { return getJSON([C3 + '/athletes/' + encodeURIComponent(id) + '/overview']).then(parseOverview); },
    athlete: function (id) { return getJSON([C3 + '/athletes/' + encodeURIComponent(id)]).then(parseAthlete); },
    /**
     * Last season's average scoring margin per team, built from its 18 weekly scoreboards.
     * Saved in the browser for good, since a finished season never changes.
     */
    priorSeason: function (year) {
      var key = 'glprior:' + year, saved = stored(key);
      if (saved && saved.mov) return Promise.resolve(saved.mov);
      var weeks = []; for (var w = 1; w <= 18; w++) weeks.push(w);
      return Promise.all(weeks.map(function (w) { return api.scoreboard(w, 2, year).catch(function () { return null; }); })).then(function (all) {
        var rec = {}, games = 0;
        all.forEach(function (sb) {
          if (!sb) return;
          sb.games.forEach(function (g) {
            if (g.state !== 'post' || g.home.score === null || g.away.score === null) return;
            games++;
            [[g.home, g.away], [g.away, g.home]].forEach(function (p) {
              var r = rec[p[0].id] || (rec[p[0].id] = { d: 0, n: 0 });
              r.d += p[0].score - p[1].score; r.n += 1;
            });
          });
        });
        if (games < 100) throw new Error('last season not available');
        var mov = {};
        Object.keys(rec).forEach(function (id) { mov[id] = rec[id].d / rec[id].n; });
        store(key, { mov: mov });
        return mov;
      });
    },
    probe: function () {
      var list = site('/scoreboard').concat(site('/teams'), site('/injuries'), v2('/standings'), [C3 + '/statistics/byathlete?region=us&lang=en&contentorigin=espn&limit=1&sort=passing.passingYards%3Adesc', C3 + '/athletes/3139477/overview']);
      return Promise.all(list.map(function (u) {
        return fetch(u).then(function (r) { return { url: u, ok: r.ok, note: 'HTTP ' + r.status }; }).catch(function (e) { return { url: u, ok: false, note: (e && e.message) || 'blocked' }; });
      }));
    },
    // exposed for tests
    _parse: { broadcasts: parseBroadcasts, situation: parseSituation, teams: parseTeams, standings: parseStandings, scoreboard: parseScoreboard, roster: parseRoster, stats: parseStats, schedule: parseSchedule, injuries: parseInjuries, summary: parseSummary, leaders: parseLeaders, overview: parseOverview, athlete: parseAthlete, calendar: parseCalendar },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Api = api;
})(typeof self !== 'undefined' ? self : this);
