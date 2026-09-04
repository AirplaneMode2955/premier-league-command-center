'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dashboard } from '@/lib/types';
import { Crest } from './ui';

type Oddity = {
  key: string;
  label: string;
  leader: string;
  team: string | null;
  teamId: number | null;
  value: string;
  unit: string | null;
  group: 'physical' | 'comedy' | 'nerdy' | 'team';
};

type Referee = {
  id: number;
  name: string;
  matches: number;
  yellows: number;
  reds: number;
  perMatch: number;
  leagueAvg: number | null;
};

type Payload = {
  oddities: Oddity[];
  goalClock: { label: string; goals: number }[];
  referees: Referee[];
  coverage: { analyzed: number; finished: number };
};

type Card = { kind: 'oddity'; o: Oddity } | { kind: 'ref'; r: Referee };

const ROTATE_MS = 8000;
/** Steady-state poll once the season is fully analysed. */
const POLL_MS = 300_000;
/** While the server is still filling its per-match cache, chase it. */
const CATCHUP_MS = 8_000;

/**
 * Opening line-up, in order. The referee card is built client-side so it has
 * no stat key of its own; the rest are FotMob stat names.
 */
const PINNED = ['expected_goalsontarget', 'possession_percentage_team', 'phys_tdc_team'];

function OddityTile({ o }: { o: Oddity }) {
  return (
    <div className="tile">
      <div className="tile-l">{o.label}</div>
      <div className="tile-v">
        <span className="n">{o.value}</span>
        {o.unit && <span className="tile-u">{o.unit}</span>}
      </div>
      <div className="tile-who">
        {o.teamId != null && <Crest id={o.teamId} alt="" />}
        <span className="nm">{o.leader}</span>
      </div>
    </div>
  );
}

function RefTile({ r }: { r: Referee }) {
  const hot = r.leagueAvg != null && r.perMatch > r.leagueAvg;
  return (
    <div className="tile is-ref">
      <div className="tile-l">Card-happiest referee</div>
      <div className="tile-v">
        <span className="n">{r.perMatch.toFixed(1)}</span>
        <span className="tile-u">yel / match</span>
      </div>
      <div className="tile-who">
        <span className="nm">{r.name}</span>
        <span className={`ref-flag${hot ? ' hot' : ''}`}>
          {r.matches} {r.matches === 1 ? 'match' : 'matches'}
          {r.leagueAvg != null && ` · avg ${r.leagueAvg.toFixed(1)}`}
        </span>
      </div>
    </div>
  );
}

/**
 * Goal clock. One row per five-minute bucket, running down rather than
 * across, so it reads as a standing widget beside the cards instead of a
 * full-width strip under them.
 */
/**
 * Merge the eighteen five-minute buckets into nine ten-minute ones (stoppage
 * time stays its own row). Nineteen labelled rows need ~250px; when the
 * widget is shorter than that they'd be unreadable slivers.
 */
function coarsen(clock: { label: string; goals: number }[]) {
  const five = clock.filter((b) => b.label !== '90+');
  const stoppage = clock.find((b) => b.label === '90+');
  const out: { label: string; goals: number }[] = [];
  for (let i = 0; i < five.length; i += 2) {
    const a = five[i];
    const b = five[i + 1];
    const start = a.label.split('-')[0];
    const end = (b ?? a).label.split('-')[1];
    out.push({ label: `${start}-${end}`, goals: a.goals + (b?.goals ?? 0) });
  }
  if (stoppage) out.push(stoppage);
  return out;
}

function GoalClock({
  clock,
  total,
  compact,
}: {
  clock: { label: string; goals: number }[];
  total: number;
  compact: boolean;
}) {
  const rows = compact ? coarsen(clock) : clock;
  const peak = Math.max(1, ...rows.map((b) => b.goals));
  const busiest = rows.find((b) => b.goals === peak);
  return (
    <aside className="clockw">
      <div className="clockw-head">
        <span className="clockw-t">Goal clock</span>
        <span className="clockw-n">{total}</span>
      </div>
      <div className="clockw-rows">
        {rows.map((b) => (
          <div
            className={`crow${b.goals === peak && b.goals > 0 ? ' pk' : ''}`}
            key={b.label}
            title={`${b.label} min — ${b.goals} goal${b.goals === 1 ? '' : 's'}`}
          >
            {/* Label by the bucket's closing minute: 5, 10 ... 90, 90+.
                Half the width of "41-45", so the type can be bigger. */}
            <span className="cmin">
              {b.label === '90+' ? '90+' : b.label.split('-')[1]}
            </span>
            <span className="ctrack">
              <i style={{ width: `${b.goals ? Math.max(6, (b.goals / peak) * 100) : 0}%` }} />
            </span>
          </div>
        ))}
      </div>
      <div className="clockw-foot">
        {busiest ? `Busiest ${busiest.label}'` : 'Building…'}
      </div>
    </aside>
  );
}

/**
 * The league's odd corners: rotating stat cards with the goal clock alongside
 * as a standing widget. Doubles as the resting state of the pane the
 * match-detail panel takes over.
 */
