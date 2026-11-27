import type { Sheet } from './model.ts'

/**
 * Action economy for one creature in a fight (0.12): a helper that counts and
 * warns, never a gate. Weapon attacks share an Action up to the creature's
 * attacks per Action (Extra Attack, Multiattack); a spell attack or a save
 * spell takes a whole Action; Action Surge adds one Action; Reaction comes
 * back at the start of the creature's own turn.
 */
export type TurnUse = {
  weaponAttacks: number; spellActions: number; manualActions: number; extraActions: number
  bonus: number; reaction: boolean; disengaged: boolean
}
export const freshUse = (): TurnUse => ({ weaponAttacks: 0, spellActions: 0, manualActions: 0, extraActions: 0, bonus: 0, reaction: false, disengaged: false })

const numbers: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }

/** Attacks in a monster's Multiattack ("makes two attacks", "one Bite attack and two Claw attacks" = 3); undefined when it has none or says it differently. */
export function multiattack(statBlock = '') {
  const at = statBlock.search(/Multiattack\./)
  if (at < 0) return undefined
  let text = statBlock.slice(at + 12, at + 600).replace(/-\n/g, '').replace(/\s+/g, ' ')
  const end = text.search(/\.\s+[A-Z]/)
  if (end >= 0) text = text.slice(0, end + 1)
  let total = 0
  for (const match of text.matchAll(/\b(one|two|three|four|five|six)\b(?:\s+[\w'’-]+){0,6}?\s+attacks?\b/gi)) total += numbers[match[1].toLowerCase()]
  return total || undefined
}

/** Extra Attack from class levels (the highest one counts; they don't stack). */
export function extraAttacks(classLevel: string) {
  let best = 1
  for (const [, name, level] of classLevel.matchAll(/([A-Za-z]+)\s*(\d{1,2})/g)) {
    const n = Number(level)
    const value = name.toLowerCase() === 'fighter' ? n >= 20 ? 4 : n >= 11 ? 3 : n >= 5 ? 2 : 1
      : ['barbarian', 'monk', 'paladin', 'ranger'].includes(name.toLowerCase()) && n >= 5 ? 2 : 1
    best = Math.max(best, value)
  }
  return best
}

/** Weapon attacks one Attack action allows: the sheet's own number, else Multiattack, else Extra Attack. */
export function attacksPerAction(sheet: Pick<Sheet, 'classLevel' | 'monsterReference' | 'attacksPerAction'>) {
  return sheet.attacksPerAction ?? multiattack(sheet.monsterReference?.statBlock) ?? extraAttacks(sheet.classLevel)
}

/** Actions used so far this turn (weapon attacks fill Actions `perAction` at a time) and the Actions this turn allows. */
export function actionCount(use: TurnUse, perAction: number) {
  return {
    used: Math.ceil(use.weaponAttacks / Math.max(1, perAction)) + use.spellActions + use.manualActions,
    allowed: 1 + use.extraActions
  }
}

/** Melee reach in feet: 10 for a Reach weapon or a stat block "reach 10 ft", else 5. */
export function reachOf(sheet: Pick<Sheet, 'attacks' | 'monsterReference'>) {
  const block = /reach\s+(\d+)\s*ft/i.exec(sheet.monsterReference?.statBlock ?? '')
  if (block) return Number(block[1])
  return sheet.attacks?.some(attack => /\bReach\b/.test(attack.notes ?? '')) ? 10 : 5
}

/** Squares between two tokens' edges (0 = touching or overlapping). */
export function gapBetween(a: { x: number; y: number }, aSize: number, b: { x: number; y: number }, bSize: number) {
  return Math.max(0, b.x - (a.x + aSize), a.x - (b.x + bSize), b.y - (a.y + aSize), a.y - (b.y + bSize))
}
