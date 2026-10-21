/* Gridline NFL: routing and rendering. Plain JavaScript, no build step. */
(function () {
  'use strict';
  var Api = window.Api, Model = window.Model;
  var view = document.getElementById('view');
  var state = { teams: null, standings: null, ratings: null, current: null, power: null };

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function lum(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 0;
    var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  function visible(team) {
    var c = team && team.color, a = team && team.alt;
    if (c && lum(c) > 0.2) return c;
    if (a && lum(a) > 0.2) return a;
    return '#7aa2ff';
  }
  function loading(msg) { view.innerHTML = '<div class="state"><div class="spin" aria-hidden="true"></div><p>' + esc(msg || 'Loading…') + '</p></div>'; }
  function failed(err, retry) {
    view.innerHTML = '<div class="state error"><h2>Could not load the data</h2><p>' + esc(err && err.message ? err.message : err) +
      '</p><p class="muted">The numbers come live from ESPN. If you are offline or their service is down, try again in a minute.</p><button class="btn" id="retry">Try again</button></div>';
    $('#retry').onclick = retry;
  }
  function dayLabel(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function timeLabel(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function fmt1(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function signed(n) { var v = Math.round(n * 10) / 10; return (v > 0 ? '+' : '') + v.toFixed(1); }

  /* ---------- shared data ---------- */
  function ensureBase() {
    if (state.standings && state.teams) return Promise.resolve();
    // The team list only adds colors, so the site still works if it cannot be loaded.
    return Promise.all([Api.standings(), Api.teams().catch(function () { return {}; })]).then(function (r) {
      state.standings = r[0]; state.teams = r[1];
      Object.keys(state.standings).forEach(function (id) {
        if (!state.teams[id]) { var s = state.standings[id]; state.teams[id] = { id: id, name: s.name, short: s.short, abbr: s.abbr, logo: s.logo, color: '', alt: '' }; }
      });
      var ratings = {};
      Object.keys(state.standings).forEach(function (id) { ratings[id] = Model.rating(state.standings[id]); });
      state.ratings = ratings;
      state.power = Object.keys(ratings).sort(function (a, b) { return ratings[b].rating - ratings[a].rating; });
    });
  }
  function teamInfo(id) {
    var s = state.standings[id] || {}, t = state.teams[id] || {};
    return { id: id, name: s.name || t.name || '', short: s.short || t.short || '', abbr: s.abbr || t.abbr || '', logo: s.logo || t.logo || '', color: t.color || '', alt: t.alt || '' };
  }
  function ratingOf(id) { return state.ratings && state.ratings[id] ? state.ratings[id].rating : 0; }
  function chance(game) {
    return Model.winProb(ratingOf(game.home.id), ratingOf(game.away.id), game.neutral);
  }

  /* ---------- components ---------- */
  function logo(team, cls) {
    return team.logo ? '<img class="logo ' + (cls || '') + '" src="' + esc(team.logo) + '" alt="" loading="lazy" width="40" height="40" onerror="this.style.visibility=\'hidden\'">' : '<span class="logo ph ' + (cls || '') + '"></span>';
  }

  function gameCard(g) {
    var h = g.home, a = g.away;
    var ti = { h: teamInfo(h.id), a: teamInfo(a.id) };
    var p = chance(g);
    var done = g.state === 'post', live = g.state === 'in';
    var status = done ? 'Final' : live ? ('Live · ' + (g.detail || 'In progress')) : dayLabel(g.date) + ' · ' + timeLabel(g.date);
    var ph = Model.pct(p.home), pa = Model.pct(p.away);
    var favHome = p.home >= 0.5;
    var cH = visible(ti.h), cA = visible(ti.a);
    function row(t, side, c) {
      var sc = side.score === null ? '' : side.score;
      var win = done && side.winner;
      return '<a class="g-team' + (win ? ' win' : '') + '" href="#/team/' + esc(side.id) + '">' + logo(t) +
        '<span class="g-name"><b>' + esc(t.short || side.short) + '</b><small>' + esc(side.record) + '</small></span>' +
        '<span class="g-score">' + esc(sc) + '</span></a>';
    }
    var bar = '<div class="odds" role="img" aria-label="' + esc(a.abbr + ' ' + pa + ', ' + h.abbr + ' ' + ph) + ' win chance">' +
      '<div class="odds-bar"><span style="width:' + (p.away * 100).toFixed(1) + '%;background:' + cA + '"></span><span style="width:' + (p.home * 100).toFixed(1) + '%;background:' + cH + '"></span></div>' +
      '<div class="odds-txt"><span class="' + (!favHome ? 'fav' : '') + '">' + esc(a.abbr) + ' ' + pa + '</span>' +
      '<span class="muted">' + esc(Model.spreadText(p.spread, h.abbr, a.abbr)) + (done ? ' · pregame' : '') + '</span>' +
      '<span class="' + (favHome ? 'fav' : '') + '">' + ph + ' ' + esc(h.abbr) + '</span></div></div>';
    return '<article class="game' + (live ? ' live' : '') + '"><div class="g-head"><span>' + esc(status) + '</span>' + (g.venue ? '<span class="muted">' + esc(g.venue) + '</span>' : '') + '</div>' +
      row(ti.a, a, cA) + row(ti.h, h, cH) + bar + '</article>';
  }

  function weekTabs(cur, active) {
    var out = '<nav class="weeks" aria-label="Week">';
    for (var w = 1; w <= 18; w++) {
      out += '<a href="#/schedule/' + w + '" class="' + (w === active ? 'on' : '') + (w === cur ? ' now' : '') + '"' + (w === active ? ' aria-current="page"' : '') + '>' + w + '</a>';
    }
    return out + '</nav>';
  }

  /* ---------- pages ---------- */
  function pageHome() {
    loading('Loading this week…');
    Promise.all([ensureBase(), Api.scoreboard()]).then(function (r) {
      var sb = r[1];
      state.current = sb.week;
      var top = state.power.slice(0, 8);
      view.innerHTML = '<header class="page-h"><h1>' + (sb.seasonType === 2 ? 'Week ' + esc(sb.week) : 'This week') + ' <span class="muted">· ' + esc(sb.year || '') + ' season</span></h1>' +
        '<p class="lede">Every game, with each team\'s chance to win from the <a href="#/model">Gridline model</a>.</p></header>' +
        '<div class="split"><section><div class="cards">' + (sb.games.length ? sb.games.map(gameCard).join('') : '<p class="muted">No games listed for this week.</p>') + '</div>' +
        (sb.byes.length ? '<p class="byes"><b>Bye:</b> ' + sb.byes.map(function (t) { return esc(t.abbr); }).join(', ') + '</p>' : '') + '</section>' +
        '<aside class="panel"><h2>Power rankings</h2><ol class="power">' + top.map(function (id, i) {
          var t = teamInfo(id), s = state.standings[id];
          return '<li><a href="#/team/' + esc(id) + '">' + logo(t, 'sm') + '<span class="pn">' + esc(t.name) + '</span><span class="pr">' + esc(s.overall || (s.w + '-' + s.l)) + '</span><span class="pv">' + signed(ratingOf(id)) + '</span></a></li>';
        }).join('') + '</ol><p class="muted small">Strength is points above an average team. <a href="#/standings">Full table</a></p></aside></div>';
    }).catch(function (e) { failed(e, pageHome); });
  }

  function pageSchedule(week) {
    loading('Loading schedule…');
    ensureBase().then(function () { return Api.scoreboard(); }).then(function (cur) {
      var curWeek = cur.seasonType === 2 ? cur.week : null;
      var w = week || curWeek || 1;
      return (w === cur.week && cur.seasonType === 2 ? Promise.resolve(cur) : Api.scoreboard(w, 2)).then(function (sb) {
        view.innerHTML = '<header class="page-h"><h1>Schedule</h1><p class="lede">Pick a week. Win chances are the model\'s pregame numbers.</p></header>' + weekTabs(curWeek, w) +
          '<h2 class="sub">Week ' + w + '</h2><div class="cards">' + (sb.games.length ? sb.games.map(gameCard).join('') : '<p class="muted">No games listed for this week.</p>') + '</div>' +
          (sb.byes.length ? '<p class="byes"><b>Bye:</b> ' + sb.byes.map(function (t) { return esc(t.abbr); }).join(', ') + '</p>' : '');
      });
    }).catch(function (e) { failed(e, function () { pageSchedule(week); }); });
  }

  function pageStandings() {
    loading('Loading standings…');
    ensureBase().then(function () {
      var ids = Object.keys(state.standings);
      var rank = {}; state.power.forEach(function (id, i) { rank[id] = i + 1; });
      function table(conf) {
        var rows = ids.filter(function (id) { return state.standings[id].conf === conf; }).sort(function (a, b) {
          var A = state.standings[a], B = state.standings[b];
          return (A.seed - B.seed) || (B.pct - A.pct) || (B.diff - A.diff);
        });
        return '<section class="panel table-wrap"><h2>' + esc(conf) + '</h2><div class="scroll"><table class="data"><thead><tr><th>Team</th><th>W</th><th>L</th><th>T</th><th>PCT</th><th>PF</th><th>PA</th><th>Diff</th><th>Strk</th><th title="Model strength, points above average">Power</th></tr></thead><tbody>' +
          rows.map(function (id) {
            var s = state.standings[id], t = teamInfo(id);
            return '<tr><td><a class="tcell" href="#/team/' + esc(id) + '">' + logo(t, 'sm') + '<span>' + esc(t.name) + '</span></a></td><td>' + s.w + '</td><td>' + s.l + '</td><td>' + s.t + '</td><td>' + esc(s.pct) + '</td><td>' + s.pf + '</td><td>' + s.pa + '</td><td class="' + (s.diff >= 0 ? 'pos' : 'neg') + '">' + (s.diff > 0 ? '+' : '') + s.diff + '</td><td>' + esc(s.streak) + '</td><td>' + signed(ratingOf(id)) + ' <small class="muted">#' + rank[id] + '</small></td></tr>';
          }).join('') + '</tbody></table></div></section>';
      }
      view.innerHTML = '<header class="page-h"><h1>Standings</h1><p class="lede">Ordered by playoff seed. Power is the model\'s strength number and the rank in brackets is out of ' + ids.length + '.</p></header><div class="stack">' + table('AFC') + table('NFC') + '</div>';
    }).catch(function (e) { failed(e, pageStandings); });
  }

  function pageTeams() {
    loading('Loading teams…');
    ensureBase().then(function () {
      var ids = Object.keys(state.teams).sort(function (a, b) { return state.teams[a].name.localeCompare(state.teams[b].name); });
      view.innerHTML = '<header class="page-h"><h1>Teams</h1><p class="lede">Choose a team for its schedule, stats and roster.</p></header><div class="tgrid">' + ids.map(function (id) {
        var t = teamInfo(id), s = state.standings[id];
        return '<a class="tcard" href="#/team/' + esc(id) + '" style="--tc:' + esc(visible(t)) + '">' + logo(t, 'lg') + '<b>' + esc(t.name) + '</b><small>' + esc(s ? (s.overall || s.w + '-' + s.l) : '') + '</small></a>';
      }).join('') + '</div>';
    }).catch(function (e) { failed(e, pageTeams); });
  }

  function pageTeam(id, tab) {
    loading('Loading team…');
    ensureBase().then(function () {
      var t = teamInfo(id), s = state.standings[id];
      if (!s && !state.teams[id]) { view.innerHTML = '<div class="state"><h2>Team not found</h2><p><a href="#/teams">Back to teams</a></p></div>'; return; }
      s = s || { w: 0, l: 0, t: 0, pf: 0, pa: 0, overall: '', conf: '', home: '', road: '', streak: '', diff: 0 };
      var r = state.ratings[id] || { rating: 0, gp: 0, mov: 0 };
      var color = visible(t);
      var tabs = ['overview', 'stats', 'roster'];
      tab = tabs.indexOf(tab) >= 0 ? tab : 'overview';
      var head = '<header class="team-h" style="--tc:' + esc(color) + '">' + logo(t, 'xl') + '<div><h1>' + esc(t.name) + '</h1><p class="muted">' + esc(s.conf) + (s.overall ? ' · ' + esc(s.overall) : '') + (s.streak ? ' · ' + esc(s.streak) : '') + '</p></div>' +
        '<div class="kpis"><div><b>' + signed(r.rating) + '</b><small>Strength</small></div><div><b>#' + (state.power.indexOf(id) + 1) + '</b><small>Power rank</small></div><div><b>' + fmt1(r.gp ? s.pf / r.gp : 0) + '</b><small>Pts for / g</small></div><div><b>' + fmt1(r.gp ? s.pa / r.gp : 0) + '</b><small>Pts against / g</small></div></div></header>' +
        '<nav class="tabs" role="tablist">' + tabs.map(function (k) { return '<a href="#/team/' + esc(id) + '/' + k + '" class="' + (k === tab ? 'on' : '') + '" role="tab" aria-selected="' + (k === tab) + '">' + k[0].toUpperCase() + k.slice(1) + '</a>'; }).join('') + '</nav>';
      view.innerHTML = head + '<div id="tab"></div>';
      var box = $('#tab');
      box.innerHTML = '<div class="state"><div class="spin" aria-hidden="true"></div></div>';
      if (tab === 'overview') teamOverview(id, s, box);
      else if (tab === 'stats') teamStats(id, box);
      else teamRoster(id, box);
    }).catch(function (e) { failed(e, function () { pageTeam(id, tab); }); });
  }

  function teamOverview(id, s, box) {
    Api.schedule(id).then(function (events) {
      var future = [];
      var rows = events.map(function (g) {
        var me = g.home.id === id ? g.home : g.away, op = g.home.id === id ? g.away : g.home;
        var isHome = g.home.id === id;
        var oi = teamInfo(op.id), done = g.state === 'post';
        var p = Model.winProb(ratingOf(g.home.id), ratingOf(g.away.id), g.neutral);
        var mine = isHome ? p.home : p.away;
        if (!done) future.push(mine);
        var res = '';
        if (done) res = '<span class="' + (me.winner ? 'pos' : (op.winner ? 'neg' : '')) + '">' + (me.winner ? 'W' : op.winner ? 'L' : 'T') + ' ' + esc(me.score) + '-' + esc(op.score) + '</span>';
        else res = '<span class="chip">' + Model.pct(mine) + '</span>';
        return '<tr><td>' + (g.week || '') + '</td><td>' + esc(dayLabel(g.date)) + '</td><td><a class="tcell" href="#/team/' + esc(op.id) + '">' + (isHome ? 'vs' : '@') + ' ' + logo(oi, 'sm') + '<span>' + esc(oi.name || op.name) + '</span></a></td><td>' + res + '</td></tr>';
      });
      var proj = Model.projectRecord(s, future);
      box.innerHTML = '<div class="split2"><section class="panel"><h2>Season schedule</h2><div class="scroll"><table class="data"><thead><tr><th>Wk</th><th>Date</th><th>Opponent</th><th>Result / win chance</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div></section>' +
        '<aside class="panel"><h2>Projected finish</h2><p class="big">' + fmt1(proj.wins) + ' – ' + fmt1(proj.losses) + '</p><p class="muted small">Current record plus the model\'s win chance in each of the ' + proj.remaining + ' games left. It is an expected value, so it will not be a whole number.</p>' +
        '<dl class="facts"><dt>Home</dt><dd>' + esc(s.home || '–') + '</dd><dt>Road</dt><dd>' + esc(s.road || '–') + '</dd><dt>Point diff</dt><dd>' + (s.diff > 0 ? '+' : '') + s.diff + '</dd></dl></aside></div>';
    }).catch(function (e) { box.innerHTML = '<p class="muted">Schedule unavailable: ' + esc(e.message) + '</p>'; });
  }

  var STAT_PICK = [
    ['Points per game', 'scoring', 'totalPointsPerGame'], ['Pass yards / g', 'passing', 'passingYardsPerGame'],
    ['Rush yards / g', 'rushing', 'rushingYardsPerGame'], ['Total yards / g', 'passing', 'yardsPerGame'],
  ];
  function findStat(cats, cat, name) {
    for (var i = 0; i < cats.length; i++) if (cats[i].name === cat) for (var j = 0; j < cats[i].stats.length; j++) if (cats[i].stats[j].name === name) return cats[i].stats[j];
    return null;
  }
  function teamStats(id, box) {
    Api.teamStats(id).then(function (st) {
      if (!st.team.length) { box.innerHTML = '<p class="muted">No stats are available for this team yet.</p>'; return; }
      var tiles = STAT_PICK.map(function (p) {
        var s = findStat(st.team, p[1], p[2]);
        return s ? '<div class="tile"><b>' + esc(s.shown || fmt1(s.value)) + '</b><small>' + esc(p[0]) + '</small></div>' : '';
      }).join('');
      var allowed = findStat(st.opponent, 'scoring', 'totalPointsPerGame');
      if (allowed) tiles += '<div class="tile"><b>' + esc(allowed.shown) + '</b><small>Points allowed / g' + (allowed.rankText ? ' · ' + esc(allowed.rankText) : '') + '</small></div>';
      function catTable(c) {
        return '<details class="panel cat"><summary>' + esc(c.title) + '</summary><table class="data"><tbody>' + c.stats.map(function (s) {
          return '<tr><td>' + esc(s.title) + '</td><td>' + esc(s.shown) + (s.perGame ? ' <small class="muted">(' + esc(s.perGame) + ' / g)</small>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></details>';
      }
      box.innerHTML = '<div class="tiles">' + tiles + '</div><h2 class="sub">Team stats</h2><div class="cats">' + st.team.map(catTable).join('') + '</div>' +
        (st.opponent.length ? '<h2 class="sub">What opponents did against them</h2><div class="cats">' + st.opponent.map(function (c) {
          return '<details class="panel cat"><summary>' + esc(c.title) + '</summary><table class="data"><tbody>' + c.stats.map(function (s) {
            return '<tr><td>' + esc(s.title) + '</td><td>' + esc(s.shown) + (s.rankText ? ' <small class="muted">' + esc(s.rankText) + '</small>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></details>';
        }).join('') + '</div>' : '');
    }).catch(function (e) { box.innerHTML = '<p class="muted">Stats unavailable: ' + esc(e.message) + '</p>'; });
  }

  function teamRoster(id, box) {
    Api.roster(id).then(function (ro) {
      var all = [];
      ro.groups.forEach(function (g) { g.players.forEach(function (p) { p.group = g.name; all.push(p); }); });
      if (!all.length) { box.innerHTML = '<p class="muted">No roster is available for this team yet.</p>'; return; }
      var groups = ro.groups.map(function (g) { return g.name; }).filter(Boolean);
      var cur = { q: '', g: '' };
      box.innerHTML = '<div class="toolbar"><input id="rq" type="search" placeholder="Search players" aria-label="Search players"><div class="chips" id="rg"><button class="chip on" data-g="">All</button>' +
        groups.map(function (g) { return '<button class="chip" data-g="' + esc(g) + '">' + esc(g.replace(/([A-Z])/g, ' $1').replace(/^./, function (c) { return c.toUpperCase(); })) + '</button>'; }).join('') + '</div></div>' +
        (ro.coach ? '<p class="muted small">Head coach: ' + esc(ro.coach) + '</p>' : '') + '<div class="panel"><div class="scroll"><table class="data roster"><thead><tr><th>#</th><th>Player</th><th>Pos</th><th>Age</th><th>Ht</th><th>Wt</th><th>Exp</th><th>College</th><th>Status</th></tr></thead><tbody id="rb"></tbody></table></div></div>';
      function draw() {
        var q = cur.q.toLowerCase();
        var rows = all.filter(function (p) { return (!cur.g || p.group === cur.g) && (!q || (p.name + ' ' + p.pos + ' ' + p.college).toLowerCase().indexOf(q) >= 0); })
          .sort(function (a, b) { return (parseInt(a.jersey, 10) || 999) - (parseInt(b.jersey, 10) || 999); });
        $('#rb').innerHTML = rows.length ? rows.map(function (p) {
          var badge = p.injury ? '<span class="badge warn">' + esc(p.injury) + '</span>' : (p.status && p.status !== 'Active' ? '<span class="badge">' + esc(p.status) + '</span>' : '<span class="muted">Active</span>');
          return '<tr><td>' + esc(p.jersey) + '</td><td><span class="tcell">' + (p.head ? '<img class="head" src="' + esc(p.head) + '" alt="" loading="lazy" width="32" height="32">' : '<span class="head ph"></span>') + '<span>' + esc(p.name) + '</span></span></td><td>' + esc(p.pos) + '</td><td>' + esc(p.age) + '</td><td>' + esc(p.height) + '</td><td>' + esc(p.weight) + '</td><td>' + esc(p.exp === 0 ? 'R' : p.exp) + '</td><td>' + esc(p.college) + '</td><td>' + badge + '</td></tr>';
        }).join('') : '<tr><td colspan="9" class="muted">No players match.</td></tr>';
      }
      $('#rq').oninput = function (e) { cur.q = e.target.value; draw(); };
      $('#rg').onclick = function (e) {
        var b = e.target.closest('button'); if (!b) return;
        cur.g = b.getAttribute('data-g'); [].forEach.call(this.children, function (c) { c.classList.toggle('on', c === b); }); draw();
      };
      draw();
    }).catch(function (e) { box.innerHTML = '<p class="muted">Roster unavailable: ' + esc(e.message) + '</p>'; });
  }

  function pageModel() {
    view.innerHTML = '<header class="page-h"><h1>How the win chances work</h1></header><div class="prose">' +
      '<p>Each team gets a <b>strength</b> number: its average scoring margin per game, in points, pulled toward zero while it has only played a few games. A team at +6.0 would be expected to beat an average team by about six points on a neutral field.</p>' +
      '<p>For a game, the expected margin is the home team\'s strength minus the away team\'s, plus <b>' + Model.HOME_FIELD + ' points</b> for home field. NFL results land around that number with a typical miss of about <b>' + Model.SIGMA + ' points</b>, so the chance of winning is the normal curve of (expected margin ÷ ' + Model.SIGMA + ').</p>' +
      '<p>To keep early-season numbers sensible, every team starts with <b>' + Model.PRIOR_GAMES + ' games</b> of average results: strength = margin per game × games ÷ (games + ' + Model.PRIOR_GAMES + ').</p>' +
      '<h2 class="sub">What it leaves out</h2><p>Injuries, weather, rest, quarterback changes and last season. It only knows scores so far, so treat it as a quick read, not a betting tool. A 70% favorite still loses three times in ten.</p>' +
      '<h2 class="sub">Where the data comes from</h2><p>Live from ESPN\'s public NFL endpoints, fetched by your browser and cached for five minutes. They are unofficial and can change without notice.</p></div>';
  }

  function pageDebug() {
    loading('Testing connections to ESPN…');
    Api.probe().then(function (rows) {
      view.innerHTML = '<header class="page-h"><h1>Connection test</h1><p class="lede">Each line is a feed this site needs. If every line fails, your browser or network is blocking ESPN.</p></header><div class="panel"><table class="data"><tbody>' +
        rows.map(function (r) { return '<tr><td>' + (r.ok ? '<span class="pos">OK</span>' : '<span class="neg">Failed</span>') + '</td><td>' + esc(r.note) + '</td><td style="white-space:normal;word-break:break-all">' + esc(r.url) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    });
  }

  /* ---------- router ---------- */
  var routes = [
    [/^\/?$/, function () { pageHome(); }, 'home'],
    [/^\/schedule(?:\/(\d+))?$/, function (m) { pageSchedule(m[1] ? parseInt(m[1], 10) : null); }, 'schedule'],
    [/^\/standings$/, function () { pageStandings(); }, 'standings'],
    [/^\/teams$/, function () { pageTeams(); }, 'teams'],
    [/^\/team\/(\d+)(?:\/(\w+))?$/, function (m) { pageTeam(m[1], m[2]); }, 'teams'],
    [/^\/model$/, function () { pageModel(); }, 'model'],
    [/^\/debug$/, function () { pageDebug(); }, ''],
  ];
  function route() {
    var path = location.hash.replace(/^#/, '') || '/';
    for (var i = 0; i < routes.length; i++) {
      var m = routes[i][0].exec(path);
      if (m) {
        [].forEach.call(document.querySelectorAll('[data-nav]'), function (a) { var on = a.getAttribute('data-nav') === routes[i][2]; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
        window.scrollTo(0, 0);
        routes[i][1](m);
        return;
      }
    }
    view.innerHTML = '<div class="state"><h2>Page not found</h2><p><a href="#/">Back home</a></p></div>';
  }
  window.addEventListener('hashchange', route);
  route();
})();
