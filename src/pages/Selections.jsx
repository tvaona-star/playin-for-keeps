import { useState } from 'react'
import { initials } from '../engine/keeper.js'

export default function Selections({ data }) {
  const years = Object.keys(data.history).sort((a, b) => b - a)
  const planning = String(data.meta.season)
  const [year, setYear] = useState(years[0])

  const seasonData = year === planning ? null : data.history[year]

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
            <option value={planning}>{planning} — not yet declared</option>
            {years.map(y => (
              <option key={y} value={y}>
                {y} season{Number(y) < data.meta.firstSleeperSeason ? ' — archive' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {year === planning && (
        <div className="card empty-state">
          <div className="big">🗓️</div>
          <h3 style={{ margin: '8px 0 4px' }}>{planning} keepers aren't declared yet</h3>
          <p>Declarations open one week before the {planning} draft.
            Head to <b>My Team</b> to plan your slate.</p>
        </div>
      )}

      {seasonData && (
        <div className="sel-grid">
          {Object.entries(seasonData).map(([owner, keepers]) => (
            <div className="card team-card" key={owner}>
              <h3><span className="av">{initials(owner)}</span>{owner}</h3>
              {keepers.map((k, i) => (
                <div className="krow" key={i}>
                  {k.pos && <span className="pos" data-p={k.pos}>{k.pos}</span>}
                  <span className="kn">
                    {k.p}
                    {k.ir && <span className="pill info" style={{ fontSize: 9.5, padding: '1px 6px', marginLeft: 5 }}>IR</span>}
                    {k.f1 && <span className="pill bad" style={{ fontSize: 9.5, padding: '1px 6px', marginLeft: 5 }}>1st · max</span>}
                    {k.sv != null && <small> · {k.sv} yr{k.sv === 1 ? '' : 's'}</small>}
                  </span>
                  <span className="kr">{k.rd != null ? <><small>R</small>{k.rd}</> : '—'}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
