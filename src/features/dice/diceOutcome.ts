import type { Roll } from '../../../shared/model.ts'

export type DiceOutcome = 'critical' | 'fumble' | 'normal'

/** The die a roll shows: d20 for checks, saves and attacks, else the first die in the formula. */
export function dieOf(roll: Pick<Roll, 'formula'>) {
  const match = /d(\d+)/i.exec(roll.formula)
  return match ? Number(match[1]) : 20
}

/**
 * A natural 20 or 1 on a d20 roll. The natural face is the total minus the
 * modifier, which also holds for advantage/disadvantage (the kept die).
 * An attack the server marked critical always counts as a natural 20.
 */
export function diceOutcome(roll: Pick<Roll, 'formula' | 'total' | 'modifier' | 'critical' | 'faces'>): DiceOutcome {
  if (roll.critical) return 'critical'
  if (dieOf(roll) !== 20 || !/^\s*\d*d20/i.test(roll.formula)) return 'normal'
  const natural = roll.total - roll.modifier
  if (natural === 20 && roll.faces.includes(20)) return 'critical'
  if (natural === 1 && roll.faces.includes(1)) return 'fumble'
  return 'normal'
}

/** The number shown on the die face: the kept d20, or the dice total without modifiers. */
export function faceOf(roll: Pick<Roll, 'total' | 'modifier' | 'faces'>) {
  return roll.faces.length ? roll.total - roll.modifier : roll.total
}
