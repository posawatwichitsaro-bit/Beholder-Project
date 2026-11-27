import type { Ability, ClassResource, HitDie, ShortRestRecovery, Sheet } from './model.ts'
import { abilityModifier, hitDiceByClass } from './characterStats.ts'
import { srdSubclasses, subclassResources } from './progression.ts'
import { formatSlots, parseSlots } from './conditions.ts'

/**
 * Short and Long Rest, Hit Dice and class resources (SRD 5.2.1, 2024 rules):
 * - Short Rest: spend Hit Dice, each heals max(1, roll + CON); some resources come back.
 * - Long Rest (needs at least 1 HP): full HP, all spent Hit Dice, all spell slots and
 *   resources back, Temporary HP gone, Exhaustion down one level.
 */

export type { ClassResource, HitDie, ShortRestRecovery }

export const classNames = Object.keys(hitDiceByClass) as (keyof typeof hitDiceByClass)[]
type ClassName = keyof typeof hitDiceByClass

/** "Fighter 3 / Wizard 1" → [{ name: 'Fighter', level: 3 }, { name: 'Wizard', level: 1 }]. */
export function readClasses(classLevel: string): { name: ClassName; level: number }[] {
  const found: { name: ClassName; level: number }[] = []
  for (const [, word, level] of classLevel.matchAll(/([A-Za-z]+)\s*(\d{1,2})/g)) {
    const name = classNames.find(entry => entry.toLowerCase() === word.toLowerCase())
    if (name && !found.some(entry => entry.name === name)) found.push({ name, level: Math.max(1, Math.min(20, Number(level))) })
  }
  return found
}

/** Total Hit Dice by size: from the HP calculator, else the class line, else "3d8"-style details. */
export function hitDicePool(sheet: Pick<Sheet, 'classLevel' | 'calculations' | 'characterDetails'>): Partial<Record<HitDie, number>> {
  const pool: Partial<Record<HitDie, number>> = {}
  const add = (die: number, count: number) => {
    const key = ('d' + die) as HitDie
    if (['d6', 'd8', 'd10', 'd12'].includes(key) && count > 0) pool[key] = (pool[key] ?? 0) + count
  }
  const classes = sheet.calculations?.hp?.classes
  if (classes?.length) classes.forEach(entry => add(entry.die, entry.levels))
  else {
    const fromClass = readClasses(sheet.classLevel)
    if (fromClass.length) fromClass.forEach(entry => add(hitDiceByClass[entry.name], entry.level))
    else for (const [, count, die] of (sheet.characterDetails?.hitDice ?? '').matchAll(/(\d{1,2})\s*d\s*(6|8|10|12)\b/gi)) add(Number(die), Number(count))
  }
  return pool
}

export function hitDiceLeft(sheet: Pick<Sheet, 'classLevel' | 'calculations' | 'characterDetails' | 'hitDiceSpent'>) {
  const pool = hitDicePool(sheet)
  return Object.fromEntries((Object.keys(pool) as HitDie[]).map(die => [die, { total: pool[die]!, left: Math.max(0, pool[die]! - (sheet.hitDiceSpent?.[die] ?? 0)) }])) as
    Partial<Record<HitDie, { total: number; left: number }>>
}

const step = (level: number, table: [number, number][]) => table.reduce((value, [from, count]) => level >= from ? count : value, 0)

/** Resources a class gives at a level, from the SRD class tables; empty when the class has none to track. */
export function resourcesFor(name: ClassName, level: number, abilities: Record<Ability, number>): ClassResource[] {
  const make = (resource: string, max: number, short: ShortRestRecovery): ClassResource[] => max > 0 ? [{ name: resource, max, used: 0, short }] : []
  switch (name) {
    case 'Barbarian': return make('Rage', step(level, [[1, 2], [3, 3], [6, 4], [12, 5], [17, 6]]), 'one')
    case 'Bard': return make('Bardic Inspiration', Math.max(1, abilityModifier(abilities.CHA)), level >= 5 ? 'all' : 'none')
    case 'Cleric': return make('Channel Divinity', step(level, [[2, 2], [6, 3], [18, 4]]), 'one')
    case 'Druid': return make('Wild Shape', step(level, [[2, 2], [6, 3], [17, 4]]), 'one')
    case 'Fighter': return [...make('Second Wind', step(level, [[1, 2], [4, 3], [10, 4]]), 'one'),
      ...make('Action Surge', step(level, [[2, 1], [17, 2]]), 'all'), ...make('Indomitable', step(level, [[9, 1], [13, 2], [17, 3]]), 'none')]
    case 'Monk': return make('Focus Points', level >= 2 ? level : 0, 'all')
    case 'Paladin': return [...make('Lay On Hands', 5 * level, 'none'), ...make('Channel Divinity', step(level, [[3, 2], [11, 3]]), 'one')]
    case 'Ranger': return make('Favored Enemy', step(level, [[1, 2], [5, 3], [9, 4], [13, 5], [17, 6]]), 'none')
    case 'Sorcerer': return [...make('Sorcery Points', level >= 2 ? level : 0, 'none'), ...make('Innate Sorcery', 2, 'none')]
    case 'Wizard': return make('Arcane Recovery', 1, 'none')
    default: return []
  }
}

