import { NextResponse } from 'next/server';
import { normalize, normalizeMatchDetail, isFinished } from '@/lib/normalize';
import {
  extractOddities,
  extractMatchFacts,
  goalClock,
  referees,
  type MatchFacts,
  type Oddity,
} from '@/lib/oddities';
import type { Dashboard } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPSTREAM = 'https://www.fotmob.com/api/data';
const TTL_MS = 35_000;
const LEAGUE_ID = process.env.LEAGUE_ID ?? '47';

/** Per-request cap on new matchDetails fetches, so no single request stalls. */
const FANOUT_BUDGET = 12;
const FANOUT_CONCURRENCY = 6;

type Entry = { at: number; value: unknown };
type LeagueBundle = { dashboard: Dashboard; oddities: Oddity[]; finishedIds: string[] };

/**
 * Per-instance cache. Two jobs: throttle upstream to at most one hit per
 * TTL_MS regardless of how many clients are polling, and hold the last good
 * response so an upstream blip degrades to stale data instead of a blank
 * screen. Serverless gives each warm instance its own copy, which is fine —
 * it bounds our request rate per instance, not globally to one.
 */
const cache = new Map<string, Entry>();

/**
 * Facts pulled from finished matches. A finished match never changes, so this
 * is cached for the life of the instance and only ever grows. Combined with
 * FANOUT_BUDGET it means the season fills in over a few polls rather than in
 * one enormous burst — important because by May there are 380 matches.
 */
const factsCache = new Map<string, MatchFacts>();

async function upstream(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent':
        'Mozilla/5.0 (compatible; premier-league-command-center/1.0; +https://vercel.com)',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`fotmob responded ${res.status}`);
  return res.json();
}

/** Fetch through the cache, transforming with `shape` before storing. */
async function cached<T>(
  key: string,
  url: string,
  shape: (raw: unknown) => T,
): Promise<{ value: T; stale: boolean }> {
  const hit = cache.get(key) as { at: number; value: T } | undefined;
  if (hit && Date.now() - hit.at < TTL_MS) return { value: hit.value, stale: false };

  try {
    const value = shape(await upstream(url));
    cache.set(key, { at: Date.now(), value });
    return { value, stale: false };
  } catch (err) {
    if (hit) return { value: hit.value, stale: true };
    throw err;
  }
}

function leagueBundle() {
  return cached<LeagueBundle>(
    `league:${LEAGUE_ID}`,
    `${UPSTREAM}/leagues?id=${encodeURIComponent(LEAGUE_ID)}`,
    (raw: any) => ({
      dashboard: normalize(raw),
      oddities: extractOddities(raw),
      finishedIds: (raw?.fixtures?.allMatches ?? [])
        .filter((m: any) => isFinished(m))
        .map((m: any) => String(m.id)),
    }),
  );
}

/** Run `job` over `items` with a fixed number of workers. */
async function pool<T>(items: T[], workers: number, job: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        await job(item);
      }
    }),
  );
}

/** Top up `factsCache` with up to FANOUT_BUDGET matches we haven't seen. */
async function fillFacts(finishedIds: string[]) {
  const missing = finishedIds
    .filter((id) => !factsCache.has(id))
    // Newest first: recent matches are the ones worth having early.
    .reverse()
    .slice(0, FANOUT_BUDGET);

  await pool(missing, FANOUT_CONCURRENCY, async (id) => {
    try {
      const raw = await upstream(`${UPSTREAM}/matchDetails?matchId=${id}`);
      factsCache.set(id, extractMatchFacts(id, raw));
    } catch {
      // Leave it missing; a later poll retries it.
    }
  });

  return finishedIds.filter((id) => factsCache.has(id)).map((id) => factsCache.get(id)!);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const [resource, id] = path ?? [];

  try {
    if (resource === 'league') {
      const { value, stale } = await leagueBundle();
      return NextResponse.json(
        { ok: true, stale, data: value.dashboard },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    if (resource === 'oddities') {
      const { value, stale } = await leagueBundle();
      const facts = await fillFacts(value.finishedIds);

      return NextResponse.json(
        {
          ok: true,
          stale,
          data: {
            oddities: value.oddities,
            goalClock: goalClock(facts),
            referees: referees(facts).slice(0, 6),
            coverage: { analyzed: facts.length, finished: value.finishedIds.length },
          },
        },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    if (resource === 'match' && id && /^\d+$/.test(id)) {
      const { value, stale } = await cached(
        `match:${id}`,
        `${UPSTREAM}/matchDetails?matchId=${id}`,
        (raw) => normalizeMatchDetail(raw),
      );
      return NextResponse.json(
        { ok: true, stale, data: value },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    return NextResponse.json(
      { ok: false, error: 'unknown resource' },
      { status: 404 },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'upstream failed' },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    );
  }
}
