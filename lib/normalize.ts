import type {
  Dashboard,
  Legend,
  Match,
  MatchDetail,
  MatchEvent,
  MatchStat,
  TableRow,
} from './types';

export function isLive(m: Match): boolean {
  const s = m.status;
  return Boolean(s.started && !s.finished && !s.cancelled);
}

export function isFinished(m: Match): boolean {
  return Boolean(m.status.finished);
}

export function kickoff(m: Match): number {
  const t = Date.parse(m.status.utcTime);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * FotMob returns one or more standings tables (a league has one, a cup has a
 * group per table). We render the first "all" table, which is the league one.
 */
function pickTable(raw: any): { rows: any[]; legend: Legend[] } {
  const entry = Array.isArray(raw?.table) ? raw.table[0] : raw?.table;
  const data = entry?.data;
  const rows = data?.table?.all ?? data?.tables?.[0]?.table?.all ?? [];
  const legend: Legend[] = (data?.legend ?? []).filter(
    (l: any) => l && typeof l.color === 'string' && Array.isArray(l.indices),
  );
  return { rows, legend };
}

/** Maps a standings row index onto the qualification zone that covers it. */
function zoneFor(legend: Legend[], rowIndex: number) {
  for (const l of legend) {
    if (l.indices.includes(rowIndex)) return { color: l.color, title: l.title };
  }
  return { color: null, title: null };
}

export function normalize(raw: any): Dashboard {
  const { rows, legend } = pickTable(raw);

  const table: TableRow[] = rows.map((r: any, i: number) => {
    const zone = zoneFor(legend, i);
    return {
      id: r.id,
      name: r.name,
      shortName: r.shortName ?? r.name,
      idx: r.idx ?? i + 1,
      played: r.played ?? 0,
      wins: r.wins ?? 0,
      draws: r.draws ?? 0,
      losses: r.losses ?? 0,
      scoresStr: r.scoresStr ?? '0-0',
      goalConDiff: r.goalConDiff ?? 0,
      pts: r.pts ?? 0,
      qualColor: r.qualColor ?? null,
      deduction: r.deduction ?? null,
      zoneColor: zone.color ?? r.qualColor ?? null,
      zoneTitle: zone.title,
    };
  });

  const all: Match[] = (raw?.fixtures?.allMatches ?? []).filter(
    (m: any) => m?.id && m?.status?.utcTime && m?.home && m?.away,
  );

  const live = all.filter(isLive).sort((a, b) => kickoff(a) - kickoff(b));

  // "Current gameweek" = the round holding the first unplayed match. Once the
  // season is over there is no such match, so fall back to the final round.
  const firstUnplayedId = String(
    raw?.fixtures?.firstUnplayedMatch?.firstUnplayedMatchId ?? '',
  );
  let currentRound: string | null =
    all.find((m) => String(m.id) === firstUnplayedId)?.round ?? null;

  // A live match belongs to the round the user actually wants to watch, even if
  // FotMob's first-unplayed pointer has already rolled into the next one.
  if (live.length) currentRound = live[0].round;
  if (!currentRound && all.length) currentRound = all[all.length - 1].round;

  const roundMatches = all
    .filter((m) => m.round === currentRound)
    .sort((a, b) => kickoff(a) - kickoff(b));

  const recentResults = all
    .filter(isFinished)
    .sort((a, b) => kickoff(b) - kickoff(a))
    .slice(0, 6);

  const now = Date.now();
  const nextMatch =
    all
      .filter((m) => !m.status.started && !m.status.cancelled && kickoff(m) > now)
      .sort((a, b) => kickoff(a) - kickoff(b))[0] ?? null;

  // Goals per completed round — the season "signal" strip in the UI.
  const byRound = new Map<string, { goals: number; played: number }>();
  for (const m of all) {
    if (!isFinished(m)) continue;
    const parts = String(m.status.scoreStr ?? '').split('-').map((x) => Number(x.trim()));
    if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) continue;
    const slot = byRound.get(m.round) ?? { goals: 0, played: 0 };
    slot.goals += parts[0] + parts[1];
    slot.played += 1;
    byRound.set(m.round, slot);
  }
  const goalsByRound = [...byRound.entries()]
    .map(([round, v]) => ({ round, ...v }))
    .sort((a, b) => Number(a.round) - Number(b.round));

  return {
    goalsByRound,
    leagueId: raw?.details?.id ?? 0,
    leagueName: raw?.details?.name ?? 'League',
    season: raw?.details?.selectedSeason ?? '',
    currentRound,
    table,
    legend,
    roundMatches,
    recentResults,
    liveMatches: live,
    nextMatch,
    fetchedAt: Date.now(),
  };
}

const HEADLINE_STATS = new Set([
  'BallPossesion',
  'expected_goals',
  'total_shots',
  'ShotsOnTarget',
  'big_chance',
  'accurate_passes',
  'corners',
  'fouls',
  'yellow_cards',
]);

export function normalizeMatchDetail(raw: any): MatchDetail {
  const header = raw?.header ?? {};
  const teams = header?.teams ?? [];
  const general = raw?.general ?? {};

  const periods = raw?.content?.stats?.Periods?.All?.stats ?? [];
  const flat: any[] = [];
  for (const group of periods) for (const s of group?.stats ?? []) flat.push(s);

  const stats: MatchStat[] = flat
    .filter((s) => HEADLINE_STATS.has(s?.key) && Array.isArray(s?.stats))
    .filter((s) => s.stats[0] != null && s.stats[1] != null)
    // A key can repeat across the "Top stats" and per-category groups.
    .filter((s, i, arr) => arr.findIndex((o) => o.key === s.key) === i)
    .map((s) => ({
      key: s.key,
      title: s.title,
      home: String(s.stats[0]),
      away: String(s.stats[1]),
    }));

  const poss = flat.find((s) => s?.key === 'BallPossesion');
  const possession =
    poss && poss.stats?.[0] != null
      ? { home: Number(poss.stats[0]) || 0, away: Number(poss.stats[1]) || 0 }
      : null;

  const events: MatchEvent[] = (raw?.content?.matchFacts?.events?.events ?? [])
    .filter((e: any) => e && e.type !== 'Half' && e.type !== 'AddedTime')
    .map((e: any) => ({
      minute: typeof e.time === 'number' ? e.time : null,
      type: e.type ?? 'Event',
      player: e.nameStr ?? e.player?.name ?? null,
      isHome: Boolean(e.isHome),
      score: Array.isArray(e.newScore) ? e.newScore.join(' - ') : null,
      ownGoal: Boolean(e.ownGoal),
    }));

  return {
    matchId: String(general?.matchId ?? raw?.content?.matchFacts?.matchId ?? ''),
    home: teams[0]?.name ?? general?.homeTeam?.name ?? 'Home',
    away: teams[1]?.name ?? general?.awayTeam?.name ?? 'Away',
    homeId: teams[0]?.id != null ? String(teams[0].id) : null,
    awayId: teams[1]?.id != null ? String(teams[1].id) : null,
    scoreStr: header?.status?.scoreStr ?? null,
    statusText:
      header?.status?.liveTime?.short ??
      header?.status?.reason?.short ??
      null,
    possession,
    stats,
    events,
  };
}
