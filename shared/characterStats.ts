import type { Ability, Sheet } from './model.ts'

export const hitDiceByClass = {
  Barbarian: 12, Bard: 8, Cleric: 8, Druid: 8, Fighter: 10, Monk: 8, Paladin: 10,
  Ranger: 10, Rogue: 8, Sorcerer: 6, Warlock: 8, Wizard: 6, Artificer: 8
} as const
export const armorPresets = {
  Unarmored: { base: 10, dex: 'full' }, Padded: { base: 11, dex: 'full' },
  Leather: { base: 11, dex: 'full' }, 'Studded Leather': { base: 12, dex: 'full' },
  Hide: { base: 12, dex: 'medium' }, 'Chain Shirt': { base: 13, dex: 'medium' },
  'Scale Mail': { base: 14, dex: 'medium' }, Breastplate: { base: 14, dex: 'medium' },
  'Half Plate': { base: 15, dex: 'medium' }, 'Ring Mail': { base: 14, dex: 'none' },
  'Chain Mail': { base: 16, dex: 'none' }, Splint: { base: 17, dex: 'none' }, Plate: { base: 18, dex: 'none' },
  'Mage Armor': { base: 13, dex: 'full' }
} as const
export type HitDie = 6 | 8 | 10 | 12
export type ArmorSettings = {
  base: number; dex: 'full' | 'medium' | 'none'; shield: boolean; bonus: number; extra?: Ability
  /** Magic bonus of the worn armor and of the shield (+1 to +3), kept apart so re-equipping never stacks. */
  armorMagic?: number; shieldMagic?: number
}
export type CharacterCalculations = {
  level?: number
  hp?: { classes: { die: HitDie; levels: number }[]; bonus: number }
  armor?: ArmorSettings
  initiativeBonus?: number
  spellAbility?: Ability
}
export type CheckBonus = { ability: Ability; training: number; adjustment: number }
export const commonSkills = {
  Acrobatics: 'DEX', 'Animal Handling': 'WIS', Arcana: 'INT', Athletics: 'STR', Deception: 'CHA',
  History: 'INT', Insight: 'WIS', Intimidation: 'CHA', Investigation: 'INT', Medicine: 'WIS',
  Nature: 'INT', Perception: 'WIS', Performance: 'CHA', Persuasion: 'CHA', Religion: 'INT',
  'Sleight of Hand': 'DEX', Stealth: 'DEX', Survival: 'WIS'
} as const satisfies Record<string, Ability>
export type Skill = keyof typeof commonSkills
export const abilityModifier = (score: number) => Math.floor((score - 10) / 2)
export const proficiencyForLevel = (level: number) => 2 + Math.floor((level - 1) / 4)
export const bonusForCheck = (sheet: Sheet, check: CheckBonus) =>
  abilityModifier(sheet.abilities[check.ability]) + Math.floor(sheet.proficiency * check.training) + check.adjustment

export function fixedMaxHp(settings: NonNullable<CharacterCalculations['hp']>, con: number) {
  return Math.max(1, settings.classes.reduce((total, entry, index) => {
    const fixed = Math.max(1, entry.die / 2 + 1 + con)
    return total + (index === 0 ? Math.max(1, entry.die + con) + (entry.levels - 1) * fixed : entry.levels * fixed)
  }, settings.bonus))
}

export function calculatedSheet(sheet: Sheet): Sheet {
  const config = sheet.calculations
  if (sheet.kind !== 'pc' || !config) return sheet
  const dex = abilityModifier(sheet.abilities.DEX)
  const level = config.hp?.classes.reduce((total, entry) => total + entry.levels, 0) ?? config.level
  const proficiency = level ? proficiencyForLevel(level) : sheet.proficiency
  const maxHp = config.hp ? fixedMaxHp(config.hp, abilityModifier(sheet.abilities.CON)) : sheet.maxHp
  const armor = config.armor
  const ac = armor ? Math.max(0, armor.base + (armor.dex === 'full' ? dex : armor.dex === 'medium' ? Math.min(2, dex) : 0)
    + (armor.shield ? 2 + (armor.shieldMagic ?? 0) : 0) + (armor.armorMagic ?? 0) + armor.bonus + (armor.extra ? abilityModifier(sheet.abilities[armor.extra]) : 0)) : sheet.ac
  const spellAttack = config.spellAbility ? proficiency + abilityModifier(sheet.abilities[config.spellAbility]) : sheet.spellAttack
  // Feats with plain numbers: Alert adds Proficiency to Initiative, Defense +1 AC while wearing armor.
  const feats = sheet.feats ?? []
  const wearing = armor && (armor.dex !== 'full' || armor.base > 10)
  return { ...sheet, maxHp, hp: Math.min(sheet.hp, maxHp), ac: ac + (armor && wearing && feats.includes('Defense') ? 1 : 0), proficiency,
    initiative: config.initiativeBonus === undefined ? sheet.initiative : dex + config.initiativeBonus + (feats.includes('Alert') ? proficiency : 0),
    spellAttack, spellDC: config.spellAbility ? 8 + spellAttack : sheet.spellDC }
}
