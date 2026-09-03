# Premier League Command Center

A live, one-screen dashboard for the Premier League. Dark, monospace, data-forward —
everything visible without scrolling on a desktop viewport.

## What's on screen

- **Header** — wall clock, current gameweek, last-synced time, manual refresh, and a
  LIVE pill that only appears when a match is actually in progress.
- **Next Kickoff** — nearest upcoming fixture with a live countdown.
- **This Gameweek** — every fixture in the current round. Live matches pulse red and
  show the minute; finished show the FT score; upcoming show kickoff time.
- **Recent Results** — the last 6 finished matches league-wide.
- **Season Signal** — league pulse tiles plus a goals-per-gameweek waveform. Clicking
  any fixture replaces this pane with a **match detail** panel (possession, shots, xG,
  key events) from FotMob's `matchDetails` endpoint.
- **Table** — full 20-team standings with a left-edge zone bar per row, coloured from
  the API's own `legend.indices` (Champions League green, Europa blue, relegation red).

## Data

FotMob's unofficial public JSON API. The browser never talks to FotMob directly —
`/api/fotmob/[...path]` proxies server-side:

| Route | Upstream |
| --- | --- |
| `GET /api/fotmob/league` | `leagues?id=$LEAGUE_ID` |
| `GET /api/fotmob/match/<id>` | `matchDetails?matchId=<id>` |

The proxy does two things beyond forwarding:

1. **Caches for 35s per instance.** However many clients are polling, upstream sees at
   most one request per 35s per warm instance.
2. **Normalizes.** The league payload is ~743 KB of raw JSON; the client receives ~12 KB
   of exactly what it renders.

**Graceful degradation.** If upstream fails and the proxy holds a previous good
response, it serves that with `stale: true`. The client also keeps its last good render
on a network error. Either way an amber **Stale data** chip appears and the synced
timestamp stops advancing — the screen never blanks.

The client polls every 60s, plus on tab re-focus and on manual refresh.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `LEAGUE_ID` | `47` | FotMob competition id. 42 = Champions League, 87 = LaLiga, 54 = Bundesliga, 55 = Serie A, 53 = Ligue 1. |

Read at request time on both the page and the API route, so changing it in the Vercel
dashboard takes effect on the next request — no redeploy needed.

Nothing else is league-specific: qualification zones, round numbering and team crests
all come from the API, so pointing this at another competition just works.

## Local development

```bash
npm install
npm run dev
```

Then open http://localhost:3000.
