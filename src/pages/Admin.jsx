import { useEffect, useMemo, useState } from 'react'
import {
  firebaseEnabled, signIn, signOutUser,
  loadDeclarations, saveTeamDeclaration, setPublishStatus,
} from '../firebase.js'
import { commissionerEmail } from '../firebase-config.js'
import { MIN_KEEPERS, MAX_KEEPERS, evaluateSlate, ordinal, keeperYearsLeft } from '../engine/keeper.js'

/** Read a team's saved keepers, tolerating the older array-of-names format. */
function readSaved(entry) {
  if (!entry) return []
  if (Array.isArray(entry)) return entry.map(name => ({ name, adjusted: false }))
  return entry.keepers || []
}

export default function Admin({ data }) {
  const [user, setUser] = useState(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  // owner -> [playerName]           selections
  const [sel, setSel] = useState({})
  // owner -> { playerName: round }  manual round adjustments
  const [ovr, setOvr] = useState({})
  // owner -> { playerName: boolean }  manual final-year overrides
  const [lastOvr, setLastOvr] = useState({})
  const [pubStatus, setPubStatus] = useState('draft')
  const [publishedAt, setPublishedAt] = useState(null)
  const [dirty, setDirty] = useState({})

  const season = data.meta.season
  const maxSv = data.meta.maxServiceYears ?? 2

  useEffect(() => {
    if (!user) return
    loadDeclarations(season).then(d => {
      const s = {}, o = {}, l = {}
      Object.entries(d.teams || {}).forEach(([owner, entry]) => {
        const keepers = readSaved(entry)
        s[owner] = keepers.map(k => k.name)
        keepers.forEach(k => {
          if (k.adjusted && k.round != null) (o[owner] = o[owner] || {})[k.name] = k.round
          if (k.lastYearAdjusted) (l[owner] = l[owner] || {})[k.name] = !!k.lastYear
        })
      })
      setSel(s); setOvr(o); setLastOvr(l)
      setPubStatus(d.status || 'draft')
      setPublishedAt(d.publishedAt || null)
    }).catch(e => setError(String(e.message || e)))
  }, [user, season])

  /** Auto rounds from the engine (penalties + same-round bumps), per team. */
  const computed = useMemo(() => {
    const out = {}
    data.teamOrder.forEach(owner => {
      const team = data.teams[owner]
      const names = sel[owner] || []
      const chosen = team.players.filter(p => names.includes(p.n))
      const result = evaluateSlate(chosen, team)
      const auto = {}
      result.assignments.forEach(a => { auto[a.p.n] = a.round })
      // final rounds = auto, unless the commissioner adjusted one
      const final = {}
      names.forEach(n => {
        const manual = ovr[owner]?.[n]
        final[n] = manual != null ? manual : auto[n]
      })
      // conflicts introduced by manual edits
      const counts = {}
      Object.values(final).forEach(r => { counts[r] = (counts[r] || 0) + 1 })
      const dupes = Object.keys(counts).filter(r => counts[r] > 1).map(Number)
      const noCapital = Object.entries(final)
        .filter(([, r]) => r != null && !(team.cap && team.cap[r]))
        .map(([n, r]) => ({ name: n, round: r }))
      // Rule 3 (service years) + rule 5 (kept at a 1st) decide whether a
      // keeper can be kept AGAIN next season. Rule 6 exempts IR players.
      const lastAuto = {}, lastFinal = {}, yearsLeft = {}
      names.forEach(n => {
        const p = team.players.find(x => x.n === n)
        const left = keeperYearsLeft(p, final[n], maxSv)
        const auto0 = left === 0
        lastAuto[n] = auto0
        const manual = lastOvr[owner]?.[n]
        lastFinal[n] = manual != null ? manual : auto0
        yearsLeft[n] = lastFinal[n] ? 0 : left
      })
      out[owner] = { team, auto, final, result, dupes, noCapital, names, lastAuto, lastFinal, yearsLeft }
    })
    return out
  }, [data, sel, ovr, lastOvr, maxSv])

  const toggle = (owner, name) => {
    setSel(prev => {
      const cur = prev[owner] || []
      const next = cur.includes(name)
        ? cur.filter(n => n !== name)
        : cur.length < MAX_KEEPERS ? [...cur, name] : cur
      return { ...prev, [owner]: next }
    })
    setOvr(prev => {
      const t = { ...(prev[owner] || {}) }; delete t[name]
      return { ...prev, [owner]: t }
    })
    setLastOvr(prev => {
      const t = { ...(prev[owner] || {}) }; delete t[name]
      return { ...prev, [owner]: t }
    })
    setDirty(d => ({ ...d, [owner]: true }))
  }

  const toggleLast = (owner, name, autoVal) => {
    setLastOvr(prev => {
      const t = { ...(prev[owner] || {}) }
      const cur = t[name] != null ? t[name] : autoVal
      if (!cur === autoVal) delete t[name]   // back to auto
      else t[name] = !cur
      return { ...prev, [owner]: t }
    })
    setDirty(d => ({ ...d, [owner]: true }))
  }

  const adjust = (owner, name, value) => {
    setOvr(prev => {
      const t = { ...(prev[owner] || {}) }
      if (value === '' || value == null) delete t[name]
      else t[name] = Math.max(1, Math.min(data.meta.rounds, Number(value)))
      return { ...prev, [owner]: t }
    })
    setDirty(d => ({ ...d, [owner]: true }))
  }

  const resetTeam = (owner) => {
    setOvr(prev => ({ ...prev, [owner]: {} }))
    setLastOvr(prev => ({ ...prev, [owner]: {} }))
    setDirty(d => ({ ...d, [owner]: true }))
  }

  const saveTeam = async (owner) => {
    const c = computed[owner]
    const keepers = c.names.map(n => {
      const p = c.team.players.find(x => x.n === n)
      const manual = ovr[owner]?.[n]
      return {
        name: n, pos: p?.pos || null,
        autoRound: c.auto[n] ?? null,
        round: c.final[n] ?? null,
        adjusted: manual != null,
        ir: !!p?.ir,
        lastYear: !!c.lastFinal[n],
        yearsLeft: c.yearsLeft[n] ?? 0,
        lastYearAdjusted: lastOvr[owner]?.[n] != null,
      }
    })
    setStatus(`Saving ${owner}…`)
    try {
      await saveTeamDeclaration(season, owner, keepers)
      setDirty(d => ({ ...d, [owner]: false }))
      setStatus(`${owner} saved ✓`)
    } catch (e) { setStatus(`Save failed: ${e.message}`) }
    setTimeout(() => setStatus(''), 2500)
  }

  const publish = async (next) => {
    const unsaved = Object.entries(dirty).filter(([, v]) => v).map(([k]) => k)
    if (next === 'published' && unsaved.length) {
      setStatus(`Save these teams first: ${unsaved.join(', ')}`)
      setTimeout(() => setStatus(''), 4000); return
    }
    setBusy(true)
    try {
      await setPublishStatus(season, next)
      setPubStatus(next)
      setPublishedAt(next === 'published' ? new Date().toISOString() : null)
      setStatus(next === 'published'
        ? `Published — the league can now see the ${season} keepers.`
        : 'Unpublished — hidden from the league again.')
    } catch (e) { setStatus(`Failed: ${e.message}`) }
    setBusy(false)
    setTimeout(() => setStatus(''), 4000)
  }

  const doSignIn = async (e) => {
    e.preventDefault(); setBusy(true); setError('')
    try { setUser(await signIn(commissionerEmail, password)) }
    catch (err) { setError('Sign-in failed — wrong password.'); console.error(err) }
    finally { setBusy(false) }
  }

  if (!firebaseEnabled) {
    return (
      <section className="view">
        <div className="section-head" style={{ justifyContent: 'center', textAlign: 'center' }}>
          <div><div className="eyebrow">Restricted</div><h2>Commissioner Console</h2></div>
        </div>
        <div className="admin-wrap">
          <div className="card" style={{ padding: 26 }}>
            <div className="lock">🔒</div>
            <h3 style={{ textAlign: 'center', marginBottom: 8 }}>Firebase not connected yet</h3>
            <p style={{ color: 'var(--ink-2)', fontSize: 13.5 }}>
              The console needs a Firebase project to store keeper declarations securely.
            </p>
          </div>
        </div>
      </section>
    )
  }

  if (!user) {
    return (
      <section className="view">
        <div className="section-head" style={{ justifyContent: 'center', textAlign: 'center' }}>
          <div><div className="eyebrow">Restricted</div><h2>Commissioner Console</h2></div>
        </div>
        <div className="admin-wrap">
          <form className="card" style={{ padding: 26 }} onSubmit={doSignIn}>
            <div className="lock">🔒</div>
            <p style={{ textAlign: 'center', color: 'var(--ink-2)', margin: '0 0 6px' }}>
              Enter the commissioner password to declare keepers and adjust rounds.
            </p>
            <label className="field">
              <span>Commissioner password</span>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                autoComplete="current-password" autoFocus required />
            </label>
            {error && <p style={{ color: 'var(--bad)', fontSize: 12.5 }}>{error}</p>}
            <button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            <p style={{ fontSize: 11.5, color: 'var(--ink-3)', textAlign: 'center', margin: '13px 0 0' }}>
              Secured by Firestore rules — writes are allowed only for the
              commissioner account. Everyone else browses read-only.
            </p>
          </form>
        </div>
      </section>
    )
  }

  const published = pubStatus === 'published'
  const totalDeclared = Object.values(sel).filter(v => v?.length).length
  const anyDirty = Object.values(dirty).some(Boolean)

  return (
    <section className="view">
      <div className="section-head" style={{ justifyContent: 'center', textAlign: 'center' }}>
        <div><div className="eyebrow">Restricted</div><h2>Commissioner Console</h2></div>
      </div>

      <div className="admin-body">
        <div className="filters" style={{ justifyContent: 'space-between' }}>
          <span className="pill good"><i className="dot" />Signed in as Commissioner</span>
          <button className="btn ghost" onClick={() => signOutUser().then(() => setUser(null))}>Sign out</button>
        </div>

        {/* Publish control */}
        <div className={`card publish-bar${published ? ' is-live' : ''}`}>
          <div className="pub-meta">
            <span className={`pill ${published ? 'good' : 'gold'}`}>
              <i className="dot" />{published ? 'Published — live to the league' : 'Draft — only you can see this'}
            </span>
            <p>
              {totalDeclared} of {data.teamOrder.length} teams have keepers declared for {season}.
              {published && publishedAt && ` Published ${new Date(publishedAt).toLocaleString()}.`}
              {anyDirty && ' You have unsaved team changes.'}
              {published && ' Edits stay open — saving a team updates the league view immediately.'}
            </p>
          </div>
          <button className="btn" disabled={busy} onClick={() => publish(published ? 'draft' : 'published')}>
            {published ? 'Unpublish' : `Publish ${season} keepers`}
          </button>
        </div>

        {status && <p className="admin-status">{status}</p>}

        <div className="subhead">
          Declare {season} keepers — {MIN_KEEPERS}–{MAX_KEEPERS} per team, rounds adjustable
        </div>

        <div className="admin-grid">
          {data.teamOrder.map(owner => {
            const c = computed[owner]
            const chosen = c.names
            const eligible = c.team.players.filter(p => p.elig === 'ok')
            const problems = [
              ...(chosen.length > 0 && chosen.length < MIN_KEEPERS ? [`Needs at least ${MIN_KEEPERS}`] : []),
              ...c.dupes.map(r => `Two keepers both at ${ordinal(r)}`),
              ...c.noCapital.map(x => `No ${ordinal(x.round)} pick for ${x.name}`),
              ...c.result.notes.filter(n => n.kind === 'warn' && !n.text.startsWith('Discipline')).map(n => n.text),
            ]
            return (
              <div className="card admin-team" key={owner}>
                <div className="at-head">
                  <b>{owner}</b>
                  <span className={`count${chosen.length > MAX_KEEPERS ? ' over' : ''}`}>
                    {chosen.length}/{MAX_KEEPERS}
                  </span>
                  {c.team.penalty && <span className="pill bad">−{c.team.penalty.rounds} rd</span>}
                  {dirty[owner] && <span className="pill gold">unsaved</span>}
                </div>

                {/* selected keepers with adjustable rounds */}
                {chosen.length > 0 && (
                  <div className="at-selected">
                    {chosen.map(n => {
                      const manual = ovr[owner]?.[n]
                      const auto = c.auto[n]
                      const isAdj = manual != null && manual !== auto
                      const last = c.lastFinal[n]
                      const lastAuto = c.lastAuto[n]
                      const lastAdj = (lastOvr[owner]?.[n]) != null
                      const kp = c.team.players.find(x => x.n === n)
                      return (
                        <div className="at-row" key={n}>
                          <span className="at-name">{n}</span>
                          <button type="button"
                            className={`lastyr${last ? ' is-last' : ''}${lastAdj ? ' is-manual' : ''}`}
                            onClick={() => toggleLast(owner, n, lastAuto)}
                            title={
                              (last
                                ? 'Cannot be kept again next season'
                                : 'Can be kept again next season') +
                              (kp?.ir ? ' — on IR, so this year does not count (rule 6)' : '') +
                              (lastAdj ? ' · manually set' : ` · auto (${lastAuto ? 'final year' : 'keepable'})`) +
                              ' — click to change'
                            }>
                            {last ? 'final yr' : `${c.yearsLeft[n] ?? 1} left`}
                          </button>
                          <span className="at-auto" title="Round calculated by the rules engine">
                            auto {auto != null ? ordinal(auto) : '—'}
                          </span>
                          <input className={`at-round${isAdj ? ' adjusted' : ''}`} type="number"
                            min={1} max={data.meta.rounds}
                            value={c.final[n] ?? ''}
                            onChange={e => adjust(owner, n, e.target.value)}
                            aria-label={`Round for ${n}`} />
                        </div>
                      )
                    })}
                    {c.names.some(n => c.lastFinal[n]) && (
                      <p className="at-lastnote">
                        Cannot be kept again in {season + 1}:{' '}
                        <b>{c.names.filter(n => c.lastFinal[n]).join(', ')}</b>
                      </p>
                    )}
                    {(Object.keys(ovr[owner] || {}).length > 0 || Object.keys(lastOvr[owner] || {}).length > 0) && (
                      <button className="linkish" onClick={() => resetTeam(owner)}>Reset to auto</button>
                    )}
                  </div>
                )}

                {problems.length > 0 && (
                  <div className="at-problems">
                    {problems.map((p, i) => <div key={i}>⚠ {p}</div>)}
                  </div>
                )}

                {/* eligible pool */}
                <details className="at-pool" open={chosen.length === 0}>
                  <summary>Eligible players ({eligible.length})</summary>
                  {eligible.map(p => (
                    <label className="at-opt" key={p.n}>
                      <input type="checkbox" checked={chosen.includes(p.n)}
                        disabled={!chosen.includes(p.n) && chosen.length >= MAX_KEEPERS}
                        onChange={() => toggle(owner, p.n)} />
                      <span className="pos" data-p={p.pos}>{p.pos}</span>
                      <span className="at-optname">{p.n}</span>
                      <span className="at-optcost">{ordinal(p.cost)}</span>
                    </label>
                  ))}
                </details>

                <button className="btn" disabled={!dirty[owner]} onClick={() => saveTeam(owner)}>
                  {dirty[owner] ? 'Save' : 'Saved'}
                </button>
              </div>
            )
          })}
        </div>

        {data.unmatchedSeed?.length > 0 && (
          <>
            <div className="subhead">Seed records needing review</div>
            <div className="card" style={{ padding: '6px 16px' }}>
              {data.unmatchedSeed.map((u, i) => (
                <div className="ov-row" key={i}>
                  <div className="ovn">{u.player}<small>kept by {u.owner} last season</small></div>
                  <span className="pill gold">{u.note}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
