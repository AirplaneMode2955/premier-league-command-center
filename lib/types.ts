export type TeamRef = { id: string; name: string; shortName: string };

export type MatchStatus = {
  utcTime: string;
  started?: boolean;
  finished?: boolean;
  cancelled?: boolean;
  scoreStr?: string | null;
  liveTime?: { short?: string; long?: string; minute?: number } | null;
  reason?: { short?: string; long?: string } | null;
};

export type Match = {
  id: string;
  round: string;
  roundName?: number;
  home: TeamRef;
  away: TeamRef;
  status: MatchStatus;
};

export type TableRow = {
  id: number;
  name: string;
  shortName: string;
  idx: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  scoresStr: string;
  goalConDiff: number;
  pts: number;
  qualColor?: string | null;
  deduction?: number | null;
  /** Resolved from the legend's `indices`, falling back to `qualColor`. */
  zoneColor: string | null;
  zoneTitle: string | null;
};

export type Legend = { title: string; color: string; indices: number[] };

/** The flattened, client-facing shape produced by `normalize()`. */
export type Dashboard = {
  leagueId: number;
  leagueName: string;
  season: string;
  currentRound: string | null;
  table: TableRow[];
  legend: Legend[];
  roundMatches: Match[];
  recentResults: Match[];
  liveMatches: Match[];
  nextMatch: Match | null;
  goalsByRound: { round: string; goals: number; played: number }[];
  fetchedAt: number;
};

export type MatchStat = { title: string; home: string; away: string; key: string };

export type MatchEvent = {
  minute: number | null;
  type: string;
  player: string | null;
  isHome: boolean;
  score: string | null;
  ownGoal: boolean;
};

export type MatchDetail = {
  matchId: string;
  home: string;
  away: string;
  homeId: string | null;
  awayId: string | null;
  scoreStr: string | null;
  statusText: string | null;
  possession: { home: number; away: number } | null;
  stats: MatchStat[];
  events: MatchEvent[];
};
