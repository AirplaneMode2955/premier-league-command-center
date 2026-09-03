import type { Match } from './types';
import { isFinished } from './normalize';

/* ------------------------------------------------------------------ *
 * Tier 1 — stat leaderboards that already ship inside the league
 * payload. Zero extra requests; we just have to know what to keep.
 * ------------------------------------------------------------------ */

export type Oddity = {
  key: string;
  /** Our own headline, not FotMob's dry one. */
  label: string;
  leader: string;
  team: string | null;
  teamId: number | null;
  value: string;
  unit: string | null;
  group: 'physical' | 'comedy' | 'nerdy' | 'team';
};

type Spec = {
  key: string;
  label: string;
  group: Oddity['group'];
  unit?: string;
  /** Raw -> display. Defaults to a trimmed number. */
  fmt?: (n: number) => string;
};

const km = (n: number) => (n / 1000).toFixed(1);
const one = (n: number) => n.toFixed(1);
const int = (n: number) => Math.round(n).toLocaleString();

/**
 * Curated because most of the 74 available leaderboards are boring. These
 * are the ones that make you look twice. Order is the rotation order.
 */
const SPECS: Spec[] = [
  // physical
  { key: 'phys_ts', label: 'Fastest player', group: 'physical', unit: 'km/h', fmt: one },
  { key: 'phys_tdc', label: 'Most ground covered', group: 'physical', unit: 'km', fmt: km },
  { key: 'phys_sprints', label: 'Most sprints', group: 'physical' },
  { key: 'phys_sprints_per_90', label: 'Sprints per 90', group: 'physical', fmt: one },

  // comedy
  { key: 'big_chance_missed', label: 'Most big chances missed', group: 'comedy' },
  { key: 'penalty_conceded', label: 'Most penalties conceded', group: 'comedy' },
  { key: 'fouls', label: 'Most fouls per 90', group: 'comedy', fmt: one },
  { key: 'red_card', label: 'Most red cards', group: 'comedy' },
  { key: 'yellow_card', label: 'Most yellow cards', group: 'comedy' },

  // nerdy
  { key: '_goals_prevented', label: 'Best shot-stopping', group: 'nerdy', unit: 'goals prevented', fmt: one },
  { key: 'lbp_total', label: 'Line-breaking passes / 90', group: 'nerdy', fmt: one },
  { key: 'expected_goalsontarget', label: 'Highest xGOT', group: 'nerdy', fmt: one },
  { key: '_save_percentage', label: 'Best save rate', group: 'nerdy', unit: '%', fmt: int },
  { key: 'poss_won_att_3rd', label: 'Wins ball highest up', group: 'nerdy', fmt: one },
  { key: 'penalty_won', label: 'Most penalties won', group: 'nerdy' },

  // team
  { key: '_xg_diff_team', label: 'Most clinical side', group: 'team', unit: 'xG diff', fmt: one },
  { key: 'effective_clearance_team', label: 'Most clearances / match', group: 'team', fmt: one },
  { key: 'possession_percentage_team', label: 'Most possession', group: 'team', unit: '%', fmt: one },
  { key: 'home_attendance_team', label: 'Biggest crowd', group: 'team', fmt: int },
  { key: '_set_piece_goals_team', label: 'Most set-piece goals', group: 'team' },
  { key: 'phys_tdc_team', label: 'Hardest-working side', group: 'team', unit: 'km / match', fmt: km },
];

const BY_KEY = new Map(SPECS.map((s) => [s.key, s]));

export function extractOddities(raw: any): Oddity[] {
  const cards = [...(raw?.stats?.players ?? []), ...(raw?.stats?.teams ?? [])];
  const out: Oddity[] = [];

  for (const card of cards) {
    const spec = BY_KEY.get(card?.name);
    const p = card?.participant;
    if (!spec || !p || typeof p.value !== 'number') continue;

    // Team leaderboards put the club in `name` and carry no separate team.
    const isTeamCard = spec.group === 'team';

    out.push({
      key: spec.key,
      label: spec.label,
      leader: p.name,
      team: isTeamCard ? null : (p.teamName ?? null),
      teamId: isTeamCard ? (p.id ?? null) : (p.teamId ?? null),
      value: (spec.fmt ?? String)(p.value),
      unit: spec.unit ?? null,
      group: spec.group,
    });
  }

  // Preserve SPECS order so the rotation interleaves groups predictably.
  const rank = new Map(SPECS.map((s, i) => [s.key, i]));
  return out.sort((a, b) => (rank.get(a.key) ?? 99) - (rank.get(b.key) ?? 99));
}

