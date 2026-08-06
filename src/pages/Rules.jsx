const RULES = [
  ['Keep up to 4 keepers each season — and you must keep at least 2.', false],
  ["You can't keep the same position for all 4 keeper slots.", false],
  ['A player can be kept 2 additional years: draft/FA season plus 2 more.', false],
  ['Each year you keep a player, they cost a pick one round earlier than last year.', true],
  ['First-rounders can be kept for one year, maximum.', false],
  ['Players Out/IR who miss the last game of the fantasy season carry no penalty next year — no round-up and no added service year.', false],
  ['In-season free-agent pickups cost a 9th-round pick. But an FA you originally drafted keeps its original round, even after a drop and re-add.', true],
  ['Traded players retain the draft round from their previous owner.', false],
  ['If two keepers land in the same round, the second costs one round earlier (two 6ths → a 5th and a 6th).', true],
  ['Not setting your lineup draws a penalty, starting with the loss of a keeper round.', false],
  ["Keepers are declared one week before the draft, so everyone knows who's available.", false],
  ['Roster: 2 QB · 2 RB · 3 WR · 1 TE · 1 FLEX · 1 DEF · 5 BN · IR spots.', false],
  ["Commissioner's discretion governs rule interpretation and discipline for conduct detrimental.", true],
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
          {RULES.map(([text, hilite], i) => (
            <div className={`rule${hilite ? ' hilite' : ''}`} key={i}>
              <span className="rn">{i + 1}</span>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
