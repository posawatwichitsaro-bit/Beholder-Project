import { abilities, blankSheet } from '../../../shared/model.ts'
import type { Ability, DamageKind, Sheet } from '../../../shared/model.ts'
import { abilityModifier, armorPresets, calculatedSheet, hitDiceByClass, proficiencyForLevel } from '../../../shared/characterStats.ts'
import type { CheckBonus, HitDie } from '../../../shared/characterStats.ts'

/** Rules data for the character wizard, from the D&D 5e System Reference Document (SRD 5.2.1). */
export type ClassName = keyof typeof hitDiceByClass

export const classInfo: Record<ClassName, { saves: [Ability, Ability]; order: Ability[]; spellAbility?: Ability }> = {
  Barbarian: { saves: ['STR', 'CON'], order: ['STR', 'CON', 'DEX', 'WIS', 'CHA', 'INT'] },
  Bard: { saves: ['DEX', 'CHA'], order: ['CHA', 'DEX', 'CON', 'WIS', 'INT', 'STR'], spellAbility: 'CHA' },
  Cleric: { saves: ['WIS', 'CHA'], order: ['WIS', 'CON', 'STR', 'CHA', 'INT', 'DEX'], spellAbility: 'WIS' },
  Druid: { saves: ['INT', 'WIS'], order: ['WIS', 'CON', 'DEX', 'INT', 'CHA', 'STR'], spellAbility: 'WIS' },
  Fighter: { saves: ['STR', 'CON'], order: ['STR', 'CON', 'DEX', 'WIS', 'CHA', 'INT'] },
  Monk: { saves: ['STR', 'DEX'], order: ['DEX', 'WIS', 'CON', 'STR', 'INT', 'CHA'] },
  Paladin: { saves: ['WIS', 'CHA'], order: ['STR', 'CHA', 'CON', 'WIS', 'DEX', 'INT'], spellAbility: 'CHA' },
  Ranger: { saves: ['STR', 'DEX'], order: ['DEX', 'WIS', 'CON', 'STR', 'INT', 'CHA'], spellAbility: 'WIS' },
  Rogue: { saves: ['DEX', 'INT'], order: ['DEX', 'INT', 'CON', 'CHA', 'WIS', 'STR'] },
  Sorcerer: { saves: ['CON', 'CHA'], order: ['CHA', 'CON', 'DEX', 'WIS', 'INT', 'STR'], spellAbility: 'CHA' },
  Warlock: { saves: ['WIS', 'CHA'], order: ['CHA', 'CON', 'DEX', 'WIS', 'INT', 'STR'], spellAbility: 'CHA' },
  Wizard: { saves: ['INT', 'WIS'], order: ['INT', 'CON', 'DEX', 'WIS', 'CHA', 'STR'], spellAbility: 'INT' },
  Artificer: { saves: ['CON', 'INT'], order: ['INT', 'CON', 'DEX', 'WIS', 'CHA', 'STR'], spellAbility: 'INT' }
}

export const standardArray = [15, 14, 13, 12, 10, 8] as const

/** Standard array placed in the class's usual priority order. */
export function suggestedAbilities(className: ClassName): Record<Ability, number> {
  const scores = {} as Record<Ability, number>
  classInfo[className].order.forEach((ability, index) => { scores[ability] = standardArray[index] })
  return scores
}

