/* Gridline router: maps the address after # to a page. */
(function () {
  'use strict';
  var GL = window.GL, P = GL.pages;

  var routes = [
    [/^\/?$/, function () { P.home(); }, 'home'],
    [/^\/schedule\/post\/(\d+)$/, function (m) { P.schedule(3, parseInt(m[1], 10)); }, 'schedule'],
    [/^\/schedule(?:\/(\d+))?$/, function (m) { P.schedule(2, m[1] ? parseInt(m[1], 10) : null); }, 'schedule'],
    [/^\/standings$/, function () { P.standings(); }, 'standings'],
    [/^\/playoffs$/, function () { P.playoffs(); }, 'playoffs'],
    [/^\/teams$/, function () { P.teams(); }, 'teams'],
    [/^\/team\/(\d+)(?:\/(\w+))?$/, function (m) { P.team(m[1], m[2]); }, 'teams'],
    [/^\/leaders(?:\/(\w+))?$/, function (m) { P.leaders(m[1]); }, 'leaders'],
    [/^\/player\/(\d+)$/, function (m) { P.player(m[1]); }, 'leaders'],
    [/^\/game\/(\d+)$/, function (m) { P.game(m[1]); }, ''],
    [/^\/compare(?:\/(\w+))?(?:\/(\w+))?$/, function (m) { P.compare(m[1], m[2]); }, 'compare'],
    [/^\/picks$/, function () { P.picks(); }, 'picks'],
    [/^\/model$/, function () { P.model(); }, 'model'],
    [/^\/debug$/, function () { P.debug(); }, ''],
  ];

  function route() {
    GL.clearTimers();
    var path = location.hash.replace(/^#/, '') || '/';
    for (var i = 0; i < routes.length; i++) {
      var m = routes[i][0].exec(path);
      if (m) {
        var key = routes[i][2];
        [].forEach.call(document.querySelectorAll('[data-nav]'), function (a) {
          var on = a.getAttribute('data-nav') === key; a.classList.toggle('on', on);
          if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        });
        window.scrollTo(0, 0);
        routes[i][1](m);
        return;
      }
    }
    GL.view.innerHTML = '<div class="state"><h2>Page not found</h2><p><a href="#/">Back home</a></p></div>';
  }
  GL.route = route;

  /* "On now" strip: live games on every page, with a close button (stays closed for this browser session). */
  function hidden() { try { return sessionStorage.getItem('gl.nowHidden') === '1'; } catch (e) { return false; } }
  function setHidden(v) { try { if (v) sessionStorage.setItem('gl.nowHidden', '1'); else sessionStorage.removeItem('gl.nowHidden'); } catch (e) {} }
  var liveNow = [];
  function drawNow() {
    var el = document.getElementById('nowstrip'), show = document.getElementById('nowshow');
    if (!el) return;
    if (!liveNow.length) { el.hidden = true; if (show) show.hidden = true; return; }
    if (hidden()) { el.hidden = true; if (show) show.hidden = false; return; }
    if (show) show.hidden = true;
    el.hidden = false;
    el.innerHTML = '<div class="now"><span class="now-tag"><span class="livedot"></span>On now</span><div class="now-list">' + liveNow.map(function (g) {
      var p = GL.chance(g), fav = p.home >= 0.5;
      return '<a class="now-game" href="#/game/' + GL.esc(g.id) + '"><b>' + GL.esc(g.away.abbr) + ' ' + GL.esc(g.away.score === null ? '' : g.away.score) + ' \u2013 ' + GL.esc(g.home.score === null ? '' : g.home.score) + ' ' + GL.esc(g.home.abbr) + '</b>' +
        '<small>' + GL.esc(g.detail || 'Live') + (g.broadcasts && g.broadcasts.length ? ' \u00b7 ' + GL.esc(g.broadcasts[0]) : '') + ' \u00b7 ' + GL.esc((fav ? g.home.abbr : g.away.abbr) + ' ' + window.Model.pct(fav ? p.home : p.away)) + '</small></a>';
    }).join('') + '</div><button class="now-x" id="nowx" aria-label="Close live games bar" title="Close">\u00d7</button></div>';
    document.getElementById('nowx').onclick = function () { setHidden(true); drawNow(); };
  }
  function pollNow() {
    GL.ensureBase().then(function () { return window.Api.scoreboard(); }).then(function (sb) {
      liveNow = sb.games.filter(function (g) { return g.state === 'in'; }); drawNow();
    }).catch(function () {});
  }
  document.addEventListener('click', function (e) { if (e.target && e.target.id === 'nowshow') { setHidden(false); drawNow(); } });
  GL.onPrior = function () {
    var h = location.hash || '#/';
    if (/^#\/?(standings|playoffs)?$/.test(h)) route();
  };
  window.addEventListener('hashchange', route);
  route();
  pollNow(); setInterval(pollNow, 60000);

  if ('serviceWorker' in navigator && /^https:|^http:\/\/localhost/.test(location.href)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