/** All class resources for a (multi)class line, plus the counted ones its SRD subclass adds. */
export function classResources(sheet: Pick<Sheet, 'classLevel' | 'abilities'> & { subclass?: string }) {
  const classes = readClasses(sheet.classLevel)
  const owner = classes.find(entry => srdSubclasses[entry.name]?.name === sheet.subclass)
  return [...classes.flatMap(entry => resourcesFor(entry.name, entry.level, sheet.abilities)),
    ...(owner ? subclassResources(sheet.subclass, owner.level, sheet.abilities) : [])].slice(0, 12)
}

/** One Hit Die: heals max(1, roll + CON modifier). */
export const hitDieHealing = (roll: number, con: number) => Math.max(1, roll + abilityModifier(con))

function lowerExhaustion(conditions: string) {
  return conditions.split(',').map(part => part.trim()).filter(Boolean).flatMap(part => {
    const match = /^Exhaustion(?:\s+([1-6]))?(:\d+)?$/i.exec(part)
    if (!match) return [part]
    const level = Number(match[1] ?? 1) - 1
    return level > 0 ? ['Exhaustion ' + level + (match[2] ?? '')] : []
  }).join(', ')
}

/** Exhaustion kept as an effect (with a source) also drops one level; at 0 it ends. */
function lowerExhaustionEffects(effects: NonNullable<Sheet['effects']>) {
  return effects.flatMap(effect => {
    if (effect.condition !== 'Exhaustion') return [effect]
    const level = (effect.level ?? 1) - 1
    return level > 0 ? [{ ...effect, level }] : []
  })
}

/** What changes on the sheet after a rest. Hit Dice for a Short Rest are spent one at a time, separately. */
export function restedSheet<T extends Sheet>(sheet: T, kind: 'short' | 'long'): T {
  const resources = (sheet.resources ?? []).map(resource => ({
    ...resource, used: kind === 'long' || resource.short === 'all' ? 0 : resource.short === 'one' ? Math.max(0, resource.used - 1) : resource.used
  }))
  const slots = parseSlots(sheet.slots)
  // Warlock Pact Magic slots come back on a Short Rest too.
  const pactMagic = readClasses(sheet.classLevel).some(entry => entry.name === 'Warlock')
  const restoreSlots = slots && (kind === 'long' || pactMagic)
  const pact = parseSlots(sheet.pactSlots ?? '')
  const pactBack = pact?.length ? { pactSlots: formatSlots(pact.map(slot => ({ ...slot, left: slot.max }))) } : {}
  // With Pact Magic apart, plain slots wait for a Long Rest even for a Warlock multiclass.
  const shortSlots = restoreSlots && sheet.pactSlots === undefined
  if (kind === 'short') return { ...sheet, resources, ...pactBack, ...(shortSlots ? { slots: formatSlots(slots.map(slot => ({ ...slot, left: slot.max }))) } : {}) }
  return {
    ...sheet, resources, hp: sheet.maxHp, tempHp: 0, hitDiceSpent: {}, conditions: lowerExhaustion(sheet.conditions),
    ...(sheet.effects ? { effects: lowerExhaustionEffects(sheet.effects) } : {}),
    life: 'active', successes: 0, failures: 0, cunningUsed: undefined, ...pactBack,
    ...(restoreSlots ? { slots: formatSlots(slots.map(slot => ({ ...slot, left: slot.max }))) } : {})
  }
}
