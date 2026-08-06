import { useEffect, useState } from 'react'

/** Load the daily-synced league data (public/data/league.json). */
export function useLeague() {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/league.json`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => setState({ loading: false, data, error: null }))
      .catch(error => setState({ loading: false, data: null, error }))
  }, [])
  return state
}

/** Theme: follows OS preference, manual override persisted. */
export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('pfk-theme') || null)
  useEffect(() => {
    if (theme) {
      document.documentElement.setAttribute('data-theme', theme)
      localStorage.setItem('pfk-theme', theme)
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
  }, [theme])
  const toggle = () => {
    const current = theme ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    setTheme(current === 'dark' ? 'light' : 'dark')
  }
  return { toggle }
}