/* ------------------------------------------------------------------ *
 * Tier 2 — derived from per-match detail. Needs a fan-out.
 * ------------------------------------------------------------------ */

export type GoalBucket = { label: string; goals: number };

export type Referee = {
  id: number;
  name: string;
  matches: number;
  yellows: number;
  reds: number;
  perMatch: number;
  /** FotMob's own league-wide yellows-per-match average, for context. */
  leagueAvg: number | null;
};

export type MatchFacts = {
  matchId: string;
  goalMinutes: number[];
  refId: number | null;
  refName: string | null;
  refLeagueAvg: number | null;
  yellows: number;
  reds: number;
};

/** Pull just the bits of a matchDetails payload the oddities need. */
export function extractMatchFacts(matchId: string, raw: any): MatchFacts {
  const mf = raw?.content?.matchFacts ?? {};
  const events: any[] = mf?.events?.events ?? [];

  const goalMinutes: number[] = [];
  let yellows = 0;
  let reds = 0;

  for (const e of events) {
    if (e?.type === 'Goal' && typeof e.time === 'number') goalMinutes.push(e.time);
    if (e?.type === 'Card') {
      if (e.card === 'Yellow') yellows += 1;
      else if (e.card === 'Red' || e.card === 'RedYellow') reds += 1;
    }
  }

  const ref = mf?.infoBox?.Referee ?? null;
  const yellowStat = (ref?.stats ?? []).find((s: any) => s?.type === 'yellowCards');

  return {
    matchId,
    goalMinutes,
    refId: typeof ref?.id === 'number' ? ref.id : null,
    refName: ref?.text ?? null,
    refLeagueAvg: typeof yellowStat?.average === 'number' ? yellowStat.average : null,
    yellows,
    reds,
  };
}

const BUCKET_SIZE = 5;

/** 1-5, 6-10 … 86-90, then everything past 90 in one bar. */
export function goalClock(facts: MatchFacts[]): GoalBucket[] {
  const buckets: GoalBucket[] = [];
  for (let start = 1; start <= 86; start += BUCKET_SIZE) {
    buckets.push({ label: `${start}-${start + BUCKET_SIZE - 1}`, goals: 0 });
  }
  buckets.push({ label: '90+', goals: 0 });

  for (const f of facts) {
    for (const m of f.goalMinutes) {
      // Stoppage-time goals are reported past 90; they all share the last bar.
      const i = m > 90 ? buckets.length - 1 : Math.min(Math.floor((m - 1) / BUCKET_SIZE), buckets.length - 2);
      if (i >= 0) buckets[i].goals += 1;
    }
  }
  return buckets;
}

export function referees(facts: MatchFacts[]): Referee[] {
  const by = new Map<number, Referee>();

  for (const f of facts) {
    if (f.refId == null || !f.refName) continue;
    const r = by.get(f.refId) ?? {
      id: f.refId,
      name: f.refName,
      matches: 0,
      yellows: 0,
      reds: 0,
      perMatch: 0,
      leagueAvg: f.refLeagueAvg,
    };
    r.matches += 1;
    r.yellows += f.yellows;
    r.reds += f.reds;
    by.set(f.refId, r);
  }

  return [...by.values()]
    .map((r) => ({ ...r, perMatch: r.matches ? r.yellows / r.matches : 0 }))
    .sort((a, b) => b.perMatch - a.perMatch || b.yellows - a.yellows);
}

export function finishedMatchIds(matches: Match[]): string[] {
  return matches.filter(isFinished).map((m) => String(m.id));
}
