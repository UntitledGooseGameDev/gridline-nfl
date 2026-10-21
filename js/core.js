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
  /** Chosen time zone ('' means this device's own). Stored in the browser. */
  GL.tz = function () { var z = GL.store.get('tz', ''); try { if (z) new Intl.DateTimeFormat(undefined, { timeZone: z }); else z = ''; } catch (e) { z = ''; } return z; };
  GL.setTz = function (z) { GL.store.set('tz', z || ''); };
  GL.TZONES = [['', 'My device'], ['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'], ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii'], ['UTC', 'UTC'], ['Europe/London', 'London'], ['Europe/Berlin', 'Central Europe'], ['Asia/Tokyo', 'Tokyo'], ['Australia/Sydney', 'Sydney']];
  function fmt(iso, opts) { var d = new Date(iso); if (isNaN(d)) return ''; var z = GL.tz(); if (z) opts.timeZone = z; return d.toLocaleString(undefined, opts); }
  GL.dayLabel = function (iso) { return fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' }); };
  GL.timeLabel = function (iso) { return fmt(iso, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); };
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
    if (u) u.textContent = Api.meta.updatedAt ? 'Data updated ' + fmt(Api.meta.updatedAt, { hour: 'numeric', minute: '2-digit' }) + '.' : '';
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
    var live = g.state === 'in' && !opts.pregame;
    var pre = (g.state === 'pre' || live) && !opts.noInjuries;
    var penH = pre ? GL.injuryDrag(g.home.id) : 0, penA = pre ? GL.injuryDrag(g.away.id) : 0;
    var p = Model.winProb(GL.ratingOf(g.home.id), GL.ratingOf(g.away.id), g.neutral, -penH, -penA);
    p.penH = penH; p.penA = penA;
    if (live && g.home.score !== null && g.away.score !== null) {
      var poss = g.situation && g.situation.possession ? (g.situation.possession === g.home.id ? 1 : g.situation.possession === g.away.id ? -1 : 0) : 0;
      var lp = Model.liveWinProb(p.spread, g.home.score - g.away.score, Model.secondsLeft(g.period, g.clock), poss);
      p.pregameSpread = p.spread; p.home = lp.home; p.away = lp.away; p.spread = lp.spread; p.live = true;
    }
    return p;
  };

  /** ESPN's betting line next to the model's number. Informational only. */
  GL.market = function (g, p) {
    var l = g.line;
    if (!l || g.state === 'post' || (l.homeMargin === null && l.overUnder === null)) return '';
    var bits = [];
    if (l.homeMargin !== null) bits.push('Market: ' + esc(Model.spreadText(l.homeMargin, g.home.abbr, g.away.abbr)));
    if (l.overUnder !== null) bits.push('O/U ' + esc(l.overUnder));
    var diff = '';
    if (l.homeMargin !== null && !(p && p.live) && p) { var d = p.spread - l.homeMargin; if (Math.abs(d) >= 2) diff = ' \u00b7 model likes ' + esc(d > 0 ? g.home.abbr : g.away.abbr) + ' more'; }
    return '<div class="market muted" title="The point spread and total from ESPN\'s feed. For information only, not betting advice.">' + bits.join(' \u00b7 ') + diff + '</div>';
  };

  /** News list as cards that open ESPN articles in a new tab. */
  GL.newsList = function (items, max) {
    items = (items || []).slice(0, max || 8);
    if (!items.length) return GL.empty('No headlines right now.', 'ESPN had no news to show for this.');
    return '<ul class="news">' + items.map(function (a) {
      var when = a.published ? new Date(a.published) : null;
      return '<li><a href="' + esc(a.link) + '" target="_blank" rel="noopener">' + (a.image ? '<img src="' + esc(a.image) + '" alt="" loading="lazy" width="96" height="54">' : '') +
        '<span><b>' + esc(a.headline) + '</b>' + (a.description ? '<small>' + esc(a.description) + '</small>' : '') +
        '<small class="muted">' + (when && !isNaN(when) ? esc(when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) + ' \u00b7 ' : '') + 'ESPN</small></span></a></li>';
    }).join('') + '</ul>';
  };

  /* ---------- alerts for your team (work while Gridline is open) ---------- */
  GL.alertsOn = function () { return GL.store.get('alerts', false) === true && typeof Notification !== 'undefined' && Notification.permission === 'granted'; };
  GL.setAlerts = function (on) {
    if (typeof Notification === 'undefined') { GL.toast('This browser does not support alerts'); return Promise.resolve(false); }
    if (!on) { GL.store.set('alerts', false); return Promise.resolve(false); }
    var ask = Notification.permission === 'granted' ? Promise.resolve('granted') : Notification.requestPermission();
    return Promise.resolve(ask).then(function (r) {
      var ok = r === 'granted'; GL.store.set('alerts', ok);
      if (!ok) GL.toast('Alerts are blocked in your browser settings');
      return ok;
    });
  };
  GL.notify = function (title, body) {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        navigator.serviceWorker.getRegistration().then(function (reg) { if (reg && reg.showNotification) reg.showNotification(title, { body: body, icon: 'assets/icon-192.png', tag: 'gridline' }); else new Notification(title, { body: body, icon: 'assets/icon-192.png' }); }).catch(function () { new Notification(title, { body: body }); });
      } else new Notification(title, { body: body, icon: 'assets/icon-192.png' });
    } catch (e) { GL.toast(title + ': ' + body); }
  };

  /* ---------- where to watch ---------- */
  var WATCH = [
    [/^cbs$/i, 'CBS', 'https://www.paramountplus.com/', true], [/^fox$/i, 'FOX', 'https://www.foxsports.com/live', true],
    [/^nbc$/i, 'NBC', 'https://www.nbc.com/live', true], [/^abc$/i, 'ABC', 'https://abc.com/watch-live', true],
    [/^espn2?$/i, null, 'https://www.espn.com/watch/', false], [/peacock/i, 'Peacock', 'https://www.peacocktv.com/', false],
    [/prime|amazon/i, 'Prime Video', 'https://www.amazon.com/primevideo', false], [/netflix/i, 'Netflix', 'https://www.netflix.com/', false],
    [/youtube/i, 'YouTube', 'https://www.youtube.com/nfl', false], [/nfl network/i, 'NFL Network', 'https://www.nfl.com/network/watch/nfl-network-live', false],
    [/nfl\+|nfl plus/i, 'NFL+', 'https://www.nfl.com/plus/', false],
  ];
  /** Chips for the networks showing a game, linking to the official place to watch. Free over-the-air networks get a note. */
  GL.watch = function (g) {
    var names = g.broadcasts || [];
    if (!names.length || g.state === 'post') return '';
    var ota = false;
    var chips = names.map(function (n) {
      var hit = null;
      WATCH.forEach(function (w) { if (!hit && w[0].test(n)) hit = w; });
      if (hit && hit[3]) ota = true;
      var label = hit && hit[1] ? hit[1] : n;
      return hit ? '<a class="chip watch-chip" href="' + esc(hit[2]) + '" target="_blank" rel="noopener">' + esc(label) + '</a>' : '<span class="chip watch-chip">' + esc(n) + '</span>';
    }).join('');
    return '<div class="watch"><span class="muted">Watch on</span> ' + chips + (ota ? '<span class="muted small" title="CBS, FOX, NBC and ABC games are free over the air with an antenna"> · free with an antenna</span>' : '') + '</div>';
  };

  /** A small field graphic: away end zone on the left, home on the right, ball and first-down line. */
  GL.field = function (g) {
    var sit = g.situation, th = GL.teamInfo(g.home.id), ta = GL.teamInfo(g.away.id);
    var ball = null, line = null, dir = 0;
    if (sit && sit.possession) {
      dir = sit.possession === g.away.id ? 1 : -1;
      var m = /([A-Za-z]{2,4})\s+(\d{1,2})/.exec(sit.where || '');
      var fifty = /^\s*50\s*$/.test(sit.where || '');
      var x = null;
      if (fifty) x = 50;
      else if (m) { var own = m[1].toUpperCase() === (sit.possession === g.away.id ? g.away.abbr : g.home.abbr).toUpperCase(); var n = parseInt(m[2], 10); x = (own ? n : 100 - n); if (dir < 0) x = 100 - x; }
      if (x !== null) { ball = Math.max(0, Math.min(100, x)); if (sit.distance) line = Math.max(0, Math.min(100, ball + dir * sit.distance)); }
    }
    var ys = ''; for (var i = 1; i < 10; i++) ys += '<line x1="' + (10 + i * 10) + '" x2="' + (10 + i * 10) + '" y1="2" y2="38" stroke="#fff" stroke-opacity="' + (i === 5 ? .55 : .25) + '" stroke-width=".5"/>';
    return '<svg class="field" viewBox="0 0 120 40" role="img" aria-label="' + esc(sit && sit.where ? 'Ball at ' + sit.where : 'Field') + '"><rect width="120" height="40" rx="3" fill="#2b7a47"/>' +
      '<rect width="10" height="40" fill="' + esc(GL.visible(ta)) + '" opacity=".85"/><rect x="110" width="10" height="40" fill="' + esc(GL.visible(th)) + '" opacity=".85"/>' +
      '<text x="5" y="22" fill="#fff" font-size="4.5" text-anchor="middle" transform="rotate(-90 5 20)">' + esc(g.away.abbr) + '</text><text x="115" y="22" fill="#fff" font-size="4.5" text-anchor="middle" transform="rotate(90 115 20)">' + esc(g.home.abbr) + '</text>' + ys +
      (line !== null ? '<line x1="' + (10 + line) + '" x2="' + (10 + line) + '" y1="2" y2="38" stroke="#ffd23f" stroke-width="1"/>' : '') +
      (ball !== null ? '<g><ellipse cx="' + (10 + ball) + '" cy="20" rx="3" ry="1.9" fill="#8a4b1f" stroke="#fff" stroke-width=".4"/><path d="M' + (10 + ball + dir * 5) + ' 20l' + (-dir * 2.5) + ' -2v4z" fill="#fff"/></g>' : '') + '</svg>';
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
      '<span class="muted">' + esc(Model.spreadText(p.spread, h.abbr, a.abbr)) + (done ? ' · pregame' : p.live ? ' · live' : '') + '</span>' +
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
      row(ta, a) + row(th, h) + (live && g.situation && (g.situation.shortText || g.situation.where) ? '<div class="sit">' + (g.situation.possession ? '\u25CF ' + esc(g.situation.possession === h.id ? h.abbr : a.abbr) + ' ball \u00b7 ' : '') + esc([g.situation.shortText, g.situation.where].filter(Boolean).join(' at ')) + '</div>' : '') + bar + GL.market(g, p) + GL.watch(g) + pickRow + '</article>';
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
