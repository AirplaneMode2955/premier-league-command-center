'use client';

import { useEffect, useState } from 'react';
import type { Match, MatchDetail as Detail } from '@/lib/types';
import { isLive } from '@/lib/normalize';
import { Crest, splitScore } from './ui';

const EVENT_ICON: Record<string, string> = {
  Goal: '⚽',
  AttemptSaved: '○',
  Penalty: '⚽',
  Card: '▮',
  Substitution: '⇆',
};

function eventIcon(type: string, ownGoal: boolean) {
  if (ownGoal) return '⚽';
  return EVENT_ICON[type] ?? '•';
}

export default function MatchDetail({
  match,
  onClose,
}: {
  match: Match;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);

    async function load() {
      try {
        const res = await fetch(`/api/fotmob/match/${match.id}`);
        const json = await res.json();
        if (cancelled) return;
        if (!json.ok) throw new Error(json.error ?? 'request failed');
        setDetail(json.data);
        setStale(Boolean(json.stale));
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed');
      }
    }

    load();
    // A finished match will never change again; only poll while it's running.
    if (!isLive(match)) return () => { cancelled = true; };
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [match]);

  const score = splitScore(detail?.scoreStr ?? match.status.scoreStr);
  const poss = detail?.possession;

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="panel-title">
          Match Detail
          {stale && <span className="panel-note">/ cached</span>}
        </div>
        <button className="btn" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="detail-body">
        <div className="detail-score">
          <div className="t">
            <Crest id={match.home.id} alt="" />
            <span>{match.home.shortName || match.home.name}</span>
          </div>
          <div className="num">{score ? `${score[0]} - ${score[1]}` : 'vs'}</div>
          <div className="t">
            <span>{match.away.shortName || match.away.name}</span>
            <Crest id={match.away.id} alt="" />
          </div>
        </div>

        {error && !detail && <div className="error-note">Detail unavailable: {error}</div>}
        {!error && !detail && <div className="panel-note">Loading match data…</div>}

        {poss && (
          <div className="poss-bar">
            <div className="poss-track">
              <i style={{ width: `${poss.home}%`, background: 'var(--accent)' }} />
              <i style={{ width: `${poss.away}%`, background: 'var(--dim-2)' }} />
            </div>
            <div className="poss-legend">
              <span>{poss.home}% possession</span>
              <span>{poss.away}%</span>
            </div>
          </div>
        )}

        {detail && detail.stats.length > 0 && (
          <div className="stat-grid">
            {detail.stats.map((s) => (
              <div className="stat-row" key={s.key}>
                <span className="v">{s.home}</span>
                <span className="lbl">{s.title}</span>
                <span className="v r">{s.away}</span>
              </div>
            ))}
          </div>
        )}

        {detail && detail.events.length > 0 && (
          <div className="events">
            <div className="panel-note">Key events</div>
            {detail.events.map((e, i) => (
              <div className={`event${e.isHome ? ' home' : ''}`} key={`${e.minute}-${i}`}>
                <span className="min">{e.minute != null ? `${e.minute}'` : '—'}</span>
                <span className="ic">{eventIcon(e.type, e.ownGoal)}</span>
                <span className="nm">
                  {e.player ?? e.type}
                  {e.ownGoal ? ' (OG)' : ''}
                  {e.score ? ` · ${e.score}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}

        {detail && detail.stats.length === 0 && detail.events.length === 0 && (
          <div className="panel-note">No stats published for this fixture yet.</div>
        )}
      </div>
    </section>
  );
}
