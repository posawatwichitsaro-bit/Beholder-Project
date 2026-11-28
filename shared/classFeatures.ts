import type { DamageKind, Sheet } from './model.ts'

/**
 * Class resource buttons (0.13): the few with a clear rule are worked out —
 * Rage, Second Wind, Bardic Inspiration — and every other resource is spent
 * and logged. Numbers come from the SRD 5.2.1 class tables.
 */
export type FeatureKey = 'rage' | 'secondWind' | 'bardicInspiration'
export const featureResource: Record<FeatureKey, string> = { rage: 'Rage', secondWind: 'Second Wind', bardicInspiration: 'Bardic Inspiration' }

/** The level in one class from the class line ("Fighter 5 / Wizard 2" → Fighter 5). */
export function levelIn(sheet: Pick<Sheet, 'classLevel'>, name: string) {
  return Number(new RegExp('\\b' + name + '\\s*(\\d{1,2})', 'i').exec(sheet.classLevel)?.[1] ?? 0)
}
/** Rage Damage column: +2, +3 at level 9, +4 at level 16. */
export const rageDamage = (barbarianLevel: number) => barbarianLevel >= 16 ? 4 : barbarianLevel >= 9 ? 3 : 2
/** Bardic Die column: d6, d8 at level 5, d10 at 10, d12 at 15. */
export const bardicDie = (bardLevel: number) => bardLevel >= 15 ? 12 : bardLevel >= 10 ? 10 : bardLevel >= 5 ? 8 : 6

export const isRaging = (sheet: Pick<Sheet, 'effects'>) => Boolean(sheet.effects?.some(effect => effect.condition === 'Raging'))
/** Rage: Resistance to Bludgeoning, Piercing and Slashing damage. */
export const resists = (sheet: Pick<Sheet, 'effects'>, kind: DamageKind) => isRaging(sheet) && ['bludgeoning', 'piercing', 'slashing'].includes(kind)

/** The Bardic Inspiration die a creature holds (from its "Inspired" effect), if any. */
export function inspirationDie(sheet: Pick<Sheet, 'effects'>) {
  const effect = sheet.effects?.find(entry => entry.condition === 'Inspired')
  return effect ? Number(/d(\d+)/.exec(effect.sourceLabel ?? '')?.[1] ?? 6) : undefined
}

/** Add a flat bonus to a dice formula's modifier: "1d8+3" + 2 = "1d8+5". */
export function plusModifier(formula: string, bonus: number) {
  const match = /^(.*?)([+-]\d+)?$/.exec(formula.replace(/\s/g, ''))!
  const total = Number(match[2] ?? 0) + bonus
  return match[1] + (total ? (total > 0 ? '+' : '') + total : '')
}
