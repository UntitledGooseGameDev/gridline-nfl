/* Gridline pages, part 1: this week, schedule, standings, teams, team detail, the model. */
(function () {
  'use strict';
  var Api = window.Api, Model = window.Model, GL = window.GL;
  var S = GL.state, esc = GL.esc, $ = GL.$, P = GL.pages;
  GL.players = {};

  function roundLabel(sb) {
    if (sb.seasonType === 3) {
      var r = (S.postseason || []).filter(function (p) { return p.week === sb.week; })[0];
      return r ? r.label : 'Playoffs';
    }
    return sb.week ? 'Week ' + sb.week : 'This week';
  }
  function byes(sb) { return sb.byes && sb.byes.length ? '<p class="byes"><b>Bye:</b> ' + sb.byes.map(function (t) { return esc(t.abbr); }).join(', ') + '</p>' : ''; }
  function cardsHtml(sb) {
    GL.remember(sb.games, sb.seasonType);
    return sb.games.length ? sb.games.map(function (g) { return GL.gameCard(g); }).join('') : GL.empty('No games listed for this round yet.', 'Schedules appear here as soon as ESPN publishes them.');
  }
  function livePulse(sb) { return sb.games.some(function (g) { return g.state === 'in'; }); }

  /* ---------- this week ---------- */
  P.home = function () {
    GL.loading('Loading this week…');
    GL.ensureBase().then(function () { return Api.scoreboard(); }).then(function (sb) {
      S.curWeek = sb.week; S.curType = sb.seasonType;
      var top = S.power.slice(0, 8);
      var fav = GL.fav();
      GL.view.innerHTML = '<header class="page-h"><div class="h-row"><h1>' + esc(roundLabel(sb)) + ' <span class="muted">· ' + esc(sb.year || S.year || '') + ' season</span></h1>' + GL.shareButton('Gridline: ' + roundLabel(sb)) + '</div>' +
        '<p class="lede">Every game, with each team\'s chance to win from the <a href="#/model">Gridline model</a>. <span id="livedot" class="livedot" hidden>Updating live</span></p></header>' +
        '<div id="favbox"></div><div class="split"><section><div class="cards" id="cards">' + cardsHtml(sb) + '</div><div id="byes">' + byes(sb) + '</div></section>' +
        '<aside class="panel"><h2>Power rankings</h2><ol class="power">' + top.map(function (id) {
          var t = GL.teamInfo(id), s = S.standings[id];
          return '<li><a href="#/team/' + esc(id) + '">' + GL.logo(t, 'sm') + '<span class="pn">' + esc(t.name) + '</span><span class="pr">' + esc(s.overall || (s.w + '-' + s.l)) + '</span><span class="pv">' + GL.signed(GL.ratingOf(id)) + '</span></a></li>';
        }).join('') + '</ol><p class="muted small">Strength is points above an average team. <a href="#/standings">Full table</a></p></aside></div>';
      function favCard(sb2) {
        var box = $('#favbox'); if (!box) return;
        if (!fav || !S.standings[fav]) { box.innerHTML = ''; return; }
        var t = GL.teamInfo(fav), s = S.standings[fav];
        var g = sb2.games.filter(function (x) { return x.home.id === fav || x.away.id === fav; })[0];
        box.innerHTML = '<section class="panel mine-panel" style="--tc:' + esc(GL.visible(t)) + '"><div class="h-row"><h2>★ ' + esc(t.name) + '</h2><a class="muted" href="#/team/' + esc(fav) + '">Team page ›</a></div>' +
          '<p class="muted">' + esc(s.overall) + (s.streak ? ' · ' + esc(s.streak) : '') + ' · power rank #' + (S.power.indexOf(fav) + 1) + '</p>' +
          (g ? '<div class="cards one">' + GL.gameCard(g) + '</div>' : '<p class="muted">No game this week. Bye week or not yet scheduled.</p>') + '</section>';
      }
      favCard(sb);
      function pulse(sb2) { var d = $('#livedot'); if (d) d.hidden = !livePulse(sb2); }
      pulse(sb);
      GL.banner();
      if (livePulse(sb)) {
        GL.every(30000, function () {
          Api.scoreboard(null, null, null, true).then(function (n) {
            var c = $('#cards'); if (!c) return;
            c.innerHTML = cardsHtml(n); favCard(n); pulse(n); GL.banner();
          }).catch(function () { /* try again next time */ });
        });
      }
    }).catch(function (e) { GL.failed(e, P.home); });
  };

  /* ---------- schedule ---------- */
  P.schedule = function (type, week) {
    GL.loading('Loading schedule…');
    GL.ensureBase().then(function () {
      var curType = S.curType, curWeek = S.curWeek;
      type = type || (curType === 3 ? 3 : 2);
      week = week || (type === curType ? curWeek : 1) || 1;
      var isCur = type === curType && week === curWeek;
      return (isCur ? Api.scoreboard() : Api.scoreboard(week, type)).then(function (sb) {
        var title = type === 3 ? ((S.postseason.filter(function (p) { return p.week === week; })[0] || {}).label || 'Playoffs') : 'Week ' + week;
        GL.view.innerHTML = '<header class="page-h"><div class="h-row"><h1>Schedule</h1>' + GL.shareButton('Gridline schedule: ' + title) + '</div><p class="lede">Pick a week. Win chances are the model\'s numbers going into each game. Playoff rounds are the tabs at the end.</p></header>' + GL.weekTabs(type, week) +
          '<h2 class="sub">' + esc(title) + '</h2><div class="cards" id="cards">' + cardsHtml(sb) + '</div>' + byes(sb);
        GL.banner();
        if (livePulse(sb)) GL.every(30000, function () {
          Api.scoreboard(isCur ? null : week, isCur ? null : type, null, true).then(function (n) { var c = $('#cards'); if (c) c.innerHTML = cardsHtml(n); GL.banner(); }).catch(function () {});
        });
      });
    }).catch(function (e) { GL.failed(e, function () { P.schedule(type, week); }); });
  };

  /* ---------- standings ---------- */
  P.standings = function () {
    GL.loading('Loading standings…');
    GL.ensureBase().then(function () {
      var ids = Object.keys(S.standings);
      var rank = {}; S.power.forEach(function (id, i) { rank[id] = i + 1; });
      function table(conf) {
        var rows = ids.filter(function (id) { return S.standings[id].conf === conf; }).sort(function (a, b) {
          var A = S.standings[a], B = S.standings[b];
          return (A.seed - B.seed) || (B.pct - A.pct) || (B.diff - A.diff);
        });
        return '<section class="panel table-wrap"><h2>' + esc(conf) + '</h2><div class="scroll"><table class="data"><thead><tr><th>Team</th><th>W</th><th>L</th><th>T</th><th>PCT</th><th>PF</th><th>PA</th><th>Diff</th><th>Strk</th><th title="Model strength, points above average">Power</th></tr></thead><tbody>' +
          rows.map(function (id) {
            var s = S.standings[id], t = GL.teamInfo(id);
            return '<tr><td><a class="tcell" href="#/team/' + esc(id) + '">' + GL.logo(t, 'sm') + '<span>' + esc(t.name) + (GL.fav() === id ? ' <span class="star">★</span>' : '') + '</span></a></td><td>' + s.w + '</td><td>' + s.l + '</td><td>' + s.t + '</td><td>' + esc(s.pct) + '</td><td>' + s.pf + '</td><td>' + s.pa + '</td><td class="' + (s.diff >= 0 ? 'pos' : 'neg') + '">' + (s.diff > 0 ? '+' : '') + s.diff + '</td><td>' + esc(s.streak) + '</td><td>' + GL.signed(GL.ratingOf(id)) + ' <small class="muted">#' + rank[id] + '</small></td></tr>';
          }).join('') + '</tbody></table></div></section>';
      }
      GL.view.innerHTML = '<header class="page-h"><h1>Standings</h1><p class="lede">Ordered by playoff seed. Power is the model\'s strength number and the rank in brackets is out of ' + ids.length + '. For playoff chances see <a href="#/playoffs">Playoffs</a>.</p></header><div class="stack">' + table('AFC') + table('NFC') + '</div>';
      GL.banner();
    }).catch(function (e) { GL.failed(e, P.standings); });
  };

  /* ---------- teams ---------- */
  P.teams = function () {
    GL.loading('Loading teams…');
    GL.ensureBase().then(function () {
      var ids = Object.keys(S.teams).sort(function (a, b) { return S.teams[a].name.localeCompare(S.teams[b].name); });
      GL.view.innerHTML = '<header class="page-h"><h1>Teams</h1><p class="lede">Choose a team for its schedule, stats and roster. Tap the star on a team page to make it yours.</p></header><div class="tgrid">' + ids.map(function (id) {
        var t = GL.teamInfo(id), s = S.standings[id];
        return '<a class="tcard" href="#/team/' + esc(id) + '" style="--tc:' + esc(GL.visible(t)) + '">' + GL.logo(t, 'lg') + '<b>' + esc(t.name) + (GL.fav() === id ? ' <span class="star">★</span>' : '') + '</b><small>' + esc(s ? (s.overall || s.w + '-' + s.l) : '') + '</small></a>';
      }).join('') + '</div>';
      GL.banner();
    }).catch(function (e) { GL.failed(e, P.teams); });
  };

  /* ---------- one team ---------- */
  P.team = function (id, tab) {
    GL.loading('Loading team…');
    GL.ensureBase().then(function () {
      var t = GL.teamInfo(id), s = S.standings[id];
      if (!s && !S.teams[id]) { GL.view.innerHTML = '<div class="state"><h2>Team not found</h2><p><a href="#/teams">Back to teams</a></p></div>'; return; }
      s = s || { w: 0, l: 0, t: 0, pf: 0, pa: 0, overall: '', conf: '', home: '', road: '', streak: '', diff: 0 };
      var r = S.ratings[id] || { rating: 0, gp: 0, mov: 0 };
      var color = GL.visible(t);
      var tabs = ['overview', 'stats', 'roster'];
      tab = tabs.indexOf(tab) >= 0 ? tab : 'overview';
      var isFav = GL.fav() === id;
      var inj = GL.injuryDrag(id);
      GL.view.innerHTML = '<header class="team-h" style="--tc:' + esc(color) + '">' + GL.logo(t, 'xl') + '<div><h1>' + esc(t.name) + '</h1><p class="muted">' + esc(s.conf) + (s.overall ? ' · ' + esc(s.overall) : '') + (s.streak ? ' · ' + esc(s.streak) : '') + '</p>' +
        '<div class="actions"><button class="btn ghost" id="favbtn" aria-pressed="' + isFav + '">' + (isFav ? '★ Your team' : '☆ Make this my team') + '</button> ' + GL.shareButton(t.name + ' on Gridline') + ' <a class="btn ghost" href="#/compare/' + esc(id) + '">Compare</a></div></div>' +
        '<div class="kpis"><div><b>' + GL.signed(r.rating) + '</b><small>Strength</small></div><div><b>#' + (S.power.indexOf(id) + 1) + '</b><small>Power rank</small></div><div><b>' + GL.fmt1(r.gp ? s.pf / r.gp : 0) + '</b><small>Pts for / g</small></div><div><b>' + GL.fmt1(r.gp ? s.pa / r.gp : 0) + '</b><small>Pts against / g</small></div>' +
        (inj >= 0.5 ? '<div><b class="neg">' + GL.signed(-inj) + '</b><small>Injury drag</small></div>' : '') + '</div></header>' +
        '<nav class="tabs" role="tablist">' + tabs.map(function (k) { return '<a href="#/team/' + esc(id) + '/' + k + '" class="' + (k === tab ? 'on' : '') + '" role="tab" aria-selected="' + (k === tab) + '">' + k[0].toUpperCase() + k.slice(1) + '</a>'; }).join('') + '</nav><div id="tab"></div>';
      $('#favbtn').onclick = function () {
        var now = GL.fav() === id ? '' : id; GL.setFav(now);
        this.textContent = now ? '★ Your team' : '☆ Make this my team'; this.setAttribute('aria-pressed', !!now);
        GL.toast(now ? t.name + ' is now your team' : 'Team cleared');
      };
      var box = $('#tab');
      box.innerHTML = '<div class="state"><div class="spin" aria-hidden="true"></div></div>';
      if (tab === 'overview') teamOverview(id, s, box);
      else if (tab === 'stats') teamStats(id, box);
      else teamRoster(id, box);
      GL.banner();
    }).catch(function (e) { GL.failed(e, function () { P.team(id, tab); }); });
  };

  function injuryPanel(id) {
    var list = (S.injuries[id] || []).filter(function (i) { return /out|doubtful|questionable|day/i.test(i.status); });
    if (!list.length) return '';
    var order = { out: 0, doubtful: 1, questionable: 2 };
    list.sort(function (a, b) { return (order[a.status.toLowerCase()] === undefined ? 3 : order[a.status.toLowerCase()]) - (order[b.status.toLowerCase()] === undefined ? 3 : order[b.status.toLowerCase()]); });
    return '<section class="panel"><h2>Injury report</h2><ul class="inj">' + list.slice(0, 14).map(function (i) {
      return '<li><span class="badge ' + (/out/i.test(i.status) ? 'warn' : '') + '">' + esc(i.status) + '</span> <b>' + esc(i.name) + '</b> <span class="muted">' + esc(i.pos) + (i.detail ? ' · ' + esc(i.detail) : '') + (i.returnDate ? ' · back ' + esc(i.returnDate) : '') + '</span></li>';
    }).join('') + '</ul><p class="muted small">The model takes points off for these players (most for a quarterback).</p></section>';
  }

  function teamOverview(id, s, box) {
    Api.schedule(id).then(function (events) {
      var future = [], firstFuture = true;
      GL.remember(events, 2);
      var rows = events.map(function (g) {
        var me = g.home.id === id ? g.home : g.away, op = g.home.id === id ? g.away : g.home;
        var isHome = g.home.id === id;
        var oi = GL.teamInfo(op.id), done = g.state === 'post';
        var withInj = !done && firstFuture;
        var p = GL.chance(g, { noInjuries: !withInj });
        var mine = isHome ? p.home : p.away;
        if (!done) { future.push(GL.chance(g, { noInjuries: true })[isHome ? 'home' : 'away']); firstFuture = false; }
        var res;
        if (done) res = '<a class="' + (me.winner ? 'pos' : (op.winner ? 'neg' : '')) + '" href="#/game/' + esc(g.id) + '">' + (me.winner ? 'W' : op.winner ? 'L' : 'T') + ' ' + esc(me.score) + '-' + esc(op.score) + '</a>';
        else res = '<a class="chip" href="#/game/' + esc(g.id) + '">' + Model.pct(mine) + '</a>';
        return '<tr><td>' + (g.week || '') + '</td><td>' + esc(GL.dayLabel(g.date)) + '</td><td><a class="tcell" href="#/team/' + esc(op.id) + '">' + (isHome ? 'vs' : '@') + ' ' + GL.logo(oi, 'sm') + '<span>' + esc(oi.name || op.name) + '</span></a></td><td>' + res + '</td></tr>';
      });
      var proj = Model.projectRecord(s, future);
      box.innerHTML = '<div class="split2"><section class="panel"><h2>Season schedule</h2>' + (events.length ? '<div class="scroll"><table class="data"><thead><tr><th>Wk</th><th>Date</th><th>Opponent</th><th>Result / win chance</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' : GL.empty('No schedule listed yet.')) + '</section>' +
        '<div class="stack"><aside class="panel"><h2>Projected finish</h2><p class="big">' + GL.fmt1(proj.wins) + ' – ' + GL.fmt1(proj.losses) + '</p><p class="muted small">Current record plus the model\'s win chance in each of the ' + proj.remaining + ' games left. It is an expected value, so it will not be a whole number.</p>' +
        '<dl class="facts"><dt>Home</dt><dd>' + esc(s.home || '–') + '</dd><dt>Road</dt><dd>' + esc(s.road || '–') + '</dd><dt>Point diff</dt><dd>' + (s.diff > 0 ? '+' : '') + s.diff + '</dd></dl></aside>' + injuryPanel(id) + '</div></div>';
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
  GL.findStat = findStat;
  GL.STAT_PICK = STAT_PICK;
  function teamStats(id, box) {
    Api.teamStats(id).then(function (st) {
      if (!st.team.length) { box.innerHTML = GL.empty('No stats are available for this team yet.', 'They appear after the first games are played.'); return; }
      var tiles = STAT_PICK.map(function (p) {
        var s = findStat(st.team, p[1], p[2]);
        return s ? '<div class="tile"><b>' + esc(s.shown || GL.fmt1(s.value)) + '</b><small>' + esc(p[0]) + '</small></div>' : '';
      }).join('');
      var allowed = findStat(st.opponent, 'scoring', 'totalPointsPerGame');
      if (allowed) tiles += '<div class="tile"><b>' + esc(allowed.shown) + '</b><small>Points allowed / g' + (allowed.rankText ? ' · ' + esc(allowed.rankText) : '') + '</small></div>';
      function catTable(c, opp) {
        return '<details class="panel cat"><summary>' + esc(c.title) + '</summary><table class="data"><tbody>' + c.stats.map(function (s) {
          return '<tr><td>' + esc(s.title) + '</td><td>' + esc(s.shown) + (!opp && s.perGame ? ' <small class="muted">(' + esc(s.perGame) + ' / g)</small>' : '') + (opp && s.rankText ? ' <small class="muted">' + esc(s.rankText) + '</small>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></details>';
      }
      box.innerHTML = '<div class="tiles">' + tiles + '</div><h2 class="sub">Team stats</h2><div class="cats">' + st.team.map(function (c) { return catTable(c, false); }).join('') + '</div>' +
        (st.opponent.length ? '<h2 class="sub">What opponents did against them</h2><div class="cats">' + st.opponent.map(function (c) { return catTable(c, true); }).join('') + '</div>' : '');
    }).catch(function (e) { box.innerHTML = '<p class="muted">Stats unavailable: ' + esc(e.message) + '</p>'; });
  }

  function teamRoster(id, box) {
    Api.roster(id).then(function (ro) {
      var all = [];
      ro.groups.forEach(function (g) { g.players.forEach(function (p) { p.group = g.name; p.teamId = id; GL.players[p.id] = p; all.push(p); }); });
      if (!all.length) { box.innerHTML = GL.empty('No roster is available for this team yet.'); return; }
      var groups = ro.groups.map(function (g) { return g.name; }).filter(Boolean);
      var cur = { q: '', g: '' };
      box.innerHTML = '<div class="toolbar"><input id="rq" type="search" placeholder="Search players" aria-label="Search players"><div class="chips" id="rg"><button class="chip on" data-g="">All</button>' +
        groups.map(function (g) { return '<button class="chip" data-g="' + esc(g) + '">' + esc(GL.nice(g)) + '</button>'; }).join('') + '</div></div>' +
        (ro.coach ? '<p class="muted small">Head coach: ' + esc(ro.coach) + '</p>' : '') + '<div class="panel"><div class="scroll"><table class="data roster"><thead><tr><th>#</th><th>Player</th><th>Pos</th><th>Age</th><th>Ht</th><th>Wt</th><th>Exp</th><th>College</th><th>Status</th></tr></thead><tbody id="rb"></tbody></table></div></div>';
      function draw() {
        var q = cur.q.toLowerCase();
        var rows = all.filter(function (p) { return (!cur.g || p.group === cur.g) && (!q || (p.name + ' ' + p.pos + ' ' + p.college).toLowerCase().indexOf(q) >= 0); })
          .sort(function (a, b) { return (parseInt(a.jersey, 10) || 999) - (parseInt(b.jersey, 10) || 999); });
        $('#rb').innerHTML = rows.length ? rows.map(function (p) {
          var badge = p.injury ? '<span class="badge warn">' + esc(p.injury) + '</span>' : (p.status && p.status !== 'Active' ? '<span class="badge">' + esc(p.status) + '</span>' : '<span class="muted">Active</span>');
          return '<tr><td>' + esc(p.jersey) + '</td><td><a class="tcell" href="#/player/' + esc(p.id) + '">' + (p.head ? '<img class="head" src="' + esc(p.head) + '" alt="" loading="lazy" width="32" height="32">' : '<span class="head ph"></span>') + '<span>' + esc(p.name) + '</span></a></td><td>' + esc(p.pos) + '</td><td>' + esc(p.age) + '</td><td>' + esc(p.height) + '</td><td>' + esc(p.weight) + '</td><td>' + esc(p.exp === 0 ? 'R' : p.exp) + '</td><td>' + esc(p.college) + '</td><td>' + badge + '</td></tr>';
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

  /* ---------- the model, with a report card ---------- */
  P.model = function () {
    GL.view.innerHTML = '<header class="page-h"><h1>How the win chances work</h1></header><div class="prose">' +
      '<p>Each team gets a <b>strength</b> number: its average scoring margin per game, in points. A team at +6.0 would be expected to beat an average team by about six points on a neutral field. Early in the season a team\'s number is held close to zero (it starts with ' + Model.PRIOR_GAMES + ' games of average results) and eased toward what it actually does. When last season\'s results can be loaded, ' + Math.round(Model.CARRYOVER * 100) + '% of last year\'s margin is the starting point instead of zero.</p>' +
      '<p>For a game, the expected margin is the home team\'s strength minus the away team\'s, plus <b>' + Model.HOME_FIELD + ' points</b> for home field. NFL results land around that number with a typical miss of about <b>' + Model.SIGMA + ' points</b>, so the chance of winning is the normal curve of (expected margin ÷ ' + Model.SIGMA + ').</p>' +
      '<h2 class="sub">Injuries</h2><p>For games that have not started, players listed <b>out</b> count in full, <b>doubtful</b> at 85% and <b>questionable</b> at 25%. A missing quarterback is worth about 5 points, other positions between 0.1 and 0.7, with a cap of ' + Model.MAX_INJURY + ' points per team. Finished and live games show the pregame number without this adjustment.</p>' +
      '<h2 class="sub">Season odds</h2><p>The <a href="#/playoffs">Playoffs</a> page plays out the rest of the regular season 4,000 times using these win chances, seeds each conference (four division winners, then three wild cards) and counts how often each team makes it. Tiebreakers are simplified to point differential, then luck.</p>' +
      '<h2 class="sub">What it leaves out</h2><p>Weather, rest, travel, coaching and anything else that is not a score or an injury listing. Treat it as a quick read, not a betting tool. A 70% favorite still loses three times in ten.</p>' +
      '<h2 class="sub">Report card</h2><div id="report"><div class="state"><div class="spin" aria-hidden="true"></div><p>Replaying this season\'s games…</p></div></div>' +
      '<h2 class="sub">Where the data comes from</h2><p>Live from ESPN\'s public NFL endpoints, fetched by your browser. They are unofficial and can change without notice.</p></div>';
    GL.ensureBase().then(function () {
      var last = S.curType === 2 ? (S.curWeek || 1) : 18;
      var weeks = []; for (var w = 1; w <= last; w++) weeks.push(w);
      return Promise.all(weeks.map(function (w) { return Api.scoreboard(w, 2).catch(function () { return null; }); }));
    }).then(function (all) {
      var games = [];
      all.forEach(function (sb) { if (sb) sb.games.forEach(function (g) { if (g.state === 'post') games.push(g); }); });
      var box = $('#report'); if (!box) return;
      var rep = Model.backtest(games, S.prior || {});
      if (rep.n < 8) { box.innerHTML = '<p class="muted">Not enough finished games yet (' + rep.n + ') for a fair report card. Check back after a few weeks.</p>'; return; }
      box.innerHTML = '<p>Replaying <b>' + rep.n + '</b> finished games in order, predicting each with only what was known before it: the favorite won <b>' + Math.round(rep.accuracy * 100) + '%</b> of the time. A coin flip would be 50%, and published NFL models usually land around 63–67% over a full season.</p>' +
        '<div class="scroll"><table class="data"><thead><tr><th>When the model said</th><th>Games</th><th>It predicted</th><th>Favorite actually won</th></tr></thead><tbody>' +
        rep.bins.map(function (b) { return '<tr><td>' + Math.round(b.lo * 100) + '–' + Math.round(Math.min(b.hi, 1) * 100) + '%</td><td>' + b.n + '</td><td>' + (b.n ? Math.round(b.pred * 100) + '%' : '–') + '</td><td>' + (b.n ? Math.round(b.actual * 100) + '%' : '–') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<p class="muted small">Brier score ' + rep.brier.toFixed(3) + ' (0.250 is a coin flip, lower is better). Small samples bounce around a lot early in a season.</p>';
    }).catch(function (e) { var box = $('#report'); if (box) box.innerHTML = '<p class="muted">Report card unavailable: ' + esc(e.message) + '</p>'; });
  };
})();
