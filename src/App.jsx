import { useState } from 'react'
import { useLeague, useTheme } from './useLeague.js'
import Planner from './pages/Planner.jsx'
import Selections from './pages/Selections.jsx'
import Champions from './pages/Champions.jsx'
import Rules from './pages/Rules.jsx'
import Admin from './pages/Admin.jsx'

const TABS = [
  ['myteam', 'My Team'],
  ['selections', 'Keeper Selections'],
  ['champs', 'Champions & Records'],
  ['rules', 'League Rules'],
  ['admin', 'Commissioner'],
]

export default function App() {
  const { loading, data, error } = useLeague()
  const { toggle } = useTheme()
  const [tab, setTab] = useState('myteam')

  return (
    <>
      <div className="appbar">
        <div className="appbar-inner">
          <div className="crest">PK</div>
          <div className="brand">
            <h1>{data?.meta.leagueName || "Playin' for Keeps"}</h1>
            <p>10-team keeper league · Est. {data?.meta.founded || 2017} · synced from Sleeper</p>
          </div>
          <div className="appbar-spacer" />
          {data && (
            <div className="season"><i />Planning <b>{data.meta.season}</b> keepers</div>
          )}
          <button className="theme-btn" onClick={toggle} title="Toggle light / dark" aria-label="Toggle theme">◐</button>
        </div>
      </div>

      <div className="tabs">
        <div className="tabs-inner" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} className="tab" role="tab" aria-selected={tab === id}
              onClick={() => { setTab(id); window.scrollTo(0, 0) }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="wrap">
        {loading && <div className="loading">Loading league data…</div>}
        {error && (
          <div className="card empty-state">
            <div className="big">⚠️</div>
            <h3 style={{ margin: '8px 0 4px' }}>Couldn't load league data</h3>
            <p>Run <code>npm run sync</code> to generate <code>public/data/league.json</code>, then reload.</p>
          </div>
        )}
        {data && (
          <>
            {tab === 'myteam' && <Planner data={data} />}
            {tab === 'selections' && <Selections data={data} />}
            {tab === 'champs' && <Champions data={data} />}
            {tab === 'rules' && <Rules data={data} />}
            {tab === 'admin' && <Admin data={data} />}
            <p className="updated">
              Data updated {new Date(data.meta.generated).toLocaleString(undefined, {
                dateStyle: 'medium', timeStyle: 'short',
              })} · refreshes daily from Sleeper
            </p>
          </>
        )}
      </div>
    </>
  )
}
