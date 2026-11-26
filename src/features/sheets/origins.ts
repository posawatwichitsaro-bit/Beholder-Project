import { abilities } from '../../../shared/model.ts'
import type { Ability, Size } from '../../../shared/model.ts'
import type { Skill } from '../../../shared/characterStats.ts'

/**
 * Character origins and ability-score methods from SRD 5.2.1 (2024 rules).
 * Only what the SRD has: its four backgrounds and nine species. Anything
 * else stays a free-text entry the player types themselves.
 */

export type BackgroundName = 'Acolyte' | 'Criminal' | 'Sage' | 'Soldier'
export const backgrounds: Record<BackgroundName, { abilities: [Ability, Ability, Ability]; feat: string; skills: [Skill, Skill]; tool: string }> = {
  Acolyte: { abilities: ['INT', 'WIS', 'CHA'], feat: 'Magic Initiate (Cleric)', skills: ['Insight', 'Religion'], tool: 'Calligrapher’s Supplies' },
  Criminal: { abilities: ['DEX', 'CON', 'INT'], feat: 'Alert', skills: ['Sleight of Hand', 'Stealth'], tool: 'Thieves’ Tools' },
  Sage: { abilities: ['CON', 'INT', 'WIS'], feat: 'Magic Initiate (Wizard)', skills: ['Arcana', 'History'], tool: 'Calligrapher’s Supplies' },
  Soldier: { abilities: ['STR', 'DEX', 'CON'], feat: 'Savage Attacker', skills: ['Athletics', 'Intimidation'], tool: 'Gaming Set' }
}

export type SpeciesName = 'Dragonborn' | 'Dwarf' | 'Elf' | 'Gnome' | 'Goliath' | 'Halfling' | 'Human' | 'Orc' | 'Tiefling'
export const species: Record<SpeciesName, { sizes: Size[]; speed: number; darkvision?: number; traits: string[] }> = {
  Dragonborn: { sizes: ['Medium'], speed: 30, darkvision: 60, traits: ['Draconic Ancestry', 'Breath Weapon', 'Damage Resistance', 'Draconic Flight (level 5)'] },
  Dwarf: { sizes: ['Medium'], speed: 30, darkvision: 120, traits: ['Dwarven Resilience', 'Dwarven Toughness', 'Stonecunning'] },
  Elf: { sizes: ['Medium'], speed: 30, darkvision: 60, traits: ['Elven Lineage', 'Fey Ancestry', 'Keen Senses', 'Trance'] },
  Gnome: { sizes: ['Small'], speed: 30, darkvision: 60, traits: ['Gnomish Cunning', 'Gnomish Lineage'] },
  Goliath: { sizes: ['Medium'], speed: 35, traits: ['Giant Ancestry', 'Large Form (level 5)', 'Powerful Build'] },
  Halfling: { sizes: ['Small'], speed: 30, traits: ['Brave', 'Halfling Nimbleness', 'Luck', 'Naturally Stealthy'] },
  Human: { sizes: ['Medium', 'Small'], speed: 30, traits: ['Resourceful', 'Skillful', 'Versatile'] },
  Orc: { sizes: ['Medium'], speed: 30, darkvision: 120, traits: ['Adrenaline Rush', 'Relentless Endurance'] },
  Tiefling: { sizes: ['Medium', 'Small'], speed: 30, darkvision: 60, traits: ['Fiendish Legacy', 'Otherworldly Presence'] }
}
export const isSpecies = (name: string | undefined): name is SpeciesName => Boolean(name && Object.hasOwn(species, name))
export const isBackground = (name: string | undefined): name is BackgroundName => Boolean(name && Object.hasOwn(backgrounds, name))

/** "Elf · Darkvision 60 ft." — the species line kept on the sheet. */
export function speciesLine(name: string) {
  const info = isSpecies(name) ? species[name] : undefined
  return info?.darkvision ? name + ' · Darkvision ' + info.darkvision + ' ft.' : name
}

/** The background's ability increase: +2 and +1 to two of its three abilities, or +1 to all three. */
export type BackgroundBonus = { mode: 'two-one'; plus2: Ability; plus1: Ability } | { mode: 'three' }

/** Base scores plus the background increase, each capped at 20. Without a background the scores pass through. */
export function withBackground(base: Record<Ability, number>, background: string | undefined, bonus: BackgroundBonus | undefined) {
  const scores = { ...base }
  if (!isBackground(background) || !bonus) return scores
  const allowed = backgrounds[background].abilities
  const raise = (ability: Ability, amount: number) => { if (allowed.includes(ability)) scores[ability] = Math.min(20, scores[ability] + amount) }
  if (bonus.mode === 'three') allowed.forEach(ability => raise(ability, 1))
  else if (bonus.plus2 !== bonus.plus1) { raise(bonus.plus2, 2); raise(bonus.plus1, 1) }
  return scores
}

/** Point Buy: scores 8–15 before the background, 27 points, costs 0,1,2,3,4,5,7,9. */
export const pointBuyBudget = 27
const pointCosts: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 }
export function pointBuyCost(scores: Record<Ability, number>) {
  return abilities.reduce((total, ability) => total + (pointCosts[scores[ability]] ?? Infinity), 0)
}

/** 4d6, keep the highest three — six times. `random` returns 1–6. */
export function rollAbilityScores(random: () => number) {
  return Array.from({ length: 6 }, () => {
    const dice = [random(), random(), random(), random()].sort((a, b) => b - a)
    return dice[0] + dice[1] + dice[2]
  }).sort((a, b) => b - a)
}

/** True when the six scores are exactly the Standard Array in some order. */
export function isStandardArray(scores: Record<Ability, number>) {
  return abilities.map(ability => scores[ability]).sort((a, b) => b - a).join() === '15,14,13,12,10,8'
}
