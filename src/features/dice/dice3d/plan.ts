import type { Roll } from '../../../../shared/model.ts'

/**
 * Which physical dice a roll shows, and the face each one lands on. Pure: the
 * 3D tray draws exactly this. The server already rolled; the dice only replay
 * its faces, so nothing on screen can change a result.
 *
 * - each `NdS` group in the formula, in order, takes the next N faces
 * - a d20 rolled with Advantage or Disadvantage has two faces for one "1d20"
 * - a d100 shows as two d10: tens (00–90) and units (0–9)
 * - more than six dice, or a roll without faces, shows no 3D dice
 */
export type Die = { sides: 4 | 6 | 8 | 10 | 12 | 20; value: number; label?: string; percentile?: 'tens' | 'units' }
export const maxDice = 6
const kinds = new Set([4, 6, 8, 10, 12, 20, 100])

export function diceFor(roll: Pick<Roll, 'formula' | 'faces'>): Die[] | undefined {
  const faces = roll.faces
  if (!faces.length) return undefined
  const groups = [...roll.formula.replace(/\s/g, '').toLowerCase().matchAll(/(\d{0,3})d(\d+)/g)]
    .map(([, count, sides]) => ({ count: Number(count || 1), sides: Number(sides) }))
  if (!groups.length || groups.some(group => !kinds.has(group.sides))) return undefined
  // Advantage / Disadvantage: one d20 in the formula, two faces rolled.
  const expanded = groups.flatMap(group => Array.from({ length: group.count }, () => group.sides))
  const sidesList = expanded.length === faces.length ? expanded
    : groups.length === 1 && groups[0].count === 1 && groups[0].sides === 20 && faces.length === 2 ? [20, 20] : undefined
  if (!sidesList) return undefined
  const dice: Die[] = []
  sidesList.forEach((sides, index) => {
    const value = faces[index]
    if (sides === 100) {
      const tens = Math.floor((value % 100) / 10)
      const units = value % 10
      dice.push({ sides: 10, value: tens === 0 ? 10 : tens, label: tens * 10 === 0 ? '00' : String(tens * 10), percentile: 'tens' })
      dice.push({ sides: 10, value: units === 0 ? 10 : units, label: String(units), percentile: 'units' })
    } else dice.push({ sides: sides as Die['sides'], value })
  })
  return dice.length <= maxDice ? dice : undefined
}

/** The text on face `n` (1-based) of a die: plain numbers, d10 shows 0 for 10, percentile tens show 00–90. */
export function faceLabel(sides: number, n: number, percentile?: 'tens' | 'units') {
  if (percentile === 'tens') return n === 10 ? '00' : String(n * 10)
  if (percentile === 'units' || sides === 10) return n === 10 ? '0' : String(n)
  return String(n)
}
