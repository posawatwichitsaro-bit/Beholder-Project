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

/** The area tool's shape for a spell (shared/area.ts): radius for spheres, side for cubes, length for cones and lines, in squares of 5 ft. */
export function areaFor(spell: Pick<Spell, 'area'>) {
  if (!spell.area) return undefined
  const squares = spell.area.size / 5
  const kind = spell.area.shape === 'Cone' ? 'cone' : spell.area.shape === 'Line' ? 'line' : spell.area.shape === 'Cube' ? 'rectangle' : 'circle'
  return { kind, squares } as const
}


/** Each class line "Wizard 5 / Cleric 2" as name and level. */
export const classesIn = (classLevel: string) =>
  [...classLevel.matchAll(/([A-Za-z]+)\s*(\d{1,2})/g)].map(match => ({ name: match[1], level: Number(match[2]) }))

/** Prepared Spells and Cantrips columns of the SRD 5.2.1 class tables (index = class level − 1). */
const fullPrepared = [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22]
const halfPrepared = [2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15]
const preparedTable: Record<string, number[]> = {
  Bard: fullPrepared, Cleric: fullPrepared, Druid: fullPrepared,
  Wizard: [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 18, 19, 21, 22, 23, 24, 25],
  Sorcerer: [2, 4, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22],
  Warlock: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
  Paladin: halfPrepared, Ranger: halfPrepared
}
const cantripTable: Record<string, [number, number, number]> = {
  Bard: [2, 3, 4], Cleric: [3, 4, 5], Druid: [2, 3, 4], Sorcerer: [4, 5, 6], Warlock: [2, 3, 4], Wizard: [3, 4, 5]
}

/** How many level 1+ spells and cantrips a class line may prepare (summed for a multiclass); undefined when no class casts. */
export function spellLimits(classLevel: string) {
  let prepared = 0
  let cantrips = 0
  let casts = false
  for (const { name, level } of classesIn(classLevel)) {
    const row = preparedTable[name]
    if (!row || level < 1) continue
    casts = true
    prepared += row[Math.min(20, level) - 1]
    const tiers = cantripTable[name]
    if (tiers) cantrips += tiers[level >= 10 ? 2 : level >= 4 ? 1 : 0]
  }
  return casts ? { prepared, cantrips } : undefined
}

/** SRD spells named in a sheet's old free-text field ("Fire Bolt, cure wounds; Shield"), longest names first so "Mass Cure Wounds" wins over "Cure Wounds". */
export function spellsInText(text: string, spells: Pick<Spell, 'id' | 'name'>[]) {
  let rest = ' ' + text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9/]+/g, ' ') + ' '
  const found: string[] = []
  for (const spell of [...spells].sort((a, b) => b.name.length - a.name.length)) {
    const name = ' ' + spell.name.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9/]+/g, ' ').trim() + ' '
    if (!rest.includes(name)) continue
    found.push(spell.id)
    rest = rest.split(name).join('  ')
  }
  return found
}
