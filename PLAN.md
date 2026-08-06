# Keeper League Tracker — Plan

A website to track a Keeper Fantasy Football League hosted on Sleeper.
Status: **Planning** (no code until approved).

League: **"Playin' for Keeps"** · 10 teams · Est. 2017
Sleeper League ID (2026, current): **1389688843191488512** (status: pre-draft)
Previous league ID (2025): **1254969166851485696** (chains back via
`previous_league_id`; first Sleeper season is 2021)

**Roster (confirmed):** `2 QB · 2 RB · 3 WR · 1 TE · 1 FLEX · 1 DEF · 5 BN`
plus IR slots. Rule 12's omission of the **TE** slot was a typo — TE is
included.

---

## 1. Core idea & architecture

GitHub Pages is static hosting, and Sleeper's API asks callers to stay under
~1000 requests/minute. So we **never call Sleeper from the browser on page
load**. Instead:

```
Sleeper API ──(scheduled GitHub Action)──► Firebase (Firestore) ──(read-only)──► Static site on GitHub Pages
```

- A **GitHub Actions cron job** fetches from Sleeper **once per day**, runs the
  keeper math, and writes clean data to Firestore.
- The **static site reads only from Firestore** — fast, free, and zero
  rate-limit risk regardless of how many league-mates load the page.
- All Sleeper API work is isolated to one controlled job.

**Recommended stack**
- Vite + React SPA → GitHub Pages
- Firestore for data
- GitHub Actions (Node/TypeScript) for the sync job

Matches the user's existing infrastructure (GitHub hosting + Firebase).

---

## 2. Commissioner override (first-class feature)

The commissioner must be able to override ANY computed value to correct for bad
Sleeper data or algorithm corner cases (rule 13, commissioner discretion).

- Any computed field (keeper cost, years kept, eligibility, IR-exempt, draft
  origin, penalties) can be manually overridden.
- Overrides are **stored separately** from the auto-computed value: the engine
  keeps recalculating, but the override wins for display, and the original
  auto value is preserved and visible ("auto: 6th → override: 5th").
- Overrides are the mechanism for rules that can't be auto-detected
  (esp. rule 6 IR exemption and rule 10 penalties).

---

## 3. Keeper rules (league house rules)

1. Keep up to 4 keepers; must keep at least 2.
2. Cannot keep the same position for all 4 keepers.
3. A player can be kept for 2 additional years (draft/FA season + 2 more).
4. Keepers cost a draft pick one round earlier than the previous year.
5. 1st-rounders can be kept one year maximum.
6. Players Out/IR who did NOT play the last game of the fantasy season have no
   draft penalty next year: no round-up and no increment to years-kept.
7. In-season free-agent pickups count as a 9th-round pick if kept. But an FA
   pickup that YOU drafted retains its original round (drop + re-add keeps the
   original draft value).
8. Traded players retain the draft round from the previous owner.
9. If two keepers land in the same round, the 2nd costs one round up
   (e.g. two 6th-rounders → a 5th and a 6th). Cascades upward on further
   collisions.
10. Not setting your lineup results in a penalty, starting with loss of a
    keeper round (commissioner-applied; see rule 13).
11. Keepers are declared one week prior to the draft.
12. Roster: 2 QB, 2 RB, 3 WR, 1 FLEX, 1 DST, 5 BN, 2 IR.
13. Commissioner's discretion for rule interpretation (based on precedent) and
    discipline for conduct detrimental.

---

## 4. Keeper engine (rule → logic mapping)

Config-driven so tweaks are a config change, not a rewrite. Per rostered player
the engine computes: eligible? / cost / years kept / cost next year — then the
override layer can adjust any of it.

