#!/usr/bin/env node
/**
 * Daily sync: Sleeper API -> public/data/league.json
 *
 * Pulls rosters, draft results, transactions, and traded picks, then runs the
 * keeper engine (league rules 1-13) to compute each player's keeper cost and
 * eligibility, plus each team's exact 2026 draft-pick capital.
 *
 * League rules encoded here:
 *   R4  cost = one round earlier than last year's cost (via draft round - 1)
 *   R5  first-rounders keepable one year max
 *   R3  max 2 additional years (service years from seed history)
 *   R6  IR at end of season: no round escalation, year doesn't count
 *   R7  in-season FA pickups cost a 9th; players YOU drafted retain their
 *       round even after a drop + re-add
 *   R8  traded players retain the previous owner's round
 *
 * Slate-level rules (min/max keepers, position mix, same-round bump) are
 * applied client-side in src/engine/keeper.js.
 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const CUR_LEAGUE = '1389688843191488512'   // 2026 season (planning target)
const FA_ROUND = 9                          // rule 7
const MAX_SERVICE_YEARS = 2                 // rule 3: original season + 2 keeps

const API = 'https://api.sleeper.app/v1'
const J = async (path) => {
  const res = await fetch(`${API}${path}`)
  if (!res.ok) throw new Error(`Sleeper ${path} -> HTTP ${res.status}`)
  return res.json()
}

const owners = JSON.parse(readFileSync(join(ROOT, 'seed', 'owners.json'), 'utf8'))
const history = JSON.parse(readFileSync(join(ROOT, 'seed', 'history.json'), 'utf8'))
const champions = JSON.parse(readFileSync(join(ROOT, 'seed', 'champions.json'), 'utf8'))
const discipline = JSON.parse(readFileSync(join(ROOT, 'seed', 'discipline.json'), 'utf8'))

// --- name normalization for matching seed <-> Sleeper -----------------------
const normalize = (n) =>
  String(n).toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z]/g, '')

const initials = (n) => {
  const p = n.trim().split(/\s+/)
  return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase()
}

async function main () {
  console.log('Fetching Sleeper data…')
  const league = await J(`/league/${CUR_LEAGUE}`)
  const PREV_LEAGUE = league.previous_league_id
  if (!PREV_LEAGUE) throw new Error('No previous_league_id on current league')

  const [curUsers, curRosters, prevUsers, prevRosters, prevDrafts, tradedPicks, players] =
    await Promise.all([
      J(`/league/${CUR_LEAGUE}/users`),
      J(`/league/${CUR_LEAGUE}/rosters`),
      J(`/league/${PREV_LEAGUE}/users`),
      J(`/league/${PREV_LEAGUE}/rosters`),
      J(`/league/${PREV_LEAGUE}/drafts`),
      J(`/league/${CUR_LEAGUE}/traded_picks`),
      J('/players/nfl'),
    ])

  const draft26 = await J(`/draft/${league.draft_id}`)
  const prevDraftPicks = await J(`/draft/${prevDrafts[0].draft_id}/picks`)
  const txnWeeks = await Promise.all(
    Array.from({ length: 18 }, (_, i) => J(`/league/${PREV_LEAGUE}/transactions/${i + 1}`))
  )

  const nameOf = (users) => {
    const m = {}
    users.forEach(u => { m[u.user_id] = owners.sleeperToName[u.display_name] || u.display_name })
    return m
  }
  const curUserName = nameOf(curUsers)
  const prevUserName = nameOf(prevUsers)
  const ridName = {}
  curRosters.forEach(r => { ridName[r.roster_id] = curUserName[r.owner_id] })

  // --- 2025 draft results ---------------------------------------------------
  const draftRd = {}, draftBy = {}, wasKeeperPick = {}
  prevDraftPicks.forEach(p => {
    draftRd[p.player_id] = p.round
    draftBy[p.player_id] = p.roster_id
    wasKeeperPick[p.player_id] = !!p.is_keeper
  })

  // --- last completed add per (player, roster): waiver / free_agent / trade -
  const lastAdd = {}
  txnWeeks.forEach((txns, wi) => {
    ;(txns || []).forEach(t => {
      if (t.status !== 'complete' || !t.adds) return
      const ord = t.status_updated || (wi + 1)
      for (const pid of Object.keys(t.adds)) {
        const key = `${pid}|${t.adds[pid]}`
        if (!lastAdd[key] || ord > lastAdd[key].ord) lastAdd[key] = { ord, type: t.type }
      }
    })
  })

  // --- 2026 draft capital: exact picks with origins -------------------------
  const ROUNDS = draft26?.settings?.rounds || 15
  const teamsN = curRosters.length
  const ridSlot = {}
  Object.entries(draft26.slot_to_roster_id || {}).forEach(([slot, rid]) => { ridSlot[rid] = +slot })
  const pickInRound = (round, slot) =>
    draft26.type === 'snake' && round % 2 === 0 ? (teamsN + 1 - slot) : slot

  const tradedTo = {}
  tradedPicks
    .filter(t => String(t.season) === String(league.season))
    .forEach(t => { tradedTo[`${t.round}|${t.roster_id}`] = t.owner_id })

  const capital = {}
  Object.values(ridName).forEach(n => { capital[n] = {} })
  curRosters.forEach(orig => {
    for (let r = 1; r <= ROUNDS; r++) {
      const ownerRid = tradedTo[`${r}|${orig.roster_id}`] ?? orig.roster_id
      const ownerName = ridName[ownerRid]
      const originName = ridName[orig.roster_id]
      const slot = ridSlot[orig.roster_id]
      const pick = pickInRound(r, slot)
      ;(capital[ownerName][r] = capital[ownerName][r] || []).push({
        o: initials(originName),
        name: originName,
        self: originName === ownerName,
        pick,
        label: `${r}.${String(pick).padStart(2, '0')}`,
      })
    }
  })

  // --- seed: last season's keeper records (service years + flags) -----------
  const seasonDiscipline = discipline[String(league.season)] || {}
  const lastSeason = String(Number(league.season) - 1)
  const seedKeepers = {} // normalized name -> {sv, rd, f1, ir, owner}
  Object.entries(history[lastSeason] || {}).forEach(([short, list]) => {
    list.forEach(k => {
      seedKeepers[normalize(k.p)] = { ...k, owner: owners.shortToName[short] || short }
    })
  })
  const matchedSeed = new Set()

  // --- keeper engine: per-player cost + eligibility -------------------------
  const pName = (p) => p.position === 'DEF'
    ? `${p.first_name || ''} ${p.last_name || ''}`.trim()
    : (p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim())

  const teams = {}
  prevRosters.forEach(r => {
    const nm = prevUserName[r.owner_id]
    const rid = r.roster_id
    const starters = new Set(r.starters || [])
    const reserve = new Set(r.reserve || [])

    const list = (r.players || []).map(pid => {
      const p = players[pid] || {}
      if (!p.position) return null
      const grp = reserve.has(pid) ? 'IR' : (starters.has(pid) ? 'ST' : 'BN')
      const onIR = grp === 'IR'
      const dRd = draftRd[pid]
      const iDrafted = draftBy[pid] === rid
      const add = lastAdd[`${pid}|${rid}`]

      // 1. Acquisition mode -> cost basis (rules 7 & 8)
      let basis = null, mode, why = ''
      if (iDrafted) {
        basis = dRd; mode = 'draft'
        if (add && (add.type === 'waiver' || add.type === 'free_agent')) {
          why = 'Re-added — retains your original round'
        }
      } else if (add && add.type === 'trade') {
        basis = dRd; mode = 'trade'; why = `Traded in — retains R${dRd}`
      } else if (dRd != null && !add) {
        basis = dRd; mode = 'trade'; why = `Acquired via trade — retains R${dRd}`
      } else {
        mode = 'fa'; why = 'FA pickup → 9th-round cost'
      }
      const fa = mode === 'fa'

      // 2. Base cost (rules 4, 5, 6)
      let cost, elig = 'ok'
      if (fa) {
        cost = FA_ROUND
      } else if (onIR) {
        cost = basis; why = 'IR — no round penalty' // rule 6
      } else if (basis === 1) {
        if (iDrafted && wasKeeperPick[pid]) {
          elig = 'no'; cost = null; why = '1st-round, max reached' // rule 5
        } else {
          cost = 1; why = why || 'Costs a 1st → 1-yr max'
        }
      } else {
        cost = basis - 1
      }

      // 3. Seed service-year adjustments (rules 3 & 6 history)
      const seed = seedKeepers[normalize(pName(p))]
      let sv = 0
      if (seed) {
        matchedSeed.add(normalize(pName(p)))
        sv = seed.sv ?? 0
        if (seed.f1 && !seed.ir) {
          elig = 'no'; cost = null; why = 'Kept at 1st — max reached'
        } else if (sv >= MAX_SERVICE_YEARS) {
          if (onIR) {
            // rule 6: the IR year doesn't count against service years
            elig = 'ok'; cost = fa ? FA_ROUND : basis
            why = 'IR exception — kept year won\'t count (rule 6)'
          } else {
            elig = 'no'; cost = null
            why = `Kept ${MAX_SERVICE_YEARS} yrs — max reached`
          }
        } else if (seed.rd === 1 && seed.ir && elig === 'ok') {
          why = '2nd time as a 1st if kept — final year'
        }
      }
      const finalYear = elig === 'ok' && !onIR && sv + 1 >= MAX_SERVICE_YEARS

      return {
        n: pName(p), pos: p.position,
        rd: fa ? null : basis, cost, elig, grp,
        ir: onIR, fa, sv, finalYear, why,
      }
    }).filter(Boolean)

    const grpOrder = { ST: 0, BN: 1, IR: 2 }
    list.sort((a, b) => grpOrder[a.grp] - grpOrder[b.grp] || (a.cost ?? 99) - (b.cost ?? 99))

    const cap = capital[nm] || {}
    Object.values(cap).forEach(arr => arr.sort((a, b) => a.pick - b.pick))
    const missing = []
    for (let r = 1; r <= ROUNDS; r++) if (!cap[r]) missing.push(r)

    // Active discipline for this season (rules 10 & 13)
    const penalty = (seasonDiscipline.penalties || [])
      .find(p => p.owner === nm) || null

    teams[nm] = { players: list, cap, missing, rounds: ROUNDS, penalty }
  })

  // Seed keepers we could not find on any roster (dropped / renamed) — for
  // commissioner review; overrides can correct any misses.
  const rostered = new Set()
  Object.values(teams).forEach(t => t.players.forEach(p => rostered.add(normalize(p.n))))
  const unmatchedSeed = Object.values(seedKeepers)
    .filter(k => !matchedSeed.has(normalize(k.p)))
    .map(k => ({ player: k.p, owner: k.owner, note: rostered.has(normalize(k.p)) ? 'name mismatch' : 'not on any roster' }))

  // History for the archive page, keyed by full owner names.
  const historyOut = {}
  Object.entries(history).forEach(([year, byShort]) => {
    if (year.startsWith('_')) return
    historyOut[year] = {}
    Object.entries(byShort).forEach(([short, list]) => {
      historyOut[year][owners.shortToName[short] || short] = list
    })
  })

  const out = {
    meta: {
      generated: new Date().toISOString(),
      leagueName: league.name,
      season: Number(league.season),
      leagueStatus: league.status,
      firstSleeperSeason: 2021,
      founded: 2017,
      rounds: ROUNDS,
      faRound: FA_ROUND,
      maxServiceYears: MAX_SERVICE_YEARS,
    },
    teamOrder: owners.teamOrder.filter(n => teams[n]),
    teams,
    history: historyOut,
    champions,
    discipline: seasonDiscipline,
    unmatchedSeed,
  }

  const dataDir = join(ROOT, 'public', 'data')
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, 'league.json'), JSON.stringify(out))

  console.log(`OK — ${league.name} ${league.season} (${league.status})`)
  console.log(`Teams: ${Object.keys(teams).length}, rounds: ${ROUNDS}`)
  if (unmatchedSeed.length) {
    console.log('Seed keepers needing review:')
    unmatchedSeed.forEach(u => console.log(`  - ${u.player} (${u.owner}): ${u.note}`))
  }
}

main().catch(e => { console.error(e); process.exit(1) })
