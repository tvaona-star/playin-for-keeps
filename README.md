# Playin' for Keeps — Keeper HQ

Keeper tracker for a 10-team fantasy football league on Sleeper. Read-only for
the league; the commissioner manages declarations and overrides.

```
Sleeper API ──(daily GitHub Action)──► public/data/league.json ──► static React site (GitHub Pages)
                                        Firestore (commissioner declarations & overrides)
```

All Sleeper calls happen in one daily sync job — visitors never hit the API, so
rate limits are a non-issue.

## Pages

- **My Team** — interactive keeper planner: pick up to 4 keepers, see each cost,
  the same-round bump rule, and whether you own the exact draft picks needed.
- **Keeper Selections** — season-by-season archive, 2019 → present.
- **Champions & Records** — title history since 2017.
- **League Rules** — the 13 house rules.
- **Commissioner** — Firebase-authenticated console for declaring keepers.

## Local development

```bash
npm install
npm run sync    # pull live Sleeper data -> public/data/league.json
npm run dev     # http://localhost:5173
```

## Deploy (GitHub Pages)

1. Push this repo to GitHub (branch `main`).
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. Done. The included workflow (`.github/workflows/sync-deploy.yml`)
   builds + deploys on every push and re-syncs Sleeper data daily at 10:00 UTC.

## Enable the Commissioner Console (Firebase)

The site is fully functional read-only without Firebase. To enable
declarations/overrides:

1. Create a Firebase project (or reuse an existing one) with **Firestore**.
2. **Authentication → Sign-in method → Email/Password → enable**, then add the
   commissioner's account under Users.
3. **Project settings → Your apps → Web app** — copy the config object into
   `src/firebase-config.js`.
4. **Firestore → Rules** — paste (replace the UID with the commissioner's):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read: if true;
      allow write: if request.auth != null
                   && request.auth.uid == 'COMMISSIONER_UID_HERE';
    }
  }
}
```

The web config is not a secret; all protection comes from these rules.

## Keeper engine

Per-player costs are computed at sync time in `scripts/sync.mjs`:

- Cost = draft round − 1 (rule 4); first-rounders keepable one year (rule 5).
- **Acquisition-aware basis**: a player's round carries over only if the owner
  drafted him (drop + re-add safe, rule 7) or acquired him by trade (rule 8).
  Waiver/FA pickups of another owner's draftee cost a 9th (rule 7).
- End-of-season IR: no round escalation and the year doesn't count (rule 6).
- Service years (rule 3, max 2 additional) seed from `seed/history.json`.

**Commissioner ruling (precedent, rule 13):** service years follow the *player*,
not the roster. A maxed-out keeper stays ineligible even after being dropped and
claimed off waivers by a different owner — rule 7 sets the *cost* of a waiver
pickup (a 9th), but rule 3 governs whether he is keepable at all. The seed
history is therefore keyed by player name, not by owner.

Slate-level rules (min 2 / max 4, position mix, same-round bump cascading into
Round 1) run client-side in `src/engine/keeper.js`.

Edge cases the engine flags for commissioner review appear in the console
("Seed records needing review"), and every computed value can be overridden.

## Data seeds (`seed/`)

- `history.json` — keeper archive 2019-2025 transcribed from the league tracker.
- `champions.json` — title history 2017-present.
- `owners.json` — Sleeper display names ↔ real names.
- `discipline.json` — commissioner discipline (rules 10 & 13), keyed by the
  season the penalty applies to. A `keeper_round` penalty with
  `target: "latest_round"` makes that manager's latest-round keeper cost N
  rounds earlier; it is shown on the League Rules page and enforced live in the
  Keeper Planner.

After each season: add the new keeper year to `history.json` and the champion to
`champions.json`.
