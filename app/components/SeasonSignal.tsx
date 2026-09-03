'use client';

import type { Dashboard } from '@/lib/types';

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile">
      <div className="tile-v">{value}</div>
      <div className="tile-l">{label}</div>
    </div>
  );
}

/**
 * League pulse + goals per completed gameweek as a waveform. Doubles as the
 * resting state of the pane the match-detail panel takes over.
 */
export default function SeasonSignal({ data }: { data: Dashboard }) {
  const bars = data.goalsByRound;
  const peak = Math.max(1, ...bars.map((b) => b.goals));
  const goals = bars.reduce((n, b) => n + b.goals, 0);
  const played = bars.reduce((n, b) => n + b.played, 0);
  const avg = played ? (goals / played).toFixed(2) : '0.00';
  const leader = data.table[0];

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="panel-title">Season Signal</div>
        <div className="panel-note">
          Select a fixture above for match detail
        </div>
      </div>

      <div className="tiles">
        <Tile label="Matches played" value={String(played)} />
        <Tile label="Goals scored" value={String(goals)} />
        <Tile label="Goals / match" value={avg} />
        <Tile
          label={leader ? 'Leader' : 'Live now'}
          value={leader ? `${leader.shortName} · ${leader.pts}` : String(data.liveMatches.length)}
        />
      </div>

      {bars.length === 0 ? (
        <div className="empty-state">No completed gameweeks yet</div>
      ) : (
        <>
          <div className="signal">
            {bars.map((b, i) => (
              <i
                key={b.round}
                className={b.round === data.currentRound ? 'cur' : ''}
                style={{
                  height: `${Math.max(8, (b.goals / peak) * 100)}%`,
                  animationDelay: `${Math.min(i * 22, 600)}ms`,
                }}
                title={`GW ${b.round} — ${b.goals} goals in ${b.played} matches`}
              />
            ))}
          </div>
          <div className="signal-foot">
            <span>GW {bars[0].round}</span>
            <span>Goals per gameweek · peak {peak}</span>
            <span>GW {bars[bars.length - 1].round}</span>
          </div>
        </>
      )}
    </section>
  );
}
