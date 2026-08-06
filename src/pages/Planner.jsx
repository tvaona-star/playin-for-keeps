import { useMemo, useState } from 'react'
import { evaluateSlate, ordinal, MAX_KEEPERS, MIN_KEEPERS } from '../engine/keeper.js'

const GROUPS = [['ST', 'Starters'], ['BN', 'Bench'], ['IR', 'Injured Reserve']]

function PosChip({ p }) {
  return <span className="pos" data-p={p}>{p}</span>
}

export default function Planner({ data }) {
  const [teamName, setTeamName] = useState(data.teamOrder[0])
  const [selected, setSelected] = useState(new Set())
  const [toast, setToast] = useState('')

  const team = data.teams[teamName]
  const chosen = useMemo(
    () => team.players.filter(p => selected.has(p.n)),
    [team, selected]
  )
  const { assignments, notes } = useMemo(
    () => evaluateSlate(chosen, team),
    [chosen, team]
  )

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }

  const switchTeam = (name) => {
    setTeamName(name)
    setSelected(new Set())
  }

  const toggle = (p) => {
    if (p.elig !== 'ok') return
    if (!selected.has(p.n) && selected.size >= MAX_KEEPERS) {
      showToast(`Keeper limit is ${MAX_KEEPERS} — drop one before adding another.`)
      return
    }
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(p.n)) next.delete(p.n)
      else if (next.size < MAX_KEEPERS) next.add(p.n)
      return next
    })
  }

  const usedRounds = {}
  assignments.forEach(a => { if (!a.invalid) usedRounds[a.round] = a })
  const validCount = assignments.filter(a => !a.invalid).length

  return (
    <section className="view">
      <div className="section-head">
        <div>
          <div className="eyebrow">Your keeper war room · live rosters</div>
          <h2>Keeper Planner</h2>
          <p className="lead">
            Tap players to lock them in. The slip applies the same-round bump rule,
            checks you actually own the draft pick, and totals your keeper capital.
            Costs and eligibility recompute daily from Sleeper.
          </p>
        </div>
        <div className="filters" style={{ margin: 0 }}>
          <select value={teamName} onChange={e => switchTeam(e.target.value)} aria-label="Select team">
            {data.teamOrder.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      <div className="planner">
        <div>
          {GROUPS.map(([g, label]) => {
            const players = team.players.filter(p => p.grp === g)
            if (!players.length) return null
            return (
              <div className="rgroup" key={g}>
                <h3>{label}</h3>
                <div className="plist">
                  {players.map(p => (
                    <button key={p.n} className="prow"
                      data-sel={selected.has(p.n)} data-elig={p.elig}
                      onClick={() => toggle(p)} disabled={p.elig !== 'ok'}>
                      <span className="check">✓</span>
                      <PosChip p={p.pos} />
                      <span className="pname">
                        {p.n}
                        {(p.why || p.finalYear) && (
                          <small>{p.why || 'Final year if kept'}</small>
                        )}
                      </span>
                      {p.cost == null
                        ? <span className="kc na">Not eligible</span>
                        : <span className="kc">
                            {ordinal(p.cost)}
                            {p.ir ? <span className="tag-ir"> ·IR</span> : p.fa ? <span className="tag-fa"> ·FA</span> : null}
                            <small>keeps at</small>
                          </span>}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        <aside className="slip">
          <div className="card">
            <h3>Keeper Slip <span className="count">{selected.size} / {MAX_KEEPERS}</span></h3>
            <div>
              {selected.size === 0 && (
                <div className="slot empty">Tap players to build your keeper slate →</div>
              )}
              {[...assignments].sort((a, b) => a.round - b.round).map(a => (
                <div className="slot" key={a.p.n}>
                  <PosChip p={a.p.pos} />
                  <span className="sn">
                    <b>{a.p.n}</b>
                    {a.bumped && !a.invalid
                      ? <small>bumped up — same-round rule</small>
                      : a.p.ir ? <small>IR — no penalty</small>
                      : a.p.fa ? <small>FA — 9th-round cost</small> : null}
                  </span>
                  <span className="rd">
                    {a.invalid
                      ? <span style={{ color: 'var(--bad)' }}>✕ over</span>
                      : a.bumped
                        ? <><s>{ordinal(a.p.cost)}</s> {ordinal(a.round)}</>
                        : ordinal(a.round)}
                  </span>
                </div>
              ))}
            </div>
            <div className="total">
              <span className="t-lbl">Draft capital spent</span>
              <span className="t-val">
                {selected.size ? `${validCount} pick${validCount === 1 ? '' : 's'}` : '—'}
              </span>
            </div>
            <div className="notes">
              {notes.map((n, i) => (
                <div className={`note ${n.kind}`} key={i}>
                  <span className="ico">{n.kind === 'ok' ? '✓' : n.kind === 'warn' ? '✕' : 'i'}</span>
                  <span>{n.text}</span>
                </div>
              ))}
            </div>
            <button className="declare"
              onClick={() => showToast(selected.size < MIN_KEEPERS
                ? `Pick at least ${MIN_KEEPERS} keepers first.`
                : 'Declarations are recorded by the commissioner for now.')}>
              Submit these keepers
            </button>
            <p className="declare-hint">
              Phase 1: declarations are entered by the commissioner.
              Phase 2 lets each manager submit their own.
            </p>
          </div>

          <div className="card capital" style={{ padding: 17 }}>
            <h4>{data.meta.season} draft picks</h4>
            <div className="rounds">
              {Array.from({ length: team.rounds }, (_, i) => i + 1).map(r => {
                const picks = team.cap[r] || []
                const used = usedRounds[r]
                const title = picks.length
                  ? `Round ${r}: ${picks.map(p => p.label + (p.self ? '' : ` (from ${p.name})`)).join(', ')}${used ? ` — used by ${used.p.n}` : ''}`
                  : `Round ${r}: no pick (traded away)`
                return (
                  <div key={r} title={title}
                    className={`rd-chip${picks.length ? '' : ' missing'}${used ? ' used' : ''}`}>
                    <span className="rn">R{r}</span>
                    <span className="ogs">
                      {picks.length
                        ? picks.map((p, i) => (
                            <span key={i} className={`og${p.self ? '' : ' acq'}`}>
                              {p.label}{p.self ? '' : ` ‹${p.o}`}
                            </span>
                          ))
                        : <span className="og none">no pick</span>}
                    </span>
                    {picks.length > 1 && <span className="cnt">{picks.length}</span>}
                  </div>
                )
              })}
            </div>
            <div className="cap-legend">
              <span><i className="sw" style={{ background: 'var(--accent)' }} />Used by keeper</span>
              <span><b style={{ color: 'var(--gold)', fontSize: 11 }}>‹AB</b> acquired</span>
            </div>
            <p style={{ fontSize: 11, color: 'var(--ink-3)', margin: '9px 0 0' }}>
              Exact pick shown as round.pick (e.g. 2.04). Rounds with two picks list
              both; gold marks a pick acquired by trade.
            </p>
          </div>
        </aside>
      </div>
      <div className={`toast${toast ? ' show' : ''}`}>{toast}</div>
    </section>
  )
}
