/**
 * Closed-app alerts. A scheduled GitHub Actions job runs this every few minutes, compares ESPN's scoreboard
 * with what it saw last time, and sends a push notification through ntfy.sh for kickoffs, scores and finals.
 * Settings come from the environment: NTFY_TOPIC (secret), ALERT_TEAMS (comma separated abbreviations, or ALL).
 */
'use strict';
const fs = require('fs');
const FEED = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

function summarize(j) {
  const out = {};
  (j.events || []).forEach((ev) => {
    const c = (ev.competitions || [])[0] || {};
    const cs = c.competitors || [];
    const h = cs.find((x) => x.homeAway === 'home') || cs[0], a = cs.find((x) => x.homeAway === 'away') || cs[1];
    if (!h || !a) return;
    const t = (ev.status && ev.status.type) || (c.status && c.status.type) || {};
    const sc = (x) => (x.score && typeof x.score === 'object' ? x.score.displayValue : x.score);
    out[ev.id] = { state: t.state || 'pre', detail: t.shortDetail || '', home: h.team.abbreviation, away: a.team.abbreviation, hs: parseInt(sc(h), 10) || 0, as: parseInt(sc(a), 10) || 0, homeName: h.team.displayName, awayName: a.team.displayName };
  });
  return out;
}

/** Alerts to send, given what we saw before (prev) and now (cur). Teams: array of abbreviations, or ['ALL']. */
function diff(prev, cur, teams) {
  const all = teams.includes('ALL'), msgs = [];
  Object.keys(cur).forEach((id) => {
    const g = cur[id], p = prev[id];
    if (!all && !teams.includes(g.home) && !teams.includes(g.away)) return;
    if (!p) return; // first sighting: just remember it
    const line = `${g.away} ${g.as} – ${g.hs} ${g.home}`;
    if (p.state === 'pre' && g.state === 'in') msgs.push({ title: `Kickoff: ${g.away} at ${g.home}`, body: 'The game has started.', tags: 'football' });
    else if (g.state === 'post' && p.state !== 'post') msgs.push({ title: `Final: ${line}`, body: g.hs > g.as ? `${g.homeName} win` : g.as > g.hs ? `${g.awayName} win` : 'Tie game', tags: 'checkered_flag' });
    else if (g.state === 'in' && (p.hs !== g.hs || p.as !== g.as)) msgs.push({ title: 'Score update', body: `${line}${g.detail ? ' · ' + g.detail : ''}`, tags: 'rotating_light' });
  });
  return msgs;
}

async function main() {
  const topic = process.env.NTFY_TOPIC, teams = (process.env.ALERT_TEAMS || 'ALL').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!topic) { console.log('NTFY_TOPIC is not set; nothing to do.'); return; }
  const file = process.env.STATE_FILE || 'alerts-state.json';
  let prev = {}; try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* first run */ }
  const res = await fetch(FEED);
  if (!res.ok) throw new Error('ESPN answered ' + res.status);
  const cur = summarize(await res.json());
  const msgs = diff(prev, cur, teams);
  for (const m of msgs) {
    const r = await fetch('https://ntfy.sh/' + encodeURIComponent(topic), { method: 'POST', body: m.body, headers: { Title: m.title, Tags: m.tags, Click: 'https://untitledgoosegamedev.github.io/gridline-nfl/' } });
    console.log(r.ok ? 'sent' : 'failed ' + r.status, m.title);
  }
  fs.writeFileSync(file, JSON.stringify(Object.assign({}, prev, cur)));
  console.log(`checked ${Object.keys(cur).length} games, sent ${msgs.length} alerts`);
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { summarize, diff };
