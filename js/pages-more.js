/* Gridline pages, part 2: playoffs, leaders, players, box scores, compare, pick'em, connection test. */
(function () {
  'use strict';
  var Api = window.Api, Model = window.Model, GL = window.GL;
  var S = GL.state, esc = GL.esc, $ = GL.$, P = GL.pages;

  /* ---------- playoff picture and season odds ---------- */
  P.playoffs = function () {
    GL.loading('Playing out the rest of the season…');
    GL.ensureBase().then(function () {
      var first = S.curType === 2 ? (S.curWeek || 1) : 19;
      var weeks = []; for (var w = first; w <= 18; w++) weeks.push(w);
      return Promise.all(weeks.map(function (w) { return Api.scoreboard(w, 2).catch(function () { return null; }); }));
    }).then(function (boards) {
      return new Promise(function (resolve) { setTimeout(function () { resolve(boards); }, 30); });
    }).then(function (boards) {
      var games = [];
      boards.forEach(function (sb) {
        if (!sb) return;
        sb.games.forEach(function (g) {
          if (g.state !== 'pre') return;
          var p = Model.winProb(GL.ratingOf(g.home.id), GL.ratingOf(g.away.id), g.neutral).home;
          games.push({ h: g.home.id, a: g.away.id, p: p });
        });
      });
      var info = {};
      Object.keys(S.standings).forEach(function (id) {
        var s = S.standings[id];
        info[id] = { conf: s.conf, div: Model.divisionOf(s.abbr) || (s.conf + ' ?'), w: s.w, l: s.l, t: s.t, diff: s.diff };
      });
      var odds = Model.simulateSeason(info, games, 4000, 20261);
      // seeding if the season ended today
      var nowSeed = {};
      ['AFC', 'NFC'].forEach(function (c) {
        var ids = Object.keys(info).filter(function (id) { return info[id].conf === c; });
        var wins = {}; ids.forEach(function (id) { wins[id] = info[id].w + info[id].t * 0.5; });
        Model.seedConference(ids, info, wins, function () { return 0.5; }).seeds.forEach(function (id, i) { nowSeed[id] = i + 1; });
      });
      function table(conf) {
        var ids = Object.keys(info).filter(function (id) { return info[id].conf === conf; }).sort(function (a, b) { return (odds[b].playoff - odds[a].playoff) || (odds[b].wins - odds[a].wins); });
        return '<section class="panel table-wrap"><h2>' + esc(conf) + '</h2><div class="scroll"><table class="data"><thead><tr><th>Team</th><th title="Seed if the season ended today">Seed now</th><th>Record</th><th title="Expected final wins">Proj W</th><th>Division</th><th>Playoffs</th><th>#1 seed</th></tr></thead><tbody>' +
          ids.map(function (id) {
            var t = GL.teamInfo(id), s = S.standings[id], o = odds[id];
            return '<tr' + (nowSeed[id] ? ' class="in"' : '') + '><td><a class="tcell" href="#/team/' + esc(id) + '">' + GL.logo(t, 'sm') + '<span>' + esc(t.name) + (GL.fav() === id ? ' <span class="star">★</span>' : '') + '</span></a></td><td>' + (nowSeed[id] || '–') + '</td><td>' + esc(s.overall || s.w + '-' + s.l) + '</td><td>' + GL.fmt1(o.wins) + '</td><td>' + Model.pctSim(o.division) + '</td><td>' + bar(o.playoff) + '</td><td>' + Model.pctSim(o.topSeed) + '</td></tr>';
          }).join('') + '</tbody></table></div></section>';
      }
      function bar(p) { return '<span class="mini"><span style="width:' + Math.round(p * 100) + '%"></span></span> ' + Model.pctSim(p); }
      GL.view.innerHTML = '<header class="page-h"><div class="h-row"><h1>Playoff picture</h1>' + GL.shareButton('Gridline playoff odds') + '</div><p class="lede">' + (games.length ? 'The rest of the regular season (' + games.length + ' games) played out 4,000 times with the <a href="#/model">Gridline model</a>. Highlighted rows are in the playoffs if the season ended today.' : 'No regular-season games are left, so these are the final seeds.') + '</p></header><div class="stack">' + table('AFC') + table('NFC') + '</div>' +
        '<p class="muted small">Seven teams per conference make it: four division winners and three wild cards. Ties are broken by point differential, then luck, so close races are approximate.</p>';
      GL.banner();
    }).catch(function (e) { GL.failed(e, P.playoffs); });
  };

  /* ---------- league leaders ---------- */
  var LEAD = [['passing', 'Passing'], ['rushing', 'Rushing'], ['receiving', 'Receiving'], ['sacks', 'Sacks'], ['interceptions', 'Interceptions']];
  P.leaders = function (kind) {
    kind = LEAD.some(function (l) { return l[0] === kind; }) ? kind : 'passing';
    GL.loading('Loading leaders…');
    GL.ensureBase().then(function () { return Api.leaders(kind, S.year); }).then(function (res) {
      GL.view.innerHTML = '<header class="page-h"><div class="h-row"><h1>League leaders</h1>' + GL.shareButton('Gridline league leaders') + '</div><p class="lede">Top 15 players in each category this season.</p></header>' +
        '<nav class="tabs">' + LEAD.map(function (l) { return '<a href="#/leaders/' + l[0] + '" class="' + (l[0] === kind ? 'on' : '') + '">' + esc(l[1]) + '</a>'; }).join('') + '</nav>' +
        (res.rows.length ? '<section class="panel"><div class="scroll"><table class="data"><thead><tr><th>#</th><th>Player</th><th>Team</th>' + res.labels.slice(0, 10).map(function (l) { return '<th>' + esc(l) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          res.rows.map(function (r, i) {
            return '<tr><td>' + (i + 1) + '</td><td><a class="tcell" href="#/player/' + esc(r.id) + '">' + (r.head ? '<img class="head" src="' + esc(r.head) + '" alt="" loading="lazy" width="32" height="32">' : '<span class="head ph"></span>') + '<span>' + esc(r.name) + ' <small class="muted">' + esc(r.pos) + '</small></span></a></td><td>' + (r.teamId ? '<a href="#/team/' + esc(r.teamId) + '">' + esc(r.teamAbbr) + '</a>' : esc(r.teamAbbr)) + '</td>' +
              res.labels.slice(0, 10).map(function (_, k) { return '<td>' + esc(r.values[k] === undefined ? '' : r.values[k]) + '</td>'; }).join('') + '</tr>';
          }).join('') + '</tbody></table></div></section>' : GL.empty('No leaders yet.', 'Leaders appear after the first games are played.'));
      GL.banner();
    }).catch(function (e) { GL.failed(e, function () { P.leaders(kind); }); });
  };

  /* ---------- one player ---------- */
  P.player = function (id) {
    GL.loading('Loading player…');
    var known = GL.players[id];
    Promise.all([
      GL.ensureBase().catch(function () {}),
      Api.overview(id).catch(function () { return null; }),
      known ? Promise.resolve(null) : Api.athlete(id).catch(function () { return null; }),
    ]).then(function (r) {
      var ov = r[1], bio = known || r[2];
      if (!ov && !bio) { GL.view.innerHTML = '<div class="state"><h2>Player not found</h2><p class="muted">ESPN has no stats for this player yet.</p><p><a href="#/leaders">Back to leaders</a></p></div>'; return; }
      var name = bio ? bio.name : 'Player ' + id, tid = bio ? (bio.teamId || '') : '';
      var ti = tid && S.teams ? GL.teamInfo(tid) : null;
      var facts = bio ? [['Position', bio.pos], ['Number', bio.jersey], ['Age', bio.age], ['Height', bio.height], ['Weight', bio.weight], ['Experience', bio.exp === 0 ? 'Rookie' : (bio.exp === undefined ? '' : bio.exp)], ['College', bio.college]].filter(function (f) { return f[1] !== '' && f[1] !== undefined; }) : [];
      var splits = ov ? ov.splits.filter(function (s, i, arr) { return !(/projected/i.test(s.name) && arr[0] && arr[0].stats.join() === s.stats.join()); }) : [];
      GL.view.innerHTML = '<header class="team-h" style="--tc:' + esc(ti ? GL.visible(ti) : 'var(--accent)') + '"><img class="logo xl" style="border-radius:50%;object-fit:cover" src="https://a.espncdn.com/i/headshots/nfl/players/full/' + esc(id) + '.png" alt="" onerror="this.style.visibility=\'hidden\'" width="84" height="84"><div><h1>' + esc(name) + '</h1><p class="muted">' + (ti ? '<a href="#/team/' + esc(tid) + '">' + esc(ti.name) + '</a>' : esc(bio && bio.team || '')) + '</p><div class="actions">' + GL.shareButton(name + ' on Gridline') + '</div></div>' +
        (facts.length ? '<div class="kpis">' + facts.map(function (f) { return '<div><b>' + esc(f[1]) + '</b><small>' + esc(f[0]) + '</small></div>'; }).join('') + '</div>' : '') + '</header>' +
        '<h2 class="sub">' + esc(ov && ov.title ? ov.title : 'Stats') + '</h2>' +
        (ov && ov.labels.length && splits.length ? '<section class="panel"><div class="scroll"><table class="data"><thead><tr><th></th>' + ov.labels.map(function (l, i) { return '<th title="' + esc(ov.names[i] || '') + '">' + esc(l) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          splits.map(function (s) { return '<tr><td><b>' + esc(s.name) + '</b></td>' + ov.labels.map(function (_, i) { return '<td>' + esc(s.stats[i] === undefined ? '' : s.stats[i]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></section>' : GL.empty('No stats listed for this player yet.', 'Some positions, such as linemen, have little to show.'));
      GL.banner();
    }).catch(function (e) { GL.failed(e, function () { P.player(id); }); });
  };

  /* ---------- a game's box score ---------- */
  P.game = function (id) {
    GL.loading('Loading game…');
    function draw(g, first) {
      var h = g.home, a = g.away;
      if (!h.id || !a.id) { GL.view.innerHTML = '<div class="state"><h2>Game not found</h2><p><a href="#/">Back home</a></p></div>'; return; }
      var th = GL.teamInfo(h.id), ta = GL.teamInfo(a.id);
      var done = g.state === 'post', live = g.state === 'in';
      var p = GL.chance({ state: done || live ? 'post' : 'pre', home: h, away: a, neutral: false });
      var byTeam = {};
      g.teamStats.forEach(function (t) { byTeam[t.id] = t; });
      var A = byTeam[a.id], H = byTeam[h.id];
      var statRows = '';
      if (A && H && A.stats.length) {
        statRows = A.stats.map(function (s, i) {
          var hv = (H.stats.filter(function (x) { return x.name === s.name; })[0] || H.stats[i] || {}).value;
          return '<tr><td class="r">' + esc(s.value) + '</td><td class="c">' + esc(s.label) + '</td><td>' + esc(hv === undefined ? '' : hv) + '</td></tr>';
        }).join('');
      }
      var plays = g.plays.length ? '<section class="panel"><h2>Scoring</h2><ul class="plays">' + g.plays.map(function (pl) {
        return '<li><span class="when">' + (pl.period ? 'Q' + pl.period + ' ' : '') + esc(pl.clock) + '</span><span class="what"><b>' + esc(pl.teamAbbr) + '</b> ' + esc(pl.kind) + (pl.text ? ' <span class="muted">' + esc(pl.text) + '</span>' : '') + '</span><span class="sc">' + esc(a.abbr) + ' ' + esc(pl.away) + ' – ' + esc(h.abbr) + ' ' + esc(pl.home) + '</span></li>';
      }).join('') + '</ul></section>' : '';
      var playerBlocks = g.players.map(function (t) {
        var ti = GL.teamInfo(t.id);
        return '<section class="panel"><h2>' + GL.logo(ti, 'sm') + ' ' + esc(ti.name) + '</h2>' + t.categories.map(function (c) {
          if (!c.athletes.length) return '';
          return '<details class="cat2"><summary>' + esc(GL.nice(c.name)) + '</summary><div class="scroll"><table class="data"><thead><tr><th>Player</th>' + c.labels.map(function (l) { return '<th>' + esc(l) + '</th>'; }).join('') + '</tr></thead><tbody>' +
            c.athletes.map(function (x) { return '<tr><td>' + (x.id ? '<a href="#/player/' + esc(x.id) + '">' + esc(x.name) + '</a>' : esc(x.name)) + '</td>' + c.labels.map(function (_, i) { return '<td>' + esc(x.stats[i] === undefined ? '' : x.stats[i]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></details>';
        }).join('') + '</section>';
      }).join('');
      var status = done ? 'Final' : live ? 'Live · ' + g.detail : g.detail || GL.dayLabel(g.date);
      GL.view.innerHTML = '<header class="page-h"><div class="h-row"><h1>' + esc(a.abbr) + ' at ' + esc(h.abbr) + '</h1>' + GL.shareButton(a.name + ' at ' + h.name) + '</div><p class="lede">' + esc(status) + (g.venue ? ' · ' + esc(g.venue) : '') + ' <span id="livedot" class="livedot" ' + (live ? '' : 'hidden') + '>Updating live</span></p></header>' +
        '<section class="panel scorebug"><a class="sb-team' + (done && a.winner ? ' win' : '') + '" href="#/team/' + esc(a.id) + '">' + GL.logo(ta, 'lg') + '<b>' + esc(ta.name || a.name) + '</b><small>' + esc(a.record) + '</small></a><div class="sb-score">' + esc(a.score === null ? '' : a.score) + '<span class="muted"> – </span>' + esc(h.score === null ? '' : h.score) + '</div><a class="sb-team' + (done && h.winner ? ' win' : '') + '" href="#/team/' + esc(h.id) + '">' + GL.logo(th, 'lg') + '<b>' + esc(th.name || h.name) + '</b><small>' + esc(h.record) + '</small></a>' +
        '<div class="odds sb-odds"><div class="odds-bar"><span style="width:' + (p.away * 100).toFixed(1) + '%;background:' + GL.visible(ta) + '"></span><span style="width:' + (p.home * 100).toFixed(1) + '%;background:' + GL.visible(th) + '"></span></div><div class="odds-txt"><span>' + esc(a.abbr) + ' ' + Model.pct(p.away) + '</span><span class="muted">' + (done || live ? 'pregame win chance' : 'win chance') + '</span><span>' + Model.pct(p.home) + ' ' + esc(h.abbr) + '</span></div></div></section>' +
        (g.available ? '<div class="stack">' + plays + (statRows ? '<section class="panel"><h2>Team stats</h2><table class="data vs"><thead><tr><th class="r">' + esc(a.abbr) + '</th><th class="c"></th><th>' + esc(h.abbr) + '</th></tr></thead><tbody>' + statRows + '</tbody></table></section>' : '') + '<div class="two">' + playerBlocks + '</div></div>' : GL.empty('The box score appears once the game starts.', 'Check back at kickoff.'));
      GL.banner();
      if (first && live) GL.every(30000, function () { Api.summary(id, true).then(function (n) { draw(n, false); }).catch(function () {}); });
    }
    GL.ensureBase().then(function () { return Api.summary(id); }).then(function (g) { draw(g, true); }).catch(function (e) { GL.failed(e, function () { P.game(id); }); });
  };

  /* ---------- compare two teams ---------- */
  P.compare = function (a, b) {
    GL.loading('Loading teams…');
    GL.ensureBase().then(function () {
      var ids = Object.keys(S.teams).sort(function (x, y) { return S.teams[x].name.localeCompare(S.teams[y].name); });
      function sel(name, cur) {
        return '<select id="' + name + '" aria-label="' + (name === 'ca' ? 'First team' : 'Second team') + '"><option value="">Choose a team</option>' + ids.map(function (id) { return '<option value="' + esc(id) + '"' + (id === cur ? ' selected' : '') + '>' + esc(S.teams[id].name) + '</option>'; }).join('') + '</select>';
      }
      var head = '<header class="page-h"><div class="h-row"><h1>Compare teams</h1>' + GL.shareButton('Gridline team comparison') + '</div><p class="lede">Pick any two teams to see them side by side and how a game between them would go.</p></header>' +
        '<div class="toolbar">' + sel('ca', a) + '<span class="muted">vs</span>' + sel('cb', b) + '</div><div id="cmp"></div>';
      GL.view.innerHTML = head;
      function go() { var x = $('#ca').value, y = $('#cb').value; location.hash = '#/compare/' + (x || '_') + (y ? '/' + y : ''); }
      $('#ca').onchange = go; $('#cb').onchange = go;
      if (!a || a === '_' || !b || !S.teams[a] || !S.teams[b]) { $('#cmp').innerHTML = GL.empty('Choose two teams above.'); GL.banner(); return; }
      var ta = GL.teamInfo(a), tb = GL.teamInfo(b), sa = S.standings[a], sb = S.standings[b];
      var ra = S.ratings[a], rb = S.ratings[b];
      Promise.all([Api.teamStats(a).catch(function () { return null; }), Api.teamStats(b).catch(function () { return null; })]).then(function (st) {
        function pg(s, k) { return s.w + s.l + s.t ? GL.fmt1(s[k] / (s.w + s.l + s.t)) : '–'; }
        function pair(label, va, vb, hi) { // hi: 'high' bigger is better, 'low' smaller is better
          var na = parseFloat(String(va).replace(/[^0-9.\-]/g, '')), nb = parseFloat(String(vb).replace(/[^0-9.\-]/g, ''));
          var ca = '', cb = '';
          if (hi && isFinite(na) && isFinite(nb) && na !== nb) { var aw = hi === 'high' ? na > nb : na < nb; ca = aw ? 'best' : ''; cb = aw ? '' : 'best'; }
          return '<tr><td class="r ' + ca + '">' + esc(va) + '</td><td class="c">' + esc(label) + '</td><td class="' + cb + '">' + esc(vb) + '</td></tr>';
        }
        var rows = [pair('Record', sa.overall || sa.w + '-' + sa.l, sb.overall || sb.w + '-' + sb.l), pair('Strength', GL.signed(ra.rating), GL.signed(rb.rating), 'high'),
          pair('Power rank', '#' + (S.power.indexOf(a) + 1), '#' + (S.power.indexOf(b) + 1), 'low'), pair('Points for / g', pg(sa, 'pf'), pg(sb, 'pf'), 'high'), pair('Points against / g', pg(sa, 'pa'), pg(sb, 'pa'), 'low'),
          pair('Point differential', (sa.diff > 0 ? '+' : '') + sa.diff, (sb.diff > 0 ? '+' : '') + sb.diff, 'high')];
        if (st[0] && st[1]) {
          GL.STAT_PICK.forEach(function (sp) { var x = GL.findStat(st[0].team, sp[1], sp[2]), y = GL.findStat(st[1].team, sp[1], sp[2]); if (x && y) rows.push(pair(sp[0], x.shown, y.shown, 'high')); });
          var xa = GL.findStat(st[0].opponent, 'scoring', 'totalPointsPerGame'), xb = GL.findStat(st[1].opponent, 'scoring', 'totalPointsPerGame');
          if (xa && xb) rows.push(pair('Points allowed / g', xa.shown, xb.shown, 'low'));
        }
        var neutral = Model.winProb(ra.rating, rb.rating, true), atA = Model.winProb(ra.rating, rb.rating, false), atB = Model.winProb(rb.rating, ra.rating, false);
        $('#cmp').innerHTML = '<section class="panel scorebug"><a class="sb-team" href="#/team/' + esc(a) + '">' + GL.logo(ta, 'lg') + '<b>' + esc(ta.name) + '</b></a><div class="sb-score muted">vs</div><a class="sb-team" href="#/team/' + esc(b) + '">' + GL.logo(tb, 'lg') + '<b>' + esc(tb.name) + '</b></a></section>' +
          '<div class="split2"><section class="panel"><h2>Side by side</h2><table class="data vs"><tbody>' + rows.join('') + '</tbody></table></section>' +
          '<aside class="panel"><h2>If they played</h2><dl class="facts"><dt>At a neutral site</dt><dd>' + esc(ta.abbr) + ' ' + Model.pct(neutral.home) + '</dd><dt>At ' + esc(ta.abbr) + '</dt><dd>' + esc(ta.abbr) + ' ' + Model.pct(atA.home) + '</dd><dt>At ' + esc(tb.abbr) + '</dt><dd>' + esc(ta.abbr) + ' ' + Model.pct(atB.away) + '</dd></dl><p class="muted small">Win chance for ' + esc(ta.abbr) + ', from the <a href="#/model">model</a>, without injuries.</p></aside></div>';
        GL.banner();
      });
    }).catch(function (e) { GL.failed(e, function () { P.compare(a, b); }); });
  };

  /* ---------- pick'em ---------- */
  P.picks = function () {
    GL.loading('Checking your picks…');
    GL.ensureBase().then(function () {
      var all = GL.picks(), list = Object.keys(all).map(function (k) { return all[k]; });
      if (!list.length) {
        GL.view.innerHTML = '<header class="page-h"><h1>Pick’em</h1><p class="lede">Choose the winner of any upcoming game on the <a href="#/">This week</a> or <a href="#/schedule">Schedule</a> pages using the buttons under each game. Your picks are saved on this device and scored here when the games finish.</p></header>' + GL.empty('No picks yet.');
        GL.banner(); return;
      }
      var need = {};
      list.forEach(function (p) { need[p.type + ':' + p.week] = [p.week, p.type]; });
      return Promise.all(Object.keys(need).map(function (k) { return Api.scoreboard(need[k][0], need[k][1]).catch(function () { return null; }); })).then(function (boards) {
        var res = {};
        boards.forEach(function (sb) { if (sb) sb.games.forEach(function (g) { res[g.id] = g; }); });
        var right = 0, decided = 0, modelRight = 0;
        list.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
        var rows = list.map(function (p) {
          var g = res[p.id], outcome = 'pending', winner = '';
          if (g && g.state === 'post') { winner = g.home.winner ? g.home.id : g.away.winner ? g.away.id : ''; if (winner) { decided++; outcome = p.pick === winner ? 'right' : 'wrong'; if (outcome === 'right') right++; var modelPick = p.homeP >= 0.5 ? p.home : p.away; if (modelPick === winner) modelRight++; } }
          else if (g && g.state === 'in') outcome = 'live';
          var pickAbbr = p.pick === p.home ? p.homeAbbr : p.awayAbbr, mAbbr = p.homeP >= 0.5 ? p.homeAbbr : p.awayAbbr;
          var mark = outcome === 'right' ? '<span class="pos">✓ Correct</span>' : outcome === 'wrong' ? '<span class="neg">✗ Missed</span>' : outcome === 'live' ? '<span class="muted">In progress</span>' : '<span class="muted">Pending</span>';
          return '<tr><td>' + esc(p.type === 3 ? 'Playoffs' : 'Wk ' + p.week) + '</td><td><a href="#/game/' + esc(p.id) + '">' + esc(p.awayAbbr) + ' at ' + esc(p.homeAbbr) + '</a></td><td><b>' + esc(pickAbbr) + '</b></td><td class="muted">' + esc(mAbbr) + ' (' + Model.pct(Math.max(p.homeP, 1 - p.homeP)) + ')</td><td>' + mark + '</td></tr>';
        }).join('');
        GL.view.innerHTML = '<header class="page-h"><div class="h-row"><h1>Pick’em</h1><button class="btn ghost" id="clearp">Clear all picks</button></div><p class="lede">Your picks are saved on this device.</p></header>' +
          '<div class="tiles"><div class="tile"><b>' + right + '–' + (decided - right) + '</b><small>Your record' + (decided ? ' (' + Math.round(right / decided * 100) + '%)' : '') + '</small></div><div class="tile"><b>' + modelRight + '–' + (decided - modelRight) + '</b><small>Model on the same games</small></div><div class="tile"><b>' + (list.length - decided) + '</b><small>Still to play</small></div></div>' +
          '<section class="panel" style="margin-top:16px"><div class="scroll"><table class="data"><thead><tr><th>When</th><th>Game</th><th>You picked</th><th>Model favored</th><th>Result</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';
        var armed = false;
        $('#clearp').onclick = function () { if (!armed) { armed = true; this.textContent = 'Tap again to confirm'; return; } GL.store.set('picks', {}); P.picks(); };
        GL.banner();
      });
    }).catch(function (e) { GL.failed(e, P.picks); });
  };

  /* ---------- connection test ---------- */
  P.debug = function () {
    GL.loading('Testing connections to ESPN…');
    Api.probe().then(function (rows) {
      GL.view.innerHTML = '<header class="page-h"><h1>Connection test</h1><p class="lede">Each line is a feed this site uses. If every line fails, your browser or network is blocking ESPN. Failed lines only switch off the part of the site that uses them.</p></header><div class="panel"><table class="data"><tbody>' +
        rows.map(function (r) { return '<tr><td>' + (r.ok ? '<span class="pos">OK</span>' : '<span class="neg">Failed</span>') + '</td><td>' + esc(r.note) + '</td><td style="white-space:normal;word-break:break-all">' + esc(r.url) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    });
  };
})();
