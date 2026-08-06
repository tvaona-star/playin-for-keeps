const RULES = [
  'Keep up to 4 keepers each season — and you must keep at least 2.',
  "You can't keep the same position for all 4 keeper slots.",
  'A player can be kept 2 additional years: draft/FA season plus 2 more.',
  'Each year you keep a player, they cost a pick one round earlier than last year.',
  'First-rounders can be kept for one year, maximum.',
  'Players Out/IR who miss the last game of the fantasy season carry no penalty next year — no round-up and no added service year.',
  'In-season free-agent pickups cost a 9th-round pick. But an FA you originally drafted keeps its original round, even after a drop and re-add.',
  'Traded players retain the draft round from their previous owner.',
  'If two keepers land in the same round, the second costs one round earlier (two 6ths → a 5th and a 6th).',
  'Not setting your lineup draws a penalty, starting with the loss of a keeper round.',
  "Keepers are declared one week before the draft, so everyone knows who's available.",
  'Roster: 2 QB · 2 RB · 3 WR · 1 TE · 1 FLEX · 1 DEF · 5 BN · IR spots.',
  "Commissioner's discretion governs rule interpretation and discipline for conduct detrimental.",
]

// Commissioner rulings that set precedent under rule 13.
const PRECEDENT = [
  {
    q: 'Does changing owners reset a player\'s service years?',
    a: 'No. Service years follow the player, not the roster. A player who has already been kept the maximum stays ineligible even if he is dropped and picked up off waivers by someone else. Rule 7 still sets the cost of a waiver pickup (a 9th), but rule 3 decides whether he can be kept at all.',
  },
]

export default function Rules() {
  return (
    <section className="view">
      <div className="section-head">
        <div>
          <div className="eyebrow">The house rules</div>
          <h2>League Rules</h2>
          <p className="lead">
            The single source of truth for keeper eligibility and cost. The site's
            engine encodes every rule; the commissioner has final say on interpretation.
          </p>
        </div>
      </div>
      <div className="rules">
        <div className="card">
          {RULES.map((text, i) => (
            <div className="rule" key={i}>
              <span className="rn">{i + 1}</span>
              <p>{text}</p>
            </div>
          ))}
        </div>

        <div className="subhead">Commissioner rulings (rule 13 precedent)</div>
        <div className="card">
          {PRECEDENT.map((p, i) => (
            <div className="rule" key={i} style={{ display: 'block' }}>
              <p style={{ fontWeight: 700, marginBottom: 6 }}>{p.q}</p>
              <p style={{ color: 'var(--ink-2)' }}>{p.a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
