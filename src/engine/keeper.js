/**
 * Client-side keeper slate engine.
 *
 * Per-player costs and eligibility are computed at sync time (scripts/sync.mjs)
 * and shipped in league.json. This module handles the interactive, slate-level
 * rules that depend on WHICH players are selected together:
 *
 *   Rule 1: keep 2-4 players
 *   Rule 2: can't keep the same position for all 4 slots
 *   Rule 9: same-round keepers — the later one bumps one round earlier,
 *           cascading; a bump into Round 1 inherits rule 5's 1-year max;
 *           a bump PAST Round 1 is illegal
 *   Capital check: you must own a pick in each assigned round
 */

export const MIN_KEEPERS = 2
export const MAX_KEEPERS = 4

/**
 * Assign draft rounds to the chosen players.
 *
 * Order of operations:
 *   1. Commissioner discipline (rule 10) — a keeper-round penalty hits the
 *      keeper with the LATEST round, making it cost that many rounds earlier.
 *   2. Rule 9 same-round bump cascade.
 *
 * `penalty` is the team's discipline record, e.g.
 * { type: 'keeper_round', rounds: 1, target: 'latest_round' }.
 */
export function assignRounds(chosen, penalty = null) {
  const entries = chosen.map(p => ({ p, cost: p.cost, penalized: false }))

  const penaltyRounds = penalty?.type === 'keeper_round' ? (penalty.rounds || 0) : 0
  if (penaltyRounds > 0 && entries.length) {
    // "latest round" = highest round number (the cheapest keeper).
    // Deterministic tie-break by name so the result never flickers.
    let target = entries[0]
    for (const e of entries) {
      if (e.cost > target.cost || (e.cost === target.cost && e.p.n < target.p.n)) target = e
    }
    const penalized = Math.max(1, target.cost - penaltyRounds)
    if (penalized !== target.cost) {
      target.cost = penalized
      target.penalized = true
    }
  }

  const sorted = [...entries].sort((a, b) => a.cost - b.cost)
  const used = {}
  return sorted.map(e => {
    let round = e.cost
    let bumped = false
    while (used[round] && round > 0) { round--; bumped = true }
    used[round] = true
    return {
      p: e.p, round, bumped, penalized: e.penalized,
      penaltyCost: e.cost, invalid: round < 1,
    }
  })
}

/**
 * Validate a slate. Returns { assignments, notes, legal }.
 * team = { cap, missing, rounds } from league.json.
 */
export function evaluateSlate(chosen, team) {
  const assignments = assignRounds(chosen, team.penalty)
  const notes = []

  if (chosen.length > 0 && chosen.length < MIN_KEEPERS) {
    notes.push({ kind: 'info', text: `Rule 1: you must keep at least ${MIN_KEEPERS} players.` })
  }

  const penalized = assignments.find(a => a.penalized)
  if (penalized) {
    const n = team.penalty.rounds
    notes.push({
      kind: 'warn',
      text: `Discipline: ${penalized.p.n} costs ${n} round${n === 1 ? '' : 's'} earlier (${ordinal(penalized.p.cost)} → ${ordinal(penalized.penaltyCost)}) — your latest-round keeper carries the penalty.`,
    })
  } else if (team.penalty && chosen.length > 0) {
    notes.push({
      kind: 'warn',
      text: 'Discipline: a keeper-round penalty applies to this team — it will hit your latest-round keeper.',
    })
  }

  if (chosen.length === MAX_KEEPERS && chosen.every(p => p.pos === chosen[0].pos)) {
    notes.push({ kind: 'warn', text: `Rule 2: you can't keep ${MAX_KEEPERS} of the same position (${chosen[0].pos}).` })
  }

  for (const a of assignments) {
    if (a.invalid) {
      notes.push({ kind: 'warn', text: `${a.p.n}'s bump would pass Round 1 — not allowed. Two low picks collide here.` })
    } else if (a.bumped && a.round === 1) {
      notes.push({ kind: 'info', text: `${a.p.n} bumps into Round 1 — costs a 1st and inherits the 1-year max (rule 5).` })
    }
    if (!a.invalid && team.missing.includes(a.round)) {
      notes.push({ kind: 'warn', text: `No ${ordinal(a.round)}-round pick for ${a.p.n} — you traded it away. Reacquire it or pick someone else.` })
    }
  }

  const positionViolation = chosen.length === MAX_KEEPERS && chosen.every(p => p.pos === chosen[0].pos)
  const legal = chosen.length >= MIN_KEEPERS &&
    !positionViolation &&
    assignments.every(a => !a.invalid && !team.missing.includes(a.round))

  if (legal) {
    notes.push({ kind: 'ok', text: 'Legal slate — you own every pick required. Lock it in before the deadline.' })
  }

  return { assignments, notes, legal }
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function initials(name) {
  const p = name.trim().split(/\s+/)
  return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase()
}
