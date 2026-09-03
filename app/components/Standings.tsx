'use client';

import type { Dashboard } from '@/lib/types';
import { Crest } from './ui';

export default function Standings({ data }: { data: Dashboard }) {
  return (
    <section className="panel standings-panel">
      <div className="panel-head">
        <div className="panel-title">Table</div>
        <div className="panel-note">{data.season}</div>
      </div>

      <div className="table-scroll">
        <table className="standings">
          <thead>
            <tr>
              <th className="pos">#</th>
              <th className="team">Club</th>
              <th className="gp">Pl</th>
              <th className="wdl">W</th>
              <th className="wdl">D</th>
              <th className="wdl">L</th>
              <th>GD</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {data.table.map((r) => (
              <tr key={r.id}>
                <td className="pos">
                  {r.zoneColor && (
                    <span className="zone" style={{ background: r.zoneColor }} />
                  )}
                  {r.idx}
                </td>
                <td className="team">
                  <Crest id={r.id} alt="" />
                  {r.shortName}
                </td>
                <td className="gp">{r.played}</td>
                <td className="wdl">{r.wins}</td>
                <td className="wdl">{r.draws}</td>
                <td className="wdl">{r.losses}</td>
                <td
                  className={`gd ${r.goalConDiff > 0 ? 'pos-v' : r.goalConDiff < 0 ? 'neg-v' : ''}`}
                >
                  {r.goalConDiff > 0 ? `+${r.goalConDiff}` : r.goalConDiff}
                </td>
                <td className="pts">{r.pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.legend.length > 0 && (
        <div className="legend">
          {data.legend.map((l) => (
            <span key={l.title}>
              <i style={{ background: l.color }} />
              {l.title}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