| Rule | Logic |
|------|-------|
| 1 | Per-team validation: min 2, max 4 keepers |
| 2 | Positional check enforced ONLY at exactly 4 keepers (literal) |
| 3 | Years-kept counter, cap 3 seasons total (orig + 2) |
| 4 | Escalation: `cost = draftRound − yearsKept` |
| 5 | Round-1 players: hard 1-year max (overrides #3) |
| 6 | IR-exempt flag: skip escalation AND skip year increment (manual flag) |
| 7 | Trace draft origin **per team**; FA-never-drafted-by-you = round 9 |
| 8 | Chain cost basis through trade history |

### CRITICAL: cost basis depends on HOW the player was acquired
A player's draft round only carries over to the current owner if that owner
**drafted him** (rule 7) or **acquired him by trade** (rule 8). Picking up
another owner's draftee off **waivers/FA makes him a 9th**, regardless of where
he was originally drafted.

Determining this requires the **transaction history**
(`GET /league/<id>/transactions/<week>` for weeks 1-18), not just the draft:
- `draftBy[player] === myRoster` → keep original round (rule 7). Still applies
  after a drop and re-add by the same owner.
- last add to my roster was `type: "trade"` → retain previous owner's round
  (rule 8).
- last add was `type: "waiver"` or `"free_agent"` and I did NOT draft him →
  **9th-round cost** (rule 7).

Validated against the real league: Aaron Rodgers was drafted in R15 by another
owner and picked up off waivers by Tyler → correctly costs a **9th**, not a
14th. Meanwhile Jayden Higgins / Brandon Aiyuk / Colston Loveland were drafted
by Tyler, dropped, and re-added → correctly retain their original rounds.
| 9 | Collision resolver: same-round keepers bump upward, cascading; a keeper bumped into R1 also inherits rule 5's 1-year max |
| 10 | Manual penalty applied via override |
| 11 | Declaration deadline / lock in UI |
| 12 | Roster-slot config drives position validation for #2 |
| 13 | The override system (final say on any value) |

### Known data-reality constraints
- **Rule 6 (IR):** Sleeper API reports *current* injury status only, not
  historical week-by-week status. IR exemption therefore must be a **manual
  flag** the commissioner sets (fits the override model).
- **Rules 3, 7, 8 (years-kept & cost basis):** depend on multi-season history
  the API only partially reconstructs. The **old keeper tracker is the seed**
  for years-kept and original draft values; the engine carries it forward each
  new season.

### Resolved engine decisions
- Rule 9: a bump CAN push a keeper into Round 1, and that keeper then inherits
  rule 5's 1-year-max going forward.
- Rule 2: position restriction is enforced ONLY at exactly 4 keepers (literal).
- Seed source: the source spreadsheet (Excel/Sheet) will be provided.

---

## 4A. The current manual tracker (what we're digitizing)

Source: `2025 Keeper Selections.pdf` and `2025 Keeper Roster.pdf` — the league's
live manual keeper tracker. The website automates exactly these sheets.

**Two views in the current tracker**
- **Keeper Selections** — declared keepers per owner: Player / Service Years /
  Round Kept At, plus flags.
- **Keeper Roster** — full post-draft rosters with the computed **K-RD** (keeper
  round), IR slots handled separately, and a per-team **draft-pick ledger**
  (traded picks, missing picks, original owner).

**Mechanics confirmed from the data**
- `K-RD = draftRound − serviceYears` (one round earlier per year kept, rule 4).
- Round-1 players display `1*` / `NA` (1-year max, rule 5).
- FA pickups sit at a round-10 placeholder and keep at **round 9** (rule 7).
- IR exceptions marked `**` — no penalty, no year counted (rule 6).
- Draft-pick capital is tracked because keeping a player at round N requires
  owning a round-N pick.

**Flag legend**
- `*` = 2nd time as a 1st, maximum reached — cannot be kept again unless on IR.
- `**` = IR, no penalty.
- Red = cannot be kept (at max / ineligible).
- `NA` = not keepable.

**Owners (10)** — Sleeper name → manager:
Tyler Vaona (commissioner), Marcus Tran, Spencer Watton, Erwin Bensan,
Blake Smart, Bob Hardin, Matthew Jones, David Lopez, Kyle Matthews,
Dillon Perez.

**Per-player data model (derived from the tracker)**
- `player_id`, `name`, `position`, `owner`
- `acquisition_type` (draft / FA / trade), `draft_round` (origin/cost basis)
- `service_years`, `keeper_round` (computed), `cost_next_year`
- `eligible`, `max_reached`, `ir_exempt`, `flags`
- override fields (auto value preserved alongside)

**Draft-capital ledger (per owner)**
- picks owned by round for the upcoming draft
- traded picks (to / from, with original owner)
- missing picks — highlights when an owner lacks the pick needed to keep a
  player at that round

**Seed source (received): `Keeper tracker 2025.xlsx`** — relevant tabs:
- **Keepers** — every keeper for all 10 owners, 2019→2025 (Player / Service
  Years / Round Kept At + `*`/`**` flags). Seeds keeper history + years-kept.
  Keeper slots grew from 3 to 4 starting in 2024 → history must handle a
  variable keeper count per season.
- **Results** — champions 2017→2025 with accolades (league founded 2017).
- **Team Tracker** — current roster grid: draft rounds, K-RD, IR, and the
  traded-pick / missing-pick ledger.
- Hidden tabs (`2017 Results`, `Keepers 2019`, `Sheet2`) — legacy, review on
  import but likely superseded.

**Import note:** player names are hand-typed with typos (e.g. "McCaffery",
"Metalf", "Mahommes"). Matching to Sleeper `player_id` needs fuzzy matching plus
a small manual alias map, with commissioner override for stragglers.

---

## 5. Sleeper API reference (read-only, public, no auth)

Base: `https://api.sleeper.app/v1`

- `GET /league/<league_id>` → settings, scoring, roster slots
- `GET /league/<league_id>/rosters` → rosters
- `GET /league/<league_id>/users` → managers
- `GET /league/<league_id>/matchups/<week>` → weekly scores
- `GET /league/<league_id>/transactions/<round>` → trades, waivers, FA
- `GET /league/<league_id>/traded_picks` → traded picks
- `GET /league/<league_id>/drafts` + `GET /draft/<draft_id>/picks`
- `GET /league/<league_id>/winners_bracket` / `/losers_bracket`
- `GET /players/nfl` → full player DB (large; cache daily)
- `GET /draft/<draft_id>/picks` → picks incl. `player_id`, `metadata`,
  **`is_keeper`** flag (helps validate which players were kept)
- `GET /state/nfl` → current `week` / `season` / `season_type` (lets the daily
  job know where in the calendar it is)
- Avatars: `https://sleepercdn.com/avatars/<avatar_id>`

**Linking:** each league's `previous_league_id` chains seasons for history.
**Rate limit (confirmed in docs):** stay under 1000 calls/min — our once-daily
job is nowhere near it.
**Gotcha:** `is_keeper` flags a kept pick, but keeper *cost/eligibility* rules
are still ours to encode.

---

## 6. Historical data (two sources)

The league dates to 2017; not all of that lived on Sleeper. So history has two
feeds, merged in Firestore:

- **Sleeper (automated):** `previous_league_id` chaining pulls standings,
  rosters, drafts, and results for every season the league existed on Sleeper.
- **Spreadsheet seed (one-time import):** champions 2017→2025 (Results tab) and
  keeper history 2019→2025 (Keepers tab) — covering seasons that predate Sleeper
  or that the API can't reconstruct (esp. keeper designations).

**Boundary: 2021 is the first Sleeper season.**
- 2021→present: pull from the Sleeper API (standings, rosters, drafts, picks).
- 2017→2020: spreadsheet seed only (champions from Results; keepers 2019→2020
  from Keepers).
- Keeper *designations* seed from the spreadsheet even for 2021+ seasons, since
  the API doesn't expose them cleanly.

---

## 7. Pages (Phase 1)

1. **Keeper Selections** — declared keepers by season with a **YEAR dropdown**
   to browse previous years (digitized Keepers tab, 2019→present): Player /
   Service Years / Round Kept At + flags, per owner.
2. **My Team** — pick a team, then an interactive keeper planner. The primary
   page (replaces the removed Keeper Board):
   - highlight/select players to see each one's keeper draft cost and eligibility
   - checks whether you hold the **draft capital** (the right-round pick) to keep
     them, flagging missing picks
   - draft capital shows the **exact pick** (round.pick, e.g. 2.04), lists
     **multiple picks in the same round**, and marks picks acquired by trade
     with the original owner
   - select up to 4 keepers (min 2; rule 2 position check at exactly 4; rule 9
     same-round bump applied)
   - **live summary of total draft cost** for the selected keepers
   - Phase 1: a non-binding planning calculator, open to any team. Phase 2 ties
     it to manager logins for official declarations.
3. **Champions & Records** — champions 2017→present, accolades, all-time
   records. All-time title ties break by **most recent** title.
4. **League Rules** — the 13 rules, cleanly presented (single-column list).
5. **Commissioner Admin (password protected)** — declare each season's keepers
   plus override editor for any computed value, penalties, and IR exemptions.
   See security note.

*(A separate league-wide "Keeper Board" page was prototyped and removed — the
per-team planner covers it.)*

### Admin security note
A static site can't keep a secret in the browser, so a client-side password only
hides the UI — it does not protect the data. Because overrides WRITE to
Firestore, real protection lives in **Firestore security rules** backed by
**Firebase Auth**. Recommendation: one commissioner Firebase Auth account
(email/password) even in Phase 1 — the "password gate" is that login, and rules
allow writes only for that authenticated UID. Everyone else is read-only.

---

## 8. Phasing

- **Phase 1 (now):** Read-only for the whole league. Commissioner controls rules
  + seed data + overrides. No manager logins.
- **Phase 2 (later):** Manager sign-in (Firebase Auth) so each manager declares
  their own keepers directly in the app.

---

## 9. Inputs status — all resolved

- ✅ Source spreadsheet received (`Keeper tracker 2025.xlsx`).
- ✅ League ID, full rule set, tracker PDFs, owner list, champions history.
- ✅ Refresh cadence: **once per day**.
- ✅ Datastore: **Firestore**.
- ✅ First Sleeper season: **2021** (API 2021+, seed 2017–2020).
- ✅ Page list finalized (section 7).
- ✅ Admin auth approach: **Firebase Auth commissioner login** (recommended over
  a client-side password) — pending your OK.

**Plan is build-ready pending your explicit go-ahead.**

---

## Decision log

- Audience: commissioner-managed; whole league views read-only in Phase 1;
  manager keeper-selection deferred to Phase 2.
- Hosting: GitHub Pages (static) + Firebase.
- Rate limits handled by moving all Sleeper calls into a scheduled job.
- Commissioner override is a first-class feature over every computed value.
- League ID: 1389688843191488512.
- Current tracker digitized: website automates `2025 Keeper Selections` +
  `2025 Keeper Roster`. Draft-capital checks are folded into the My Team planner.
- Owner list captured (10 managers).
- Final page set: Keeper Board, Keeper Selections (year dropdown), My Team
  (interactive planner), Champions & Records, League Rules, Commissioner Admin.
- First Sleeper season 2021: API 2021+, spreadsheet seed 2017-2020.
- Admin: Firebase Auth commissioner login + Firestore security rules (a bare
  client-side password on a static site is not real protection).
- Live pipeline validated: pulled all 10 teams' 2025 end rosters, draft rounds,
  is_keeper flags, IR, and 2026 traded picks from the Sleeper API — powers the
  interactive mockup (`mockup.html`).
- 2026 keeper declarations are entered in the Commissioner Console (Phase 1);
  Phase 2 lets each manager submit from My Team.
- OPEN: confirm TE roster slot (rule 12 omits it; Sleeper has it).
- Vibe locked: Sleeper-native (dark-first, position colors, rounded cards).
- RESOLVED: rule 9 bump can reach R1; bumped-in keeper inherits rule 5 1-yr max.
- RESOLVED: rule 2 enforced only at exactly 4 keepers.
- RESOLVED: seed from `Keeper tracker 2025.xlsx` (Keepers 2019-25, Results
  2017-25 champions, Team Tracker current rosters + pick ledger).
- RESOLVED: refresh cadence = once per day; datastore = Firestore.
- RESOLVED: league founded 2017; history is two-source (Sleeper API +
  spreadsheet seed).
- REMAINING before build: which season the league moved onto Sleeper.