type WeaponStyle = 'melee' | 'finesse' | 'ranged'
export const weapons: Record<string, { damage: string; kind: DamageKind; style: WeaponStyle }> = {
  Club: { damage: '1d4', kind: 'bludgeoning', style: 'melee' },
  Dagger: { damage: '1d4', kind: 'piercing', style: 'finesse' },
  Handaxe: { damage: '1d6', kind: 'slashing', style: 'melee' },
  Javelin: { damage: '1d6', kind: 'piercing', style: 'melee' },
  Mace: { damage: '1d6', kind: 'bludgeoning', style: 'melee' },
  Quarterstaff: { damage: '1d6', kind: 'bludgeoning', style: 'melee' },
  Spear: { damage: '1d6', kind: 'piercing', style: 'melee' },
  Scimitar: { damage: '1d6', kind: 'slashing', style: 'finesse' },
  Shortsword: { damage: '1d6', kind: 'piercing', style: 'finesse' },
  Rapier: { damage: '1d8', kind: 'piercing', style: 'finesse' },
  Battleaxe: { damage: '1d8', kind: 'slashing', style: 'melee' },
  Longsword: { damage: '1d8', kind: 'slashing', style: 'melee' },
  Warhammer: { damage: '1d8', kind: 'bludgeoning', style: 'melee' },
  Greataxe: { damage: '1d12', kind: 'slashing', style: 'melee' },
  Greatsword: { damage: '2d6', kind: 'slashing', style: 'melee' },
  Shortbow: { damage: '1d6', kind: 'piercing', style: 'ranged' },
  Longbow: { damage: '1d8', kind: 'piercing', style: 'ranged' },
  'Light Crossbow': { damage: '1d8', kind: 'piercing', style: 'ranged' },
  'Hand Crossbow': { damage: '1d6', kind: 'piercing', style: 'ranged' }
}

export type WizardChoices = {
  name: string
  portrait?: string
  species?: string
  className: ClassName
  level: number
  abilities: Record<Ability, number>
  armor: keyof typeof armorPresets
  shield: boolean
  weapons: string[]
}

const withModifier = (dice: string, modifier: number) => modifier === 0 ? dice : dice + (modifier > 0 ? '+' : '') + modifier

/** One attack line: STR for melee, DEX for ranged, the better of the two for finesse. */
export function weaponAttack(name: string, scores: Record<Ability, number>, proficiency: number) {
  const weapon = weapons[name]
  const str = abilityModifier(scores.STR)
  const dex = abilityModifier(scores.DEX)
  const modifier = weapon.style === 'ranged' ? dex : weapon.style === 'finesse' ? Math.max(str, dex) : str
  return { name, bonus: proficiency + modifier, damage: withModifier(weapon.damage, modifier), damageKind: weapon.kind }
}

/** Turn the wizard's answers into a complete sheet, with the D&D calculator switched on. */
export function buildCharacter(choices: WizardChoices): Sheet {
  const level = Math.max(1, Math.min(20, Math.round(choices.level)))
  const info = classInfo[choices.className]
  const proficiency = proficiencyForLevel(level)
  const attacks = choices.weapons.filter(name => weapons[name]).slice(0, 3).map(name => weaponAttack(name, choices.abilities, proficiency))
  const unarmed = { name: 'Unarmed Strike', bonus: proficiency + abilityModifier(choices.abilities.STR), damage: String(Math.max(1, 1 + abilityModifier(choices.abilities.STR))) }
  const main = attacks[0] ?? unarmed
  const preset = armorPresets[choices.armor]
  const savingThrows: Partial<Record<Ability, CheckBonus>> = {}
  for (const ability of abilities) if (info.saves.includes(ability)) savingThrows[ability] = { ability, training: 1, adjustment: 0 }
  const base = blankSheet('pc')
  const sheet: Sheet = {
    ...base,
    name: choices.name.trim(),
    portrait: choices.portrait,
    classLevel: choices.className + ' ' + level,
    abilities: { ...choices.abilities },
    speed: 30,
    attack: main.bonus,
    damage: main.damage,
    attacks: attacks.slice(1),
    saves: info.saves.join(', '),
    savingThrows,
    characterDetails: choices.species?.trim() ? { species: choices.species.trim() } : undefined,
    calculations: {
      hp: { classes: [{ die: hitDiceByClass[choices.className] as HitDie, levels: level }], bonus: 0 },
      armor: { base: preset.base, dex: preset.dex, shield: choices.shield, bonus: 0 },
      initiativeBonus: 0,
      spellAbility: info.spellAbility
    }
  }
  const computed = calculatedSheet(sheet)
  return { ...computed, hp: computed.maxHp }
}