export default function SeasonSignal({ data }: { data: Dashboard }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  // A tall screen is better spent on more stats than on more padding.
  const [slots, setSlots] = useState(4);

  useEffect(() => {
    // Card count follows available height. Showing four clipped cards is
    // worse than showing two whole ones.
    const huge = window.matchMedia('(min-height: 1300px) and (min-width: 1800px)');
    const tall = window.matchMedia('(min-height: 1040px) and (min-width: 1180px)');
    const roomy = window.matchMedia('(min-height: 820px)');
    const apply = () =>
      setSlots(huge.matches ? 12 : tall.matches ? 8 : roomy.matches ? 4 : 2);
    apply();
    for (const mq of [huge, tall, roomy]) mq.addEventListener('change', apply);
    return () => {
      for (const mq of [huge, tall, roomy]) mq.removeEventListener('change', apply);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function load() {
      let next = POLL_MS;
      try {
        const res = await fetch('/api/fotmob/oddities');
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) {
          setPayload(json.data);
          setFailed(false);
          // The server fills its match cache a batch at a time. Until it has
          // the whole season, poll fast so the goal clock completes in
          // seconds rather than over hours of steady-state polling.
          const c = json.data?.coverage;
          if (c && c.analyzed < c.finished) next = CATCHUP_MS;
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
      if (!cancelled) timer = setTimeout(load, next);
    }

    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const cards = useMemo<Card[]>(() => {
    if (!payload) return [];
    const remaining = new Map(payload.oddities.map((o) => [o.key, o]));
    const out: Card[] = [];

    const topRef = payload.referees[0];
    if (topRef) out.push({ kind: 'ref', r: topRef });

    for (const key of PINNED) {
      const o = remaining.get(key);
      if (o) {
        out.push({ kind: 'oddity', o });
        remaining.delete(key);
      }
    }
    // Everything else keeps the server's ordering.
    for (const o of payload.oddities) {
      if (remaining.has(o.key)) out.push({ kind: 'oddity', o });
    }
    return out;
  }, [payload]);

  const pages = Math.max(1, Math.ceil(cards.length / slots));

  // `page` is a dependency so manual navigation restarts the dwell timer
  // rather than flipping again a moment later.
  useEffect(() => {
    if (pages <= 1 || paused) return;
    const t = setTimeout(() => setPage((p) => (p + 1) % pages), ROTATE_MS);
    return () => clearTimeout(t);
  }, [pages, paused, page]);

  // Changing slot count changes the page count under us.
  useEffect(() => setPage(0), [slots]);

  const go = useCallback(
    (delta: number) => setPage((p) => (p + delta + pages) % pages),
    [pages],
  );

  // Wrap rather than slice: 22 cards over 4 slots would otherwise leave the
  // last page half empty, which reads as a broken layout.
  const shown = cards.length
    ? Array.from({ length: slots }, (_, i) => cards[(page * slots + i) % cards.length])
    : [];

  const clock = payload?.goalClock ?? [];
  const peak = Math.max(1, ...clock.map((b) => b.goals));
  const totalGoals = clock.reduce((n, b) => n + b.goals, 0);
  const cov = payload?.coverage;

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="panel-title">League Oddities</div>
        <div className="panel-note">
          {cov
            ? `${cov.analyzed}/${cov.finished} matches analysed · GW ${data.currentRound ?? '—'}`
            : 'Select a fixture above for match detail'}
        </div>
      </div>

      <div className="odd-body">
        <div
          className="odd-left"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
        >
          <div className="strip">
            <button
              className="nav prev"
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous stats"
            >
              ‹
            </button>

            {!payload ? (
              <div className="tiles">
                {Array.from({ length: slots }, (_, i) => (
                  <div className="tile" key={i}>
                    <div className="tile-l">{failed ? 'Unavailable' : 'Loading…'}</div>
                    <div className="tile-v skeleton">
                      <span className="n">—</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="tiles" key={page}>
                {shown.map((c, i) =>
                  c.kind === 'ref' ? (
                    <RefTile r={c.r} key={`ref-${c.r.id}-${i}`} />
                  ) : (
                    <OddityTile o={c.o} key={`${c.o.key}-${i}`} />
                  ),
                )}
              </div>
            )}

            <button
              className="nav next"
              type="button"
              onClick={() => go(1)}
              aria-label="Next stats"
            >
              ›
            </button>
          </div>

          <div className={`progress${paused ? ' paused' : ''}`}>
            <i style={{ width: `${((page + 1) / pages) * 100}%` }} />
          </div>
        </div>

        {clock.length > 0 && totalGoals > 0 ? (
          <GoalClock clock={clock} total={totalGoals} compact={slots <= 2} />
        ) : (
          <aside className="clockw">
            <div className="clockw-head">
              <span className="clockw-t">Goal clock</span>
            </div>
            <div className="empty-state">Building…</div>
          </aside>
        )}
      </div>
    </section>
  );
}
