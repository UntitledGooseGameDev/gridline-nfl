# Gridline: NFL stats

A static website for following the NFL: this week's games, a full weekly schedule, standings, team pages with stats and rosters, and a win-chance estimate for every game.

There is no server and no build step. The page asks ESPN's public NFL feeds for data directly from your browser, so it is always current.

## Pages

| Page | What it shows |
|---|---|
| This week | Every game this week with scores (live and final) and each team's chance to win, plus power rankings |
| Schedule | Any of the 18 weeks, with win chances |
| Standings | AFC and NFC tables with points for/against, streak and the model's strength number |
| Teams | All 32 teams; each team page has a season schedule with a projected final record, team and opponent stats, and a searchable roster with injury tags |
| The model | How the win chances are calculated |

## How the win chances work

A team's strength is its average scoring margin per game, pulled toward zero while it has played few games (`margin x games / (games + 6)`). A game's expected home margin is the strength difference plus 2 points for home field. The chance of winning is the normal curve of that margin divided by 13.2, the usual spread of NFL results around a prediction. It leaves out injuries, weather and last season, so treat it as a quick read. The code is in `js/model.js`.

## Run it

```
npm start      # serves the folder at http://localhost:8080
npm test       # 12 tests for the model and the data parsers
```

Any static host works. On GitHub Pages, choose "Deploy from a branch", `main`, `/ (root)`.

## Data

ESPN's public endpoints are unofficial and can change without notice. All parsing is in `js/api.js` and is written defensively; responses are cached in the browser for five minutes. This project is not affiliated with the NFL or ESPN.

## Files

- `index.html`, `css/style.css`: the shell and styles
- `js/model.js`: the win-chance model (pure functions)
- `js/api.js`: fetching and parsing
- `js/app.js`: pages and routing
- `tests/`: model and parser tests with small stand-in responses

## What's in v2

- **Playoff picture**: division / playoff / #1 seed odds from 4,000 simulated seasons, plus seeds if the season ended today.
- **Smarter win chances**: starts from last season's margins and adjusts for injuries (QB out counts most).
- **Report card** on the model page: the model replayed over finished games (accuracy, Brier score, calibration).
- **League leaders**, **player pages**, live **box scores** (auto-refresh every 30 s during games), **compare two teams**.
- **Pick'em** tracker (saved in your browser), **favorite team**, **share** buttons.
- **Installable app** (manifest + service worker for the offline shell), offline copies of the latest data, "data updated" time.
- Playoff and Super Bowl weeks in the schedule.

Pages that depend on a feed that fails (injuries, leaders, box scores) show a friendly message or switch off just that feature; `#/debug` tests every feed.

Run `npm test` for the unit tests.

## Live games
- **Where to watch**: each upcoming or live game shows its network(s) with links to the official place to watch (no video is embedded or restreamed; NFL games are licensed).
- **On now** bar on every page while games are live (close it with the x; it stays closed for the browser session, with a "Show live games bar" link in the footer).
- **Live tracker** on the box-score page: field graphic, down and distance, last play, and a win-chance line that updates as the game goes.
- **Live win chance** blends the pregame edge with the score, time left and who has the ball.
