'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dashboard as Data, Match } from '@/lib/types';
import { kickoff } from '@/lib/normalize';
import { Crest, MatchCard, clockTime, dayLabel } from './ui';
import Standings from './Standings';
import SeasonSignal from './SeasonSignal';
import MatchDetail from './MatchDetail';

const POLL_MS = 60_000;

function RefreshIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function useTick(ms: number) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function countdown(target: number, now: number) {
  const left = Math.max(0, target - now);
  const d = Math.floor(left / 86_400_000);
  const h = Math.floor((left % 86_400_000) / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export default function Dashboard({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [selected, setSelected] = useState<Match | null>(null);
  const [mounted, setMounted] = useState(false);

  // One second tick drives the wall clock and the kickoff countdown.
  useTick(1000);
  useEffect(() => setMounted(true), []);

  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const res = await fetch('/api/fotmob/league', { cache: 'no-store' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json.data);
      // `stale` from the proxy means it served its last-good copy after an
      // upstream failure — surface that rather than pretending it's fresh.
      setStale(Boolean(json.stale));
      if (!json.stale) setSyncedAt(Date.now());
      setError(null);
    } catch (err) {
      // Keep whatever is on screen; just mark it as no longer trustworthy.
      setStale(true);
      setError(err instanceof Error ? err.message : 'network error');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // Keep the open detail panel pointed at the freshest copy of its match.
  useEffect(() => {
    if (!selected || !data) return;
    const fresh = [...data.roundMatches, ...data.recentResults].find(
      (m) => m.id === selected.id,
    );
    if (fresh && fresh.status.scoreStr !== selected.status.scoreStr) setSelected(fresh);
  }, [data, selected]);

  const now = Date.now();
  const live = data?.liveMatches ?? [];

  const next = useMemo(() => {
    if (!data?.nextMatch) return null;
    return { match: data.nextMatch, at: kickoff(data.nextMatch) };
  }, [data]);

  if (!mounted || (!data && !error)) {
    return (
      <div className="boot">
        <div className="bars">
          <i /><i /><i /><i /><i />
        </div>
        Acquiring signal
      </div>
    );
  }

  if (!data) {
    return (
      <div className="boot">
        <div className="bars">
          <i /><i /><i /><i /><i />
        </div>
        Signal lost
        <div className="error-note">{error}</div>
        <button className="btn" type="button" onClick={load}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="header">
        <div className="brand">
          <div className="brand-mark">
            {data.leagueName} <span>Command Center</span>
          </div>
          <div className="brand-sub">Live · {data.season}</div>
        </div>

        <div className="spacer" />

        {live.length > 0 && (
          <div className="chip chip-live">
            <i className="dot" />
            Live · {live.length}
          </div>
        )}

        {stale && (
          <div className="chip chip-stale" title={error ?? 'Serving cached data'}>
            Stale data
          </div>
        )}

        {data.currentRound && (
          <div className="chip chip-accent">
            Gameweek <strong>{data.currentRound}</strong>
          </div>
        )}

        <div className="chip">
          Synced{' '}
          <strong>{syncedAt ? new Date(syncedAt).toLocaleTimeString() : '—'}</strong>
        </div>

        <div className="clock">{new Date(now).toLocaleTimeString()}</div>

        <button
          className={`btn${busy ? ' busy' : ''}`}
          type="button"
          onClick={load}
          disabled={busy}
        >
          <RefreshIcon />
          {busy ? 'Syncing' : 'Refresh'}
        </button>
      </header>

      {next ? (
        <div className="kickoff">
          <span className="kickoff-label">Next Kickoff</span>
          <div className="kickoff-teams">
            <Crest id={next.match.home.id} alt="" />
            <span>{next.match.home.shortName || next.match.home.name}</span>
            <span className="vs">vs</span>
            <Crest id={next.match.away.id} alt="" />
            <span>{next.match.away.shortName || next.match.away.name}</span>
          </div>
          <div className="spacer" />
          <span className="panel-note">
            {dayLabel(next.match.status.utcTime)} · {clockTime(next.match.status.utcTime)}
          </span>
          <div className="countdown">
            {countdown(next.at, now)}
            <small>to kickoff</small>
          </div>
        </div>
      ) : (
        <div className="kickoff">
          <span className="kickoff-label">Next Kickoff</span>
          <span className="panel-note">No scheduled fixtures remaining</span>
        </div>
      )}

      <div className="main">
        <div className="col col-left">
          <section className="panel">
            <div className="panel-head">
              <div className="panel-title">
                This Gameweek {data.currentRound && `· GW ${data.currentRound}`}
              </div>
              <div className="panel-note">
                {data.roundMatches.length} fixtures · click for detail
              </div>
            </div>
            {data.roundMatches.length === 0 ? (
              <div className="rail-empty">No fixtures in this round</div>
            ) : (
              <div className="rail">
                {data.roundMatches.map((m) => (
                  <MatchCard
                    key={m.id}
                    match={m}
                    selected={selected?.id === m.id}
                    onSelect={setSelected}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <div className="panel-title">Recent Results</div>
              <div className="panel-note">Last {data.recentResults.length} league-wide</div>
            </div>
            {data.recentResults.length === 0 ? (
              <div className="rail-empty">No results yet this season</div>
            ) : (
              <div className="rail">
                {data.recentResults.map((m) => (
                  <MatchCard
                    key={m.id}
                    match={m}
                    selected={selected?.id === m.id}
                    onSelect={setSelected}
                  />
                ))}
              </div>
            )}
          </section>

          {selected ? (
            <MatchDetail match={selected} onClose={() => setSelected(null)} />
          ) : (
            <SeasonSignal data={data} />
          )}
        </div>

        <div className="col">
          <Standings data={data} />
        </div>
      </div>
    </div>
  );
}
