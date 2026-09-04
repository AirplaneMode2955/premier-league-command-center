'use client';

import { useEffect, useMemo, useState } from 'react';
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

const VISIBLE = 4;
const ROTATE_MS = 8000;
/** Steady-state poll once the season is fully analysed. */
const POLL_MS = 300_000;
/** While the server is still filling its per-match cache, chase it. */
const CATCHUP_MS = 8_000;

function OddityTile({ o }: { o: Oddity }) {
  return (
    <div className="tile" key={o.key}>
      <div className="tile-l">{o.label}</div>
      <div className="tile-v">
        {o.value}
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
    <div className="tile">
      <div className="tile-l">Card-happiest referee</div>
      <div className="tile-v">
        {r.perMatch.toFixed(1)}
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
 * The league's odd corners: rotating leaderboards plus a goal clock showing
 * when goals actually get scored. Doubles as the resting state of the pane
 * the match-detail panel takes over.
 */
export default function SeasonSignal({ data }: { data: Dashboard }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [page, setPage] = useState(0);
  const [failed, setFailed] = useState(false);

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

  // One card per rotation slot: the oddities, with the referee folded in.
  const cards = useMemo(() => {
    if (!payload) return [];
    const list: ({ kind: 'oddity'; o: Oddity } | { kind: 'ref'; r: Referee })[] =
      payload.oddities.map((o) => ({ kind: 'oddity' as const, o }));
    const topRef = payload.referees[0];
    // Slot the referee a little way in so it isn't always on the first page.
    if (topRef) list.splice(Math.min(6, list.length), 0, { kind: 'ref', r: topRef });
    return list;
  }, [payload]);

  const pages = Math.max(1, Math.ceil(cards.length / VISIBLE));

  useEffect(() => {
    if (pages <= 1) return;
    const t = setInterval(() => setPage((p) => (p + 1) % pages), ROTATE_MS);
    return () => clearInterval(t);
  }, [pages]);

  // Wrap rather than slice: 22 cards over 4 slots would otherwise leave the
  // last page half empty, which reads as a broken layout.
  const shown = cards.length
    ? Array.from({ length: VISIBLE }, (_, i) => cards[(page * VISIBLE + i) % cards.length])
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

      {!payload ? (
        <div className="tiles">
          {Array.from({ length: VISIBLE }, (_, i) => (
            <div className="tile" key={i}>
              <div className="tile-l">{failed ? 'Unavailable' : 'Loading…'}</div>
              <div className="tile-v skeleton">—</div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="tiles" key={page}>
            {shown.map((c, i) =>
              c.kind === 'ref' ? (
                <RefTile r={c.r} key={`ref-${c.r.id}-${i}`} />
              ) : (
                <OddityTile o={c.o} key={`${c.o.key}-${i}`} />
              ),
            )}
          </div>
          {pages > 1 && (
            <div className="pager">
              {Array.from({ length: pages }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  className={`pip${i === page ? ' on' : ''}`}
                  onClick={() => setPage(i)}
                  aria-label={`Show oddities page ${i + 1}`}
                />
              ))}
            </div>
          )}
        </>
      )}

      {clock.length > 0 && totalGoals > 0 ? (
        <>
          <div className="signal">
            {clock.map((b, i) => (
              <i
                key={b.label}
                className={b.goals === peak ? 'cur' : ''}
                style={{
                  height: `${Math.max(6, (b.goals / peak) * 100)}%`,
                  animationDelay: `${Math.min(i * 22, 500)}ms`,
                }}
                title={`${b.label} min — ${b.goals} goals`}
              />
            ))}
          </div>
          <div className="signal-foot">
            <span>1&apos; kickoff</span>
            <span>
              Goal clock · {totalGoals} goals · busiest {clock.find((b) => b.goals === peak)?.label}&apos;
            </span>
            <span>90+&apos; stoppage</span>
          </div>
        </>
      ) : (
        <div className="empty-state">Goal clock building…</div>
      )}
    </section>
  );
}
