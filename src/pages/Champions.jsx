export default function Champions({ data }) {
  const champs = data.champions
  const first = data.meta.firstSleeperSeason

  // All-time counts; ties break by most recent title.
  const agg = {}
  champs.forEach(c => {
    agg[c.champion] = agg[c.champion] || { n: 0, latest: 0 }
    agg[c.champion].n++
    agg[c.champion].latest = Math.max(agg[c.champion].latest, c.year)
  })
  const leaderboard = Object.entries(agg)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.n - a.n || b.latest - a.latest)

  return (
    <section className="view">
      <div className="section-head">
        <div>
          <div className="eyebrow">{champs.length} seasons of glory</div>
          <h2>Champions &amp; Records</h2>
          <p className="lead">
            The full title history since the league's founding in {data.meta.founded}.
            All-time counts break ties by most recent championship.
          </p>
        </div>
      </div>
      <div className="champ-grid">
        <div className="card">
          <div className="timeline">
            {champs.map(c => (
              <div className={`tl-row${c.year < first ? ' era' : ''}`} key={c.year}>
                <div className="tl-year">
                  {c.year}
                  <small>{c.year < first ? 'pre-sleeper' : 'sleeper'}</small>
                </div>
                <div className="tl-champ">
                  <b>{c.champion}</b>
                  <small>{c.accolades}</small>
                </div>
                <div className="trophy">🏆</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="eyebrow" style={{ margin: '2px 0 9px' }}>All-time titles</div>
          <div className="card" style={{ padding: 7 }}>
            {leaderboard.map((p, i) => (
              <div className="lb-row" key={p.name}>
                <span className="lb-rank">{i + 1}</span>
                <span className="lb-name">{p.name}<small>last title {p.latest}</small></span>
                <span className="lb-rings">{'🏆'.repeat(p.n)}</span>
                <span className="lb-count">{p.n}</span>
              </div>
            ))}
          </div>
          <div className="footnote" style={{ marginTop: 14 }}>
            {data.meta.founded}–{first - 1} seeded from the league archive;{' '}
            {first} onward confirmed from Sleeper brackets.
          </div>
        </div>
      </div>
    </section>
  )
}
