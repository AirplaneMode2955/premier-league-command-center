'use client';

import type { Match } from '@/lib/types';
import { isLive, kickoff } from '@/lib/normalize';

export function crest(teamId: string | number | null | undefined) {
  return `https://images.fotmob.com/image_resources/logo/teamlogo/${teamId}_small.png`;
}

export function Crest({ id, alt }: { id: string | number | null | undefined; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={crest(id)} alt={alt} loading="lazy" decoding="async" />;
}

/** "3 - 1" -> ["3", "1"]; anything unparseable -> null. */
export function splitScore(s: string | null | undefined): [string, string] | null {
  if (!s) return null;
  const parts = s.split('-').map((p) => p.trim());
  return parts.length === 2 ? [parts[0], parts[1]] : null;
}

export function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  const tomorrow = new Date(today.getTime() + 86_400_000);
  if (same(d, tomorrow)) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

function liveMinute(m: Match) {
  const lt = m.status.liveTime;
  if (lt?.short) return lt.short;
  if (typeof lt?.minute === 'number') return `${lt.minute}'`;
  // FotMob occasionally omits liveTime early in a half; derive from kickoff.
  const mins = Math.floor((Date.now() - kickoff(m)) / 60_000);
  return mins >= 0 && mins < 140 ? `${mins}'` : 'LIVE';
}

export function MatchCard({
  match,
  selected,
  onSelect,
}: {
  match: Match;
  selected?: boolean;
  onSelect?: (m: Match) => void;
}) {
  const live = isLive(match);
  const done = Boolean(match.status.finished);
  const score = splitScore(match.status.scoreStr);
  const cancelled = Boolean(match.status.cancelled);

  const [hs, as] = score ?? ['', ''];
  const hn = Number(hs);
  const an = Number(as);
  const homeLost = done && Number.isFinite(hn) && Number.isFinite(an) && hn < an;
  const awayLost = done && Number.isFinite(hn) && Number.isFinite(an) && an < hn;

  const clickable = Boolean(onSelect);
  const Tag = clickable ? 'button' : 'div';

  return (
    <Tag
      className={[
        'card',
        live ? 'live' : '',
        clickable ? 'clickable' : '',
        selected ? 'selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={clickable ? () => onSelect!(match) : undefined}
      type={clickable ? 'button' : undefined}
      aria-label={`${match.home.name} versus ${match.away.name}`}
    >
      <div className="card-top">
        <span>{dayLabel(match.status.utcTime)}</span>
        {cancelled ? (
          <span className="ft-tag">{match.status.reason?.short ?? 'OFF'}</span>
        ) : live ? (
          <span className="live-tag">
            <i className="dot" />
            {liveMinute(match)}
          </span>
        ) : done ? (
          <span className="ft-tag">{match.status.reason?.short ?? 'FT'}</span>
        ) : (
          <span>{clockTime(match.status.utcTime)}</span>
        )}
      </div>

      <div className={`side${homeLost ? ' faded' : ''}`}>
        <Crest id={match.home.id} alt="" />
        <span className="nm">{match.home.shortName || match.home.name}</span>
        {score && <span className="sc">{hs}</span>}
      </div>

      <div className={`side${awayLost ? ' faded' : ''}`}>
        <Crest id={match.away.id} alt="" />
        <span className="nm">{match.away.shortName || match.away.name}</span>
        {score && <span className="sc">{as}</span>}
      </div>

      {!score && <div className="card-time">{clockTime(match.status.utcTime)} KO</div>}
    </Tag>
  );
}
