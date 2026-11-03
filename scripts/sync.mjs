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
const { firebaseConfig } = await import('../src/firebase-config.js')

// --- name normalization for matching seed <-> Sleeper -----------------------
const normalize = (n) =>
  String(n).toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z]/g, '')

const initials = (n) => {
  const p = n.trim().split(/\s+/)
  return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase()
}

/** Managers sort alphabetically by first name everywhere on the site. */
const byFirstName = (a, b) =>
  a.split(/\s+/)[0].localeCompare(b.split(/\s+/)[0], 'en', { sensitivity: 'base' })
    || a.localeCompare(b)

/** Decode one Firestore REST value into plain JS. */
function fsDecode (v) {
  if (v == null) return null
  if (v.stringValue !== undefined) return v.stringValue
  if (v.integerValue !== undefined) return Number(v.integerValue)
  if (v.doubleValue !== undefined) return Number(v.doubleValue)
  if (v.booleanValue !== undefined) return v.booleanValue
  if (v.nullValue !== undefined) return null
  if (v.arrayValue) return (v.arrayValue.values || []).map(fsDecode)
  if (v.mapValue) {
    const o = {}
    for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = fsDecode(x)
    return o
  }
  return null
}

/**
 * Published keeper declarations for a season, read straight from Firestore.
 *
 * Once a season is under way its keepers are the service-year seed for the
 * NEXT one, and those live in Firestore rather than seed/history.json — so the
 * rollover needs no manual transcription. Security rules allow public reads,
 * so no credentials are involved. Returns null unless the season is published.
 */
