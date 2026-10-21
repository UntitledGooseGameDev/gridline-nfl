/* Gridline core: shared state, helpers and components used by every page. */
(function () {
  'use strict';
  var Api = window.Api, Model = window.Model;

  var GL = window.GL = {
    state: { standings: null, teams: null, ratings: null, power: null, injuries: {}, prior: null, year: null, curWeek: null, curType: 2, postseason: [], sb0: null },
    pages: {},
    timers: [],
    view: document.getElementById('view'),
    onPrior: null,
  };
  var S = GL.state;

  /* ---------- small helpers ---------- */
  GL.esc = function (s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var esc = GL.esc;
  GL.$ = function (sel, root) { return (root || document).querySelector(sel); };
  GL.lum = function (hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 0;
    var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  GL.visible = function (team) {
    var c = team && team.color, a = team && team.alt;
    if (c && GL.lum(c) > 0.2) return c;
    if (a && GL.lum(a) > 0.2) return a;
    return '#7aa2ff';
  };
  GL.dayLabel = function (iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); };
  GL.timeLabel = function (iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
  GL.fmt1 = function (n) { return (Math.round(n * 10) / 10).toFixed(1); };
  GL.signed = function (n) { var v = Math.round(n * 10) / 10; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1); };
  GL.nice = function (s) { return String(s || '').replace(/([A-Z])/g, ' $1').replace(/^./, function (c) { return c.toUpperCase(); }); };

  /* ---------- saved choices (favorite team, picks) ---------- */
  GL.store = {
    get: function (k, d) { try { var v = localStorage.getItem('gl.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('gl.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };
  GL.fav = function () { return GL.store.get('fav', ''); };
  GL.setFav = function (id) { GL.store.set('fav', id || ''); };
  GL.picks = function () { return GL.store.get('picks', {}); };
  GL.setPick = function (g, teamId) {
    var all = GL.picks();
    if (all[g.id] && all[g.id].pick === teamId) delete all[g.id];
    else all[g.id] = { id: g.id, pick: teamId, week: g.week, type: g.type || 2, home: g.home.id, away: g.away.id, homeAbbr: g.home.abbr, awayAbbr: g.away.abbr, date: g.date, year: S.year, homeP: GL.chance(g).home };
    GL.store.set('picks', all);
    return all[g.id] ? all[g.id].pick : '';
  };

  /* ---------- toast, share, banner ---------- */
  GL.toast = function (msg) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('on');
    clearTimeout(GL._tt); GL._tt = setTimeout(function () { t.classList.remove('on'); }, 2200);
  };
  GL.share = function (title) {
    var url = location.href;
    if (navigator.share) { navigator.share({ title: title || document.title, url: url }).catch(function () {}); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { GL.toast('Link copied'); }, function () { GL.toast(url); });
    else GL.toast(url);
  };
  GL.banner = function () {
    var b = document.getElementById('banner'), u = document.getElementById('updated');
    if (b) {
      if (Api.meta.stale) { b.hidden = false; b.textContent = 'You appear to be offline. Showing the last data saved on this device (' + new Date(Api.meta.staleAt).toLocaleString() + ').'; }
      else b.hidden = true;
    }
    if (u) u.textContent = Api.meta.updatedAt ? 'Data updated ' + new Date(Api.meta.updatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) + '.' : '';
  };

  /* ---------- states ---------- */
  GL.loading = function (msg) { GL.view.innerHTML = '<div class="state"><div class="spin" aria-hidden="true"></div><p>' + esc(msg || 'Loading…') + '</p></div>'; };
  GL.failed = function (err, retry) {
    GL.view.innerHTML = '<div class="state error"><h2>Could not load the data</h2><p>' + esc(err && err.message ? err.message : err) +
      '</p><p class="muted">The numbers come live from ESPN. If you are offline or their service is down, try again in a minute.</p><button class="btn" id="retry">Try again</button></div>';
    GL.$('#retry').onclick = retry;
  };
  GL.empty = function (msg, hint) { return '<div class="empty"><p><b>' + esc(msg) + '</b></p>' + (hint ? '<p class="muted">' + esc(hint) + '</p>' : '') + '</div>'; };

  /* ---------- timers that stop when you leave the page ---------- */
  GL.clearTimers = function () { GL.timers.forEach(clearInterval); GL.timers = []; };
  GL.every = function (ms, fn) { GL.timers.push(setInterval(fn, ms)); };

  /* ---------- shared data ---------- */
  function computeRatings() {
    var ratings = {};
    Object.keys(S.standings).forEach(function (id) { ratings[id] = Model.rating(S.standings[id], S.prior ? S.prior[id] : 0); });
    S.ratings = ratings;
    S.power = Object.keys(ratings).sort(function (a, b) { return ratings[b].rating - ratings[a].rating; });
  }
  var basePromise = null;
  GL.ensureBase = function () {
    if (S.standings && S.teams) return Promise.resolve();
    if (basePromise) return basePromise;
    basePromise = Promise.all([
      Api.standings(),
      Api.teams().catch(function () { return {}; }),          // only adds colors
      Api.injuries().catch(function () { return {}; }),       // only adjusts win chances
      Api.scoreboard().catch(function () { return null; }),   // current week and season
    ]).then(function (r) {
      S.standings = r[0]; S.teams = r[1]; S.injuries = r[2] || {};
      Object.keys(S.standings).forEach(function (id) {
        if (!S.teams[id]) { var s = S.standings[id]; S.teams[id] = { id: id, name: s.name, short: s.short, abbr: s.abbr, logo: s.logo, color: '', alt: '' }; }
      });
      var sb = r[3];
      if (sb) { S.sb0 = sb; S.year = sb.year; S.curWeek = sb.week; S.curType = sb.seasonType; S.postseason = sb.postseason; }
      if (!S.year) S.year = new Date().getFullYear();
      try { var saved = JSON.parse(localStorage.getItem('glprior:' + (S.year - 1)) || 'null'); if (saved && saved.mov) S.prior = saved.mov; } catch (e) { /* ignore */ }
      computeRatings();
      if (!S.prior) {
        Api.priorSeason(S.year - 1).then(function (mov) { S.prior = mov; computeRatings(); if (GL.onPrior) GL.onPrior(); }).catch(function () { /* optional */ });
      }
    }).catch(function (e) { basePromise = null; throw e; });
    return basePromise;
  };
  GL.teamInfo = function (id) {
    var s = S.standings[id] || {}, t = S.teams[id] || {};
    return { id: id, name: s.name || t.name || '', short: s.short || t.short || '', abbr: s.abbr || t.abbr || '', logo: s.logo || t.logo || '', color: t.color || '', alt: t.alt || '' };
  };
  GL.ratingOf = function (id) { return S.ratings && S.ratings[id] ? S.ratings[id].rating : 0; };
  GL.injuryDrag = function (id) { return Model.injuryPenalty(S.injuries[id]); };

  /** Win chance for a game. Upcoming games include injuries; finished or live ones show the pregame number without them. */
  GL.chance = function (g, opts) {
    opts = opts || {};
    var pre = g.state === 'pre' && !opts.noInjuries;
    var penH = pre ? GL.injuryDrag(g.home.id) : 0, penA = pre ? GL.injuryDrag(g.away.id) : 0;
    var p = Model.winProb(GL.ratingOf(g.home.id), GL.ratingOf(g.away.id), g.neutral, -penH, -penA);
    p.penH = penH; p.penA = penA;
    return p;
  };

  /* ---------- components ---------- */
  GL.logo = function (team, cls) {
    return team && team.logo ? '<img class="logo ' + (cls || '') + '" src="' + esc(team.logo) + '" alt="" loading="lazy" width="40" height="40" onerror="this.style.visibility=\'hidden\'">' : '<span class="logo ph ' + (cls || '') + '"></span>';
  };

  GL.gameCard = function (g, ctx) {
    ctx = ctx || {};
    var h = g.home, a = g.away;
    var th = GL.teamInfo(h.id), ta = GL.teamInfo(a.id);
    var p = GL.chance(g);
    var done = g.state === 'post', live = g.state === 'in';
    var status = done ? 'Final' : live ? ('Live · ' + (g.detail || 'In progress')) : GL.dayLabel(g.date) + ' · ' + GL.timeLabel(g.date);
    var ph = Model.pct(p.home), pa = Model.pct(p.away);
    var favHome = p.home >= 0.5;
    var cH = GL.visible(th), cA = GL.visible(ta);
    var fav = GL.fav();
    var picks = GL.picks(), pk = picks[g.id];
    function row(t, side) {
      var sc = side.score === null ? '' : side.score;
      var win = done && side.winner;
      return '<a class="g-team' + (win ? ' win' : '') + (fav && side.id === fav ? ' mine' : '') + '" href="#/team/' + esc(side.id) + '">' + GL.logo(t) +
        '<span class="g-name"><b>' + esc(t.short || side.short) + (fav && side.id === fav ? ' <span class="star" title="Your team">★</span>' : '') + '</b><small>' + esc(side.record) + '</small></span>' +
        '<span class="g-score">' + esc(sc) + '</span></a>';
    }
    var drag = [];
    if (p.penA >= 1) drag.push(a.abbr + ' ' + GL.signed(-p.penA));
    if (p.penH >= 1) drag.push(h.abbr + ' ' + GL.signed(-p.penH));
    var bar = '<div class="odds" role="img" aria-label="' + esc(a.abbr + ' ' + pa + ', ' + h.abbr + ' ' + ph) + ' win chance">' +
      '<div class="odds-bar"><span style="width:' + (p.away * 100).toFixed(1) + '%;background:' + cA + '"></span><span style="width:' + (p.home * 100).toFixed(1) + '%;background:' + cH + '"></span></div>' +
      '<div class="odds-txt"><span class="' + (!favHome ? 'fav' : '') + '">' + esc(a.abbr) + ' ' + pa + '</span>' +
      '<span class="muted">' + esc(Model.spreadText(p.spread, h.abbr, a.abbr)) + (done ? ' · pregame' : '') + '</span>' +
      '<span class="' + (favHome ? 'fav' : '') + '">' + ph + ' ' + esc(h.abbr) + '</span></div>' +
      (drag.length ? '<div class="drag muted" title="Points the model takes off for players listed out, doubtful or questionable">Injuries: ' + esc(drag.join(', ')) + ' pts</div>' : '') + '</div>';
    var pickRow = '';
    if (!ctx.noPicks) {
      var mark = '';
      if (done && pk) { var won = (pk.pick === h.id && h.winner) || (pk.pick === a.id && a.winner); mark = '<span class="' + (won ? 'pos' : 'neg') + '">' + (won ? '✓ Correct' : '✗ Missed') + '</span>'; }
      pickRow = '<div class="pickrow"><span class="muted">Your pick</span>' +
        [a, h].map(function (s) { return '<button class="pick' + (pk && pk.pick === s.id ? ' on' : '') + '" data-pick="' + esc(g.id) + '" data-team="' + esc(s.id) + '"' + (done || live ? ' disabled' : '') + ' aria-pressed="' + !!(pk && pk.pick === s.id) + '">' + esc(s.abbr) + '</button>'; }).join('') + mark + '</div>';
    }
    return '<article class="game' + (live ? ' live' : '') + '" data-game="' + esc(g.id) + '"><div class="g-head"><span>' + esc(status) + '</span>' +
      (g.state !== 'pre' ? '<a href="#/game/' + esc(g.id) + '" class="boxlink">Box score ›</a>' : (g.venue ? '<span class="muted">' + esc(g.venue) + '</span>' : '')) + '</div>' +
      row(ta, a) + row(th, h) + bar + pickRow + '</article>';
  };

  /** Registry so the pick buttons can find the game they belong to. */
  GL.gameIndex = {};
  GL.remember = function (games, type) { games.forEach(function (g) { g.type = type || S.curType || 2; GL.gameIndex[g.id] = g; }); };

  GL.weekTabs = function (activeType, activeWeek) {
    var out = '<nav class="weeks" aria-label="Week">';
    for (var w = 1; w <= 18; w++) {
      var on = activeType === 2 && w === activeWeek;
      out += '<a href="#/schedule/' + w + '" class="' + (on ? 'on' : '') + (S.curType === 2 && w === S.curWeek ? ' now' : '') + '"' + (on ? ' aria-current="page"' : '') + '>' + w + '</a>';
    }
    var post = S.postseason && S.postseason.length ? S.postseason : [{ week: 1, label: 'Wild Card' }, { week: 2, label: 'Divisional Round' }, { week: 3, label: 'Conference Championship' }, { week: 4, label: 'Super Bowl' }];
    var short = { 'Wild Card': 'WC', 'Divisional Round': 'DIV', 'Conference Championship': 'CONF', 'Super Bowl': 'SB' };
    post.forEach(function (p) {
      var on = activeType === 3 && p.week === activeWeek;
      out += '<a href="#/schedule/post/' + p.week + '" class="post ' + (on ? 'on' : '') + (S.curType === 3 && p.week === S.curWeek ? ' now' : '') + '" title="' + esc(p.label) + '"' + (on ? ' aria-current="page"' : '') + '>' + esc(short[p.label] || p.label) + '</a>';
    });
    return out + '</nav>';
  };

  GL.shareButton = function (title) { return '<button class="btn ghost" data-share="' + esc(title || '') + '">Share</button>'; };

  /* ---------- delegated clicks: share and picks ---------- */
  document.addEventListener('click', function (e) {
    var sh = e.target.closest && e.target.closest('[data-share]');
    if (sh) { e.preventDefault(); GL.share(sh.getAttribute('data-share')); return; }
    var pk = e.target.closest && e.target.closest('[data-pick]');
    if (pk && !pk.disabled) {
      e.preventDefault();
      var g = GL.gameIndex[pk.getAttribute('data-pick')]; if (!g) return;
      var now = GL.setPick(g, pk.getAttribute('data-team'));
      var row = pk.parentNode;
      [].forEach.call(row.querySelectorAll('.pick'), function (b) { var on = b.getAttribute('data-team') === now; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    }
  });
})();
