import { rollAccent, rollBreakdown, type DiceRoll, type DieShown } from '../../model/dice.ts'

/** How many d20 results fit on the dice button. */
const COMPACT_D20S = 3

/**
 * A roll's result, read the way the table reads it (see `rollBreakdown`): d20s
 * one by one with the modifier (20s in gold, 1s in red, a dropped die struck
 * through); other dice each as rolled, then the total. `compact` (the dice
 * button) shows only the total for those, and the first few d20s.
 */
export function RollResult({ roll, className, compact = false }: { roll: DiceRoll; className: string; compact?: boolean }) {
  const breakdown = rollBreakdown(roll)

  if (breakdown.kind === 'each') {
    const label = breakdown.dice.map((die) => (die.discarded ? `${die.value} dropped` : `${die.value}`)).join(', ')
    // On the dice button there's room for a few; the rest are counted.
    const shown = compact ? breakdown.dice.slice(0, COMPACT_D20S) : breakdown.dice
    const more = breakdown.dice.length - shown.length
    return (
      <span className={`${className} roll-split`} aria-label={`Each d20: ${label}`}>
        {shown.map((die, i) => (
          <Die key={i} die={die} />
        ))}
        {more > 0 ? <span className="roll-more">+{more}</span> : null}
      </span>
    )
  }

  if (breakdown.kind === 'sum' && !compact) {
    return (
      <span className={`${className} roll-sum`}>
        <span className="roll-parts" aria-label={`Dice: ${breakdown.dice.map((die) => die.value).join(', ')}`}>
          {breakdown.dice.map((die, i) => (
            <Die key={i} die={die} />
          ))}
        </span>
        <span className="roll-sum-total">{breakdown.total}</span>
      </span>
    )
  }

  const accent = rollAccent(roll)
  return <span className={`${className}${accent ? ` is-${accent}` : ''}`}>{roll.total}</span>
}

function Die({ die }: { die: DieShown }) {
  const classes = ['roll-each', die.accent ? `is-${die.accent}` : '', die.discarded ? 'is-dropped' : ''].filter(Boolean)
  return <span className={classes.join(' ')}>{die.value}</span>
}
