import { NextResponse } from 'next/server';
import { normalize, normalizeMatchDetail } from '@/lib/normalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPSTREAM = 'https://www.fotmob.com/api/data';
const TTL_MS = 35_000;
const LEAGUE_ID = process.env.LEAGUE_ID ?? '47';

type Entry = { at: number; value: unknown };

/**
 * Per-instance cache. Two jobs: throttle upstream to at most one hit per
 * TTL_MS regardless of how many clients are polling, and hold the last good
 * response so an upstream blip degrades to stale data instead of a blank
 * screen. Serverless gives each warm instance its own copy, which is fine —
 * it bounds our request rate per instance, not globally to one.
 */
const cache = new Map<string, Entry>();

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
async function cached(
  key: string,
  url: string,
  shape: (raw: unknown) => unknown,
): Promise<{ value: unknown; stale: boolean }> {
  const hit = cache.get(key);
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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const [resource, id] = path ?? [];

  try {
    if (resource === 'league') {
      const { value, stale } = await cached(
        `league:${LEAGUE_ID}`,
        `${UPSTREAM}/leagues?id=${encodeURIComponent(LEAGUE_ID)}`,
        (raw) => normalize(raw),
      );
      return NextResponse.json(
        { ok: true, stale, data: value },
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
