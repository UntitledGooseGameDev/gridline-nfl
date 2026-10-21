// Small stand-ins for ESPN responses, shaped like the real feeds, for tests only.
const TEAMS = [
  ['2', 'Buffalo Bills', 'Bills', 'BUF', '00338D', 'C60C30', 'AFC', 4, 1, 0, 140, 90],
  ['12', 'Kansas City Chiefs', 'Chiefs', 'KC', 'E31837', 'FFB81C', 'AFC', 5, 1, 0, 160, 100],
  ['17', 'New England Patriots', 'Patriots', 'NE', '002244', 'C60C30', 'AFC', 3, 2, 1, 120, 115],
  ['4', 'Cincinnati Bengals', 'Bengals', 'CIN', 'FB4F14', '000000', 'AFC', 2, 4, 0, 100, 130],
  ['3', 'Chicago Bears', 'Bears', 'CHI', '0B162A', 'C83803', 'NFC', 4, 2, 0, 150, 120],
  ['25', 'San Francisco 49ers', '49ers', 'SF', 'AA0000', 'B3995D', 'NFC', 5, 1, 0, 170, 95],
  ['6', 'Dallas Cowboys', 'Cowboys', 'DAL', '003594', '869397', 'NFC', 2, 3, 1, 110, 125],
  ['8', 'Detroit Lions', 'Lions', 'DET', '0076B6', 'B0B7BC', 'NFC', 3, 3, 0, 135, 130],
];
const logo = (a) => `https://a.espncdn.com/i/teamlogos/nfl/500/${a.toLowerCase()}.png`;

function teamsJson() {
  return { sports: [{ leagues: [{ teams: TEAMS.map((t) => ({ team: { id: t[0], displayName: t[1], shortDisplayName: t[2], name: t[2], abbreviation: t[3], color: t[4], alternateColor: t[5], logos: [{ href: logo(t[3]) }] } })) }] }] };
}

function standingsJson() {
  const conf = (c, id) => ({
    id, abbreviation: c,
    standings: { entries: TEAMS.filter((t) => t[6] === c).map((t, i) => ({
      team: { id: t[0], displayName: t[1], shortDisplayName: t[2], abbreviation: t[3], logos: [{ href: logo(t[3]) }] },
      stats: [
        { name: 'wins', value: t[7] }, { name: 'losses', value: t[8] }, { name: 'ties', value: t[9] },
        { name: 'winPercent', value: 0.5, displayValue: '.500' }, { name: 'pointsFor', value: t[10] }, { name: 'pointsAgainst', value: t[11] },
        { name: 'differential', value: t[10] - t[11], displayValue: String(t[10] - t[11]) }, { name: 'streak', value: 1, displayValue: 'W1' }, { name: 'playoffSeed', value: i + 1 },
        { name: 'overall', type: 'total', summary: `${t[7]}-${t[8]}${t[9] ? '-' + t[9] : ''}`, displayValue: `${t[7]}-${t[8]}` },
        { name: 'Home', type: 'home', summary: '2-1' }, { name: 'Road', type: 'road', summary: '2-1' },
      ],
    })) },
  });
  return { children: [conf('AFC', '8'), conf('NFC', '7')] };
}

function comp(t, homeAway, score, winner) {
  const x = { homeAway, team: { id: t[0], abbreviation: t[3], displayName: t[1], shortDisplayName: t[2], logo: logo(t[3]) }, records: [{ type: 'total', summary: `${t[7]}-${t[8]}` }] };
  if (score !== undefined) { x.score = score; x.winner = winner; }
  return x;
}
function event(id, away, home, state, week, scores) {
  const A = TEAMS.find((t) => t[0] === away), H = TEAMS.find((t) => t[0] === home);
  const done = state === 'post';
  return {
    id, date: '2026-10-25T17:00Z', name: `${A[1]} at ${H[1]}`, shortName: `${A[3]} @ ${H[3]}`, week: { number: week },
    status: { type: { state, completed: done, shortDetail: done ? 'Final' : state === 'in' ? 'Q2 1:13' : '10/25 - 1:00 PM EDT' }, displayClock: '1:13', period: 2 },
    competitions: [{ neutralSite: false, venue: { fullName: `${H[2]} Stadium` }, status: { type: { state, completed: done } }, competitors: done || state === 'in'
      ? [comp(H, 'home', String(scores[1]), scores[1] > scores[0]), comp(A, 'away', String(scores[0]), scores[0] > scores[1])]
      : [comp(H, 'home'), comp(A, 'away')] }],
  };
}

function scoreboardJson(week) {
  return {
    season: { type: 2, year: 2026 }, week: { number: week, teamsOnBye: [{ id: '4', abbreviation: 'CIN', displayName: 'Cincinnati Bengals' }] }, leagues: [{ calendar: [] }],
    events: [event('1', '17', '3', 'pre', week), event('2', '25', '8', 'in', week, [10, 7]), event('3', '2', '12', 'post', week, [20, 27]), event('4', '6', '25', 'pre', week)],
  };
}

function rosterJson() {
  const p = (id, n, j, pos, extra) => Object.assign({ id, fullName: n, jersey: j, position: { abbreviation: pos }, age: 25, displayHeight: '6\' 2"', displayWeight: '210 lbs', experience: { years: 3 }, college: { name: 'Ohio State' }, headshot: { href: 'https://a.espncdn.com/i/headshots/nfl/players/full/' + id + '.png' }, injuries: [], status: { name: 'Active' } }, extra || {});
  return {
    athletes: [
      { position: 'offense', items: [p('1', 'Pat Passer', '15', 'QB', { injuries: [{ status: 'Questionable' }] }), p('2', 'Rex Runner', '22', 'RB', { experience: { years: 0 } })] },
      { position: 'defense', items: [p('3', 'Dana Defender', '99', 'DE')] },
      { position: 'specialTeam', items: [p('4', 'Kyle Kicker', '3', 'K')] },
    ],
    coach: [{ firstName: 'Sam', lastName: 'Sideline' }],
  };
}

function statsJson() {
  const cat = (name, stats) => ({ name, displayName: name[0].toUpperCase() + name.slice(1), stats });
  const s = (name, value, extra) => Object.assign({ name, displayName: name, value, displayValue: String(value) }, extra || {});
  return { results: {
    stats: { categories: [cat('scoring', [s('totalPointsPerGame', 27.5)]), cat('passing', [s('passingYardsPerGame', 250.1), s('yardsPerGame', 380.2)]), cat('rushing', [s('rushingYardsPerGame', 130.4)])] },
    opponent: [cat('scoring', [s('totalPointsPerGame', 17.2, { rank: 3, rankDisplayValue: '3rd' })])],
  } };
}

function scheduleJson(teamId) {
  const others = TEAMS.filter((t) => t[0] !== teamId);
  return { events: others.slice(0, 5).map((o, i) => event(String(100 + i), i % 2 ? teamId : o[0], i % 2 ? o[0] : teamId, i < 2 ? 'post' : 'pre', i + 1, i === 0 ? [24, 17] : [10, 20])) };
}

module.exports = { TEAMS, teamsJson, standingsJson, scoreboardJson, rosterJson, statsJson, scheduleJson };
