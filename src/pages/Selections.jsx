import { useEffect, useState } from 'react'
import { initials, ordinal, normalizeDeclaration } from '../engine/keeper.js'
import { firebaseEnabled, loadPublishedDeclarations } from '../firebase.js'

/**
 * Can this keeper be kept AGAIN the following season?
 * Blocked by rule 3 (2 service years used) or by having reached the 1st-round
 * maximum (rule 5). Rule 6 overrides both: an end-of-season IR year doesn't
 * count, so those players stay keepable.
 */
function maxedOut(k) {
  return !k.ir && (k.f1 === true || (k.sv ?? 0) >= 2)
}

export default function Selections({ data, published = null }) {
  const years = Object.keys(data.history).sort((a, b) => b - a)
  const planning = String(data.meta.season)
  // Land on the current season once its keepers are official.
  const [year, setYear] = useState(published ? planning : years[0])

  const seasonData = year === planning ? null : data.history[year]
  const nextYear = Number(year) + 1
  const maxedCount = seasonData
    ? Object.values(seasonData).flat().filter(maxedOut).length
    : 0

  // Current season: show the commissioner's declarations once published.
  const [live, setLive] = useState(published ?? undefined) // undefined = loading, null = none
  useEffect(() => {
    if (year !== planning || !firebaseEnabled) { setLive(null); return }
    let cancelled = false
    loadPublishedDeclarations(planning)
      .then(d => { if (!cancelled) setLive(d) })
      .catch(() => { if (!cancelled) setLive(null) })
    return () => { cancelled = true }
  }, [year, planning])

  const liveTeams = live?.teams
    ? data.teamOrder
        .map(o => [o, normalizeDeclaration(live.teams[o], data.teams[o], data.meta.maxServiceYears)])
        .filter(([, ks]) => ks.length)
    : []

  return (
    <section className="view">
      <div className="section-head">
        <div>
          <div className="eyebrow">The archive</div>
          <h2>Keeper Selections</h2>
          <p className="lead">
            Who kept whom, season by season. {data.meta.firstSleeperSeason} is the
            first Sleeper season; earlier years are seeded from the league archive.
          </p>
        </div>
        <div className="filters" style={{ margin: 0 }}>
          <select value={year} onChange={e => setYear(e.target.value)} aria-label="Select season">
            <option value={planning}>
              {planning}{(live || published) ? ' — official keepers' : live === undefined ? '' : ' — not yet declared'}
            </option>
            {years.map(y => (
              <option key={y} value={y}>
                {y} season{Number(y) < data.meta.firstSleeperSeason ? ' — archive' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {year === planning && live === undefined && (
        <div className="card empty-state"><p>Loading {planning} declarations…</p></div>
      )}

      {year === planning && live === null && (
        <div className="card empty-state">
          <div className="big">🗓️</div>
          <h3 style={{ margin: '8px 0 4px' }}>{planning} keepers aren't declared yet</h3>
          <p>Declarations open one week before the {planning} draft.
            Head to <b>My Team</b> to plan your slate.</p>
        </div>
      )}

      {year === planning && live && (
        <>
          <div className="legend" style={{ borderColor: 'var(--accent)' }}>
            <span className="legend-swatch" style={{ background: 'var(--accent-soft)', boxShadow: 'inset 3px 0 0 var(--accent)', borderColor: 'var(--accent)' }} />
            <span>
              <b>Official {planning} keepers</b>, posted by the commissioner
              {live.publishedAt && ` on ${new Date(live.publishedAt).toLocaleDateString()}`}.
              The round shown is what each keeper costs in the {planning} draft.
            </span>
          </div>
          {liveTeams.length === 0 ? (
            <div className="card empty-state"><p>No teams have declared yet.</p></div>
          ) : (
            <div className="sel-grid">
              {liveTeams.map(([owner, keepers]) => (
                <div className="card team-card" key={owner}>
                  <h3><span className="av">{initials(owner)}</span>{owner}</h3>
                  {keepers.map((k, i) => (
                    <div className="krow" key={i}>
                      {k.pos && <span className="pos" data-p={k.pos}>{k.pos}</span>}
                      <span className="kn">
                        <span className="pn" title={k.name}>{k.name}</span>
                        {k.ir && <span className="pill info tiny" title="On IR — this year does not count (rule 6)">IR</span>}
                        {k.lastYear ? (
                          <span className="pill bad tiny" title={`Cannot be kept again in ${Number(planning) + 1}`}>final yr</span>
                        ) : (
                          <small title={`Can be kept ${k.yearsLeft} more time${k.yearsLeft === 1 ? '' : 's'} after ${planning}`}>
                            {k.yearsLeft} left
                          </small>
                        )}
                        {k.adjusted && (
                          <span className="pill gold tiny" title={`Commissioner adjusted from ${k.autoRound != null ? ordinal(k.autoRound) : 'auto'}`}>adj</span>
                        )}
                      </span>
                      <span className="kr">{k.round != null ? <><small>R</small>{k.round}</> : '—'}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {seasonData && (
        <>
          <div className="legend">
            <span className="legend-swatch" />
            <span>
              Highlighted = <b>could not be kept in {nextYear}</b> — the keeper
              limit was reached ({maxedCount} of {Object.values(seasonData).flat().length} that season).
              Players on IR are exempt (rule 6) and stay keepable.
            </span>
          </div>
          <div className="sel-grid">
            {Object.entries(seasonData).map(([owner, keepers]) => (
              <div className="card team-card" key={owner}>
                <h3><span className="av">{initials(owner)}</span>{owner}</h3>
                {keepers.map((k, i) => {
                  const maxed = maxedOut(k)
                  return (
                    <div className={`krow${maxed ? ' maxed' : ''}`} key={i}
                      title={maxed
                        ? `Could not be kept in ${nextYear} — ${k.f1 ? 'reached the 1st-round maximum' : `kept ${k.sv} years`}`
                        : undefined}>
                      {k.pos && <span className="pos" data-p={k.pos}>{k.pos}</span>}
                      <span className="kn">
                        <span className="pn" title={k.p}>{k.p}</span>
                        {k.ir && <span className="pill info tiny" title="On IR — year doesn't count (rule 6)">IR</span>}
                        {maxed && (
                          <span className="pill bad tiny">{k.f1 ? '1st max' : 'maxed'}</span>
                        )}
                        {k.sv != null && (
                          <small title={`${k.sv} service year${k.sv === 1 ? '' : 's'} used`}>{k.sv}y</small>
                        )}
                      </span>
                      <span className="kr">{k.rd != null ? <><small>R</small>{k.rd}</> : '—'}</span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
