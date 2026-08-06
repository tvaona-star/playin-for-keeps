import { useEffect, useState } from 'react'
import { firebaseEnabled, signIn, signOutUser, loadDeclarations, saveDeclaration } from '../firebase.js'
import { commissionerEmail } from '../firebase-config.js'
import { MAX_KEEPERS } from '../engine/keeper.js'

export default function Admin({ data }) {
  const [user, setUser] = useState(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [decls, setDecls] = useState({})
  const [status, setStatus] = useState('')

  const season = data.meta.season

  useEffect(() => {
    if (user) {
      loadDeclarations(season)
        .then(d => setDecls(d.teams || {}))
        .catch(e => setError(String(e.message || e)))
    }
  }, [user, season])

  const doSignIn = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      setUser(await signIn(commissionerEmail, password))
    } catch (err) {
      setError('Sign-in failed — wrong password.')
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  const toggleKeeper = (owner, playerName) => {
    setDecls(prev => {
      const cur = prev[owner] || []
      const next = cur.includes(playerName)
        ? cur.filter(n => n !== playerName)
        : cur.length < MAX_KEEPERS ? [...cur, playerName] : cur
      return { ...prev, [owner]: next }
    })
  }

  const save = async (owner) => {
    setStatus(`Saving ${owner}…`)
    try {
      await saveDeclaration(season, owner, decls[owner] || [])
      setStatus(`${owner} saved ✓`)
    } catch (e) {
      setStatus(`Save failed: ${e.message}`)
    }
    setTimeout(() => setStatus(''), 2500)
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
              The console needs a Firebase project to store keeper declarations and
              overrides securely. One-time setup:
            </p>
            <ol style={{ color: 'var(--ink-2)', fontSize: 13.5, paddingLeft: 20, lineHeight: 1.8 }}>
              <li>Create (or reuse) a Firebase project with Firestore</li>
              <li>Enable Email/Password sign-in and add the commissioner account</li>
              <li>Paste the web config into <code>src/firebase-config.js</code></li>
              <li>Apply the security rules from <code>README.md</code></li>
            </ol>
            <p style={{ color: 'var(--ink-3)', fontSize: 12 }}>
              Everything else on the site is read-only and works without it.
              Security note: a client-side password alone can't protect data on a
              static site — Firestore rules bound to the commissioner's account can.
            </p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="view">
      <div className="section-head" style={{ justifyContent: 'center', textAlign: 'center' }}>
        <div><div className="eyebrow">Restricted</div><h2>Commissioner Console</h2></div>
      </div>

      {!user ? (
        <div className="admin-wrap">
          <form className="card" style={{ padding: 26 }} onSubmit={doSignIn}>
            <div className="lock">🔒</div>
            <p style={{ textAlign: 'center', color: 'var(--ink-2)', margin: '0 0 6px' }}>
              Enter the commissioner password to declare keepers and record overrides.
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
      ) : (
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <div className="filters" style={{ justifyContent: 'space-between' }}>
            <span className="pill good"><i className="dot" />Signed in as Commissioner</span>
            <button className="btn" style={{ width: 'auto', padding: '8px 14px' }}
              onClick={() => signOutUser().then(() => setUser(null))}>Sign out</button>
          </div>
          <div className="subhead">Declare {season} keepers (up to {MAX_KEEPERS} per team)</div>
          {status && <p style={{ color: 'var(--accent)', fontSize: 13 }}>{status}</p>}
          <div className="sel-grid">
            {data.teamOrder.map(owner => {
              const team = data.teams[owner]
              const eligible = team.players.filter(p => p.elig === 'ok')
              const chosen = decls[owner] || []
              return (
                <div className="card team-card" key={owner}>
                  <h3>{owner} <span className="count" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{chosen.length}/{MAX_KEEPERS}</span></h3>
                  {eligible.map(p => (
                    <label className="krow" key={p.n} style={{ cursor: 'pointer' }}>
                      <input type="checkbox" checked={chosen.includes(p.n)}
                        onChange={() => toggleKeeper(owner, p.n)} />
                      <span className="kn">{p.n}<small> · {p.pos}</small></span>
                      <span className="kr"><small>R</small>{p.cost}</span>
                    </label>
                  ))}
                  <button className="btn" style={{ marginTop: 10, padding: 9, fontSize: 13 }}
                    onClick={() => save(owner)}>Save {owner.split(' ')[0]}</button>
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
      )}
    </section>
  )
}
