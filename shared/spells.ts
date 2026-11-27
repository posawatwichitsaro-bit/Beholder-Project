import type { Ability } from './model.ts'

/**
 * SRD 5.2.1 spells (CC BY 4.0), built by scripts/extract-srd-spells.mjs into
 * public/data/srd-spells.json. The fields a table automates — attack or save,
 * damage, healing, area, slot scaling, a condition on a failed save — are read
 * from the spell text; anything else stays in `description` for people to read.
 */
export type AreaShape = 'Sphere' | 'Cone' | 'Cube' | 'Line' | 'Cylinder' | 'Emanation'
export type Spell = {
  id: string; name: string; level: number; school: string; classes: string[]
  castingTime: string; range: string; components: string; duration: string
  concentration: boolean; ritual: boolean
  attack?: 'melee' | 'ranged'
  save?: Ability; half?: boolean
  damage?: string; damageType?: string
  healing?: string; healingAddsModifier?: boolean
  area?: { shape: AreaShape; size: number }
  condition?: string
  /** Dice added for each slot level above the spell's own ("1d6"). */
  perSlot?: string
  /** Dice added at character levels 5, 11 and 17 for a cantrip. */
  cantripScaling?: string
  description: string; higherLevels?: string; cantripUpgrade?: string
  source: { pdfPage: number }
}

export function catalogSpells(data: unknown): Spell[] {
  const spells = (data as { spells?: Spell[] })?.spells
  if (!Array.isArray(spells)) throw new Error('ข้อมูลเวทไม่ถูกต้อง')
  return spells
}

/** Add `extra` dice of the same size to a formula's first dice group: "8d6" + "2d6" = "10d6"; different sizes are appended. */
export function addDice(formula: string, extra: string) {
  const [count, sides] = extra.split('d').map(Number)
  const match = /^(\d+)d(\d+)/.exec(formula)
  if (match && Number(match[2]) === sides) return Number(match[1]) + count + 'd' + sides + formula.slice(match[0].length)
  return formula + '+' + extra
}

/** How many times an amount is added: slot levels above the spell's own, or cantrip tiers reached (5, 11, 17). */
export const tiersAbove = (spell: Pick<Spell, 'level'>, slotLevel: number) => Math.max(0, slotLevel - spell.level)
export const cantripTiers = (characterLevel: number) => (characterLevel >= 17 ? 3 : characterLevel >= 11 ? 2 : characterLevel >= 5 ? 1 : 0)

/** The dice a spell rolls when cast with a slot of `slotLevel` (cantrips: at `characterLevel`). */
export function scaledDice(spell: Spell, base: string | undefined, slotLevel: number, characterLevel: number) {
  if (!base) return undefined
  let formula = base
  const times = spell.level === 0 ? cantripTiers(characterLevel) : tiersAbove(spell, slotLevel)
  const step = spell.level === 0 ? spell.cantripScaling : spell.perSlot
  if (step) for (let index = 0; index < times; index++) formula = addDice(formula, step)
  return formula
}

/** Area templates the board draws: size in squares (5 ft each) and the area tool's kind. */
export function areaFor(spell: Pick<Spell, 'area'>) {
  if (!spell.area) return undefined
  const squares = spell.area.size / 5
  const kind = spell.area.shape === 'Cone' ? 'cone' : spell.area.shape === 'Line' ? 'line' : spell.area.shape === 'Cube' ? 'cube' : 'sphere'
  return { kind, squares } as const
}

/** Prepared-spell limits are per class table; this is the simple count shown against them. */
export const isCantrip = (spell: Pick<Spell, 'level'>) => spell.level === 0