async function fetchPublishedDeclarations (season) {
  const projectId = firebaseConfig?.projectId
  if (!projectId) return null
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}` +
      `/databases/(default)/documents/declarations/${season}`
    const res = await fetch(url)
    if (!res.ok) return null
    const doc = await res.json()
    if (!doc.fields) return null
    const data = fsDecode({ mapValue: { fields: doc.fields } })
    return data.status === 'published' ? data : null
  } catch { return null }
}

async function main () {
  console.log('Fetching Sleeper data…')
  const league = await J(`/league/${CUR_LEAGUE}`)
  const PREV_LEAGUE = league.previous_league_id
  if (!PREV_LEAGUE) throw new Error('No previous_league_id on current league')

  // Which season are we planning keepers FOR?
  //
  //   pre_draft  — the current league's draft hasn't happened, so keepers are
  //                still being chosen FROM last season's final rosters.
  //   otherwise  — the draft is done and the season is under way, so the
  //                current rosters are live and we plan the NEXT season.
  //
  // Driving this off league.status means the site rolls over on its own every
  // year instead of needing a code change each offseason.
  const preDraft = league.status === 'pre_draft'
  const SOURCE_LEAGUE = preDraft ? PREV_LEAGUE : CUR_LEAGUE
  const planningSeason = Number(league.season) + (preDraft ? 0 : 1)

  const [curUsers, curRosters, srcUsers, srcRosters, srcDrafts, tradedPicks, players] =
    await Promise.all([
      J(`/league/${CUR_LEAGUE}/users`),
      J(`/league/${CUR_LEAGUE}/rosters`),
      J(`/league/${SOURCE_LEAGUE}/users`),
      J(`/league/${SOURCE_LEAGUE}/rosters`),
      J(`/league/${SOURCE_LEAGUE}/drafts`),
      J(`/league/${CUR_LEAGUE}/traded_picks`),
      J('/players/nfl'),
    ])

  // The draft that set the current cost basis, and (when it exists) the draft
  // for the season being planned — the latter supplies exact pick numbers.
  const costDraft = srcDrafts[0]
  const planningDraft = preDraft ? await J(`/draft/${league.draft_id}`) : null
  const srcDraftPicks = await J(`/draft/${costDraft.draft_id}/picks`)
  const txnWeeks = await Promise.all(
    Array.from({ length: 18 }, (_, i) => J(`/league/${SOURCE_LEAGUE}/transactions/${i + 1}`))
  )

  const nameOf = (users) => {
    const m = {}
    users.forEach(u => { m[u.user_id] = owners.sleeperToName[u.display_name] || u.display_name })
    return m
  }
  const curUserName = nameOf(curUsers)
  const srcUserName = nameOf(srcUsers)
  const ridName = {}
  curRosters.forEach(r => { ridName[r.roster_id] = curUserName[r.owner_id] })

  // --- 2025 draft results ---------------------------------------------------
  const draftRd = {}, draftBy = {}, wasKeeperPick = {}
  srcDraftPicks.forEach(p => {
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

  // --- draft capital for the season being planned ---------------------------
  // Pick NUMBERS need that season's draft to exist. Planning next season, it
  // doesn't yet (the order isn't drawn), so we publish round-level capital and
  // leave the pick number null for the UI to handle.
  const ROUNDS = planningDraft?.settings?.rounds || costDraft?.settings?.rounds || 15
  const teamsN = curRosters.length
  const ridSlot = {}
  Object.entries(planningDraft?.slot_to_roster_id || {}).forEach(([slot, rid]) => { ridSlot[rid] = +slot })
  const pickInRound = (round, slot) => {
    if (!planningDraft || !slot) return null
    return planningDraft.type === 'snake' && round % 2 === 0 ? (teamsN + 1 - slot) : slot
  }

  const tradedTo = {}
  tradedPicks
    .filter(t => String(t.season) === String(planningSeason))
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
        label: pick == null ? `R${r}` : `${r}.${String(pick).padStart(2, '0')}`,
      })
    }
  })

  // --- seed: last season's keeper records (service years + flags) -----------
  const seasonDiscipline = discipline[String(planningSeason)] || {}
  const lastSeason = String(planningSeason - 1)
  const pName = (p) => p.position === 'DEF'
    ? `${p.first_name || ''} ${p.last_name || ''}`.trim()
    : (p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim())

  const seedKeepers = {} // normalized name -> {sv, rd, f1, ir, owner}
  let priorDeclared = null

  if (preDraft) {
    // Planning the current season: the archive already holds last season.
    Object.entries(history[lastSeason] || {}).forEach(([short, list]) => {
      list.forEach(k => {
        seedKeepers[normalize(k.p)] = { ...k, owner: owners.shortToName[short] || short }
      })
    })
    console.log(`Service-year seed for ${lastSeason}: seed/history.json (${Object.keys(seedKeepers).length})`)
  } else {
    // A season just ran. Who was kept in it comes from two places, and both
    // matter: the published declarations are the commissioner's official
    // record, while the draft's is_keeper flags are what actually happened.
    // Take the union, preferring the draft's round where it exists.
    priorDeclared = await fetchPublishedDeclarations(lastSeason)
    const ownerOfRoster = {}
    srcRosters.forEach(r => { ownerOfRoster[r.roster_id] = srcUserName[r.owner_id] })

    const irNames = new Set()
    srcRosters.forEach(r => (r.reserve || []).forEach(pid => {
      const p = players[pid]; if (p?.position) irNames.add(normalize(pName(p)))
    }))

    const kept = new Map() // normalized -> { name, pos, owner, rd, source }
    // (a) declarations — tolerates the legacy plain-name format
    let declaredCount = 0
    for (const [owner, entry] of Object.entries(priorDeclared?.teams || {})) {
      const list = Array.isArray(entry) ? entry.map(name => ({ name })) : (entry.keepers || [])
      for (const k of list) {
        const nm = typeof k === 'string' ? k : k.name
        if (!nm) continue
        declaredCount++
        kept.set(normalize(nm), {
          name: nm, pos: k.pos ?? null, owner,
          rd: k.round ?? null, source: 'declared',
        })
      }
    }
    // (b) the draft's own keeper picks
    let draftKeeperCount = 0
    srcDraftPicks.filter(p => p.is_keeper).forEach(p => {
      const pl = players[p.player_id]
      if (!pl?.position) return
      draftKeeperCount++
      const key = normalize(pName(pl))
      const prev = kept.get(key)
      kept.set(key, {
        name: pName(pl), pos: pl.position,
        owner: prev?.owner ?? ownerOfRoster[p.roster_id],
        rd: p.round,                       // what the draft actually recorded
        source: prev ? 'both' : 'draft',
      })
    })

    // Service years carried forward: keeps used entering last season, plus
    // this one — unless rule 6 applies (finished the season on IR).
    const priorYear = String(Number(lastSeason) - 1)
    const priorSv = {}
    Object.values(history[priorYear] || {}).flat()
      .forEach(k => { priorSv[normalize(k.p)] = k.sv ?? 0 })

    for (const [key, k] of kept) {
      const onIR = irNames.has(key)
      const sv = Math.min(MAX_SERVICE_YEARS, (priorSv[key] ?? 0) + (onIR ? 0 : 1))
      seedKeepers[key] = {
        p: k.name, pos: k.pos, sv, rd: k.rd,
        f1: k.rd === 1, ir: onIR, owner: k.owner,
      }
    }
    console.log(`Service-year seed for ${lastSeason}: ${kept.size} keepers ` +
      `(${declaredCount} declared, ${draftKeeperCount} flagged in the draft)`)
    const onlyDeclared = [...kept.values()].filter(k => k.source === 'declared').map(k => k.name)
    const onlyDraft = [...kept.values()].filter(k => k.source === 'draft').map(k => k.name)
    if (onlyDeclared.length) console.log('  declared but not flagged in the draft:', onlyDeclared.join(', '))
    if (onlyDraft.length) console.log('  drafted as keepers but never declared:', onlyDraft.join(', '))
  }
  const matchedSeed = new Set()

  // --- keeper engine: per-player cost + eligibility -------------------------
  const teams = {}
  srcRosters.forEach(r => {
    const nm = srcUserName[r.owner_id]
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
      } else if (add && add.type === 'trade' && dRd != null) {
        basis = dRd; mode = 'trade'; why = `Traded in — retains R${dRd}`
      } else if (add && add.type === 'trade') {
        // Traded in, but never drafted by anyone — the previous owner held
        // him as an in-season pickup, so rule 8 carries over a rule 7 basis.
        mode = 'fa'; why = 'Traded in from free agency → 9th-round cost'
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
    const named = {}
    Object.entries(byShort).forEach(([short, list]) => {
      named[owners.shortToName[short] || short] = list
    })
    // managers stay alphabetical by first name in the archive too
    historyOut[year] = {}
    Object.keys(named).sort(byFirstName).forEach(n => { historyOut[year][n] = named[n] })
  })

  // Fold the season just completed into the browsable archive. Built from
  // seedKeepers, which already merges the declarations with the draft's own
  // keeper flags — so teams saved in the older name-only format are included.
  if (!preDraft && !historyOut[lastSeason] && Object.keys(seedKeepers).length) {
    const byOwner = {}
    for (const k of Object.values(seedKeepers)) {
      if (!k.owner) continue
      ;(byOwner[k.owner] = byOwner[k.owner] || []).push({
        p: k.p, pos: k.pos ?? null, sv: k.sv ?? null, rd: k.rd ?? null,
        ...(k.f1 ? { f1: true } : {}),
        ...(k.ir ? { ir: true } : {}),
      })
    }
    for (const list of Object.values(byOwner)) {
      list.sort((a, b) => (a.rd ?? 99) - (b.rd ?? 99))
    }
    if (Object.keys(byOwner).length) {
      historyOut[lastSeason] = {}
      Object.keys(byOwner).sort(byFirstName).forEach(n => { historyOut[lastSeason][n] = byOwner[n] })
    }
  }

  const out = {
    meta: {
      generated: new Date().toISOString(),
      leagueName: league.name,
      season: planningSeason,
      leagueSeason: Number(league.season),
      leagueStatus: league.status,
      phase: preDraft ? 'pre_draft' : 'in_season',
      pickNumbersKnown: !!planningDraft,
      firstSleeperSeason: 2021,
      founded: 2017,
      rounds: ROUNDS,
      faRound: FA_ROUND,
      maxServiceYears: MAX_SERVICE_YEARS,
    },
    teamOrder: Object.keys(teams).sort(byFirstName),
    teams,
    history: historyOut,
    champions,
    discipline: seasonDiscipline,
    unmatchedSeed,
  }

  const dataDir = join(ROOT, 'public', 'data')
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, 'league.json'), JSON.stringify(out))

  console.log(`OK — ${league.name}: league season ${league.season} (${league.status}), planning ${planningSeason}`)
  console.log(`Rosters from ${preDraft ? 'previous' : 'current'} league; pick numbers ${planningDraft ? 'known' : 'not drawn yet'}`)
  console.log(`Teams: ${Object.keys(teams).length}, rounds: ${ROUNDS}`)
  if (unmatchedSeed.length) {
    console.log('Seed keepers needing review:')
    unmatchedSeed.forEach(u => console.log(`  - ${u.player} (${u.owner}): ${u.note}`))
  }
}

main().catch(e => { console.error(e); process.exit(1) })
