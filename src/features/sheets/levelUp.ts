import type { Sheet } from '../../../shared/model.ts'
import { abilityModifier, calculatedSheet, hitDiceByClass, proficiencyForLevel } from '../../../shared/characterStats.ts'
import type { HitDie } from '../../../shared/characterStats.ts'
import { parseSlots } from '../../../shared/conditions.ts'
import { keepSpent, pactField, slotsForClasses } from '../../../shared/progression.ts'
import { classResources } from '../../../shared/rest.ts'
import type { Ability } from '../../../shared/model.ts'
import { classInfo } from './wizard.ts'
import type { ClassName } from './wizard.ts'

const classNames = Object.keys(hitDiceByClass) as ClassName[]

/** "Fighter 3 / Wizard 1" → [{ name: 'Fighter', level: 3 }, { name: 'Wizard', level: 1 }]. */
export function classesOf(classLevel: string) {
  const found: { name: ClassName; level: number }[] = []
  for (const [, word, level] of classLevel.matchAll(/([A-Za-z]+)\s*(\d{1,2})/g)) {
    const name = classNames.find(entry => entry.toLowerCase() === word.toLowerCase())
    if (name && !found.some(entry => entry.name === name)) found.push({ name, level: Number(level) })
  }
  return found
}

export type HpChoice = { mode: 'fixed' } | { mode: 'rolled'; roll: number }
/** Hit Points for a level after the first: the class's fixed value or a roll, plus CON, at least 1. */
export function levelHp(className: ClassName, con: number, hp: HpChoice) {
  const die = hitDiceByClass[className]
  return Math.max(1, (hp.mode === 'rolled' ? Math.max(1, Math.min(die, hp.roll)) : die / 2 + 1) + abilityModifier(con))
}

/** What to look at after levelling, in our own words; the class tables carry the details. */
function checklist(className: ClassName, classLevel: number, total: number, multiclassStart: boolean) {
  const notes: string[] = []
  const asi = [4, 8, 12, 16].includes(classLevel) || (className === 'Fighter' && [6, 14].includes(classLevel)) || (className === 'Rogue' && classLevel === 10)
  if (asi) notes.push('เลือก Ability Score Improvement หรือ Feat แล้วแก้ค่าพลังในชีต')
  if (classLevel === 19) notes.push('เลือก Epic Boon หรือ Feat')
  if (classLevel === 3) notes.push('เลือก Subclass ของ ' + className)
  if (multiclassStart) notes.push('Multiclass: ตรวจ proficiency ที่ได้จากคลาสใหม่ และช่องเวทแบบ multiclass')
  if (proficiencyForLevel(total) !== proficiencyForLevel(total - 1)) notes.push('Proficiency Bonus เพิ่มเป็น +' + proficiencyForLevel(total) + ' (คำนวณให้แล้ว)')
  if (classInfo[className].spellAbility) notes.push('ตรวจ Cantrips และจำนวนเวทที่เตรียมได้ของ ' + className + ' ' + classLevel)
  notes.push('ดูความสามารถใหม่ของ ' + className + ' เลเวล ' + classLevel + ' และอัปเดตทรัพยากรของคลาส (ถ้ามี)')
  return notes
}

/**
 * One level in `className`: class line, Hit Dice and HP (fixed or rolled, plus
 * Dwarven Toughness), spell slots for single-class casters keeping what was
 * spent, and a checklist of choices left to the player.
 */
export type LevelChoices = {
  /** The SRD subclass, picked at class level 3. */
  subclass?: string
  /** A feat at an ASI level; Ability Score Improvement uses `increase`. */
  feat?: string
  /** Ability Score Improvement: +2 to one, or +1 to two (each capped at 20). */
  increase?: Partial<Record<Ability, number>>
}

/** Whether this class level offers an Ability Score Improvement or feat. */
export const asiLevel = (className: ClassName, classLevel: number) =>
  [4, 8, 12, 16, 19].includes(classLevel) || (className === 'Fighter' && [6, 14].includes(classLevel)) || (className === 'Rogue' && classLevel === 10)

export function levelUp(sheet: Sheet, className: ClassName, hp: HpChoice, choices: LevelChoices = {}) {
  const config = sheet.calculations
  if (!config?.hp) throw new Error('เปิดตัวคำนวณ HP ในหน้าแก้ชีตก่อน แล้วจึงเลเวลอัปจากที่นี่')
  const classes = classesOf(sheet.classLevel)
  const total = config.hp.classes.reduce((sum, entry) => sum + entry.levels, 0)
  if (total >= 20) throw new Error('ถึงเลเวล 20 แล้ว')
  const current = classes.find(entry => entry.name === className)
  const classLevel = (current?.level ?? 0) + 1
  const nextClasses = current ? classes.map(entry => entry.name === className ? { ...entry, level: classLevel } : entry) : [...classes, { name: className, level: 1 }]
  const die = hitDiceByClass[className] as HitDie
  const hpClasses = config.hp.classes.some(entry => entry.die === die)
    ? config.hp.classes.map(entry => entry.die === die ? { ...entry, levels: entry.levels + 1 } : entry)
    : [...config.hp.classes, { die, levels: 1 }]
  // The calculator assumes the fixed value; a roll shifts the bonus by the difference. Dwarves get +1 per level.
  const dwarf = /^dwarf\b/i.test(sheet.characterDetails?.species ?? '')
  const rollShift = hp.mode === 'rolled' ? Math.max(1, Math.min(die, hp.roll)) - (die / 2 + 1) : 0
  const bonus = config.hp.bonus + rollShift + (dwarf ? 1 : 0)
  // Slots: one class keeps its own table; several use the Multiclass Spellcaster table, with Pact Magic apart.
  const fresh = slotsForClasses(nextClasses)
  const legacyPact = pactField(sheet) === 'slots'
  let slots = sheet.slots
  let pactSlots = sheet.pactSlots
  if (nextClasses.length === 1 && className === 'Warlock' && legacyPact) slots = keepSpent(fresh.pact, sheet.slots)
  else {
    if (fresh.slots || parseSlots(sheet.slots)) slots = keepSpent(fresh.slots, legacyPact ? '' : sheet.slots)
    if (fresh.pact) pactSlots = keepSpent(fresh.pact, legacyPact ? sheet.slots : sheet.pactSlots ?? '')
  }
  const abilities = { ...sheet.abilities }
  if (choices.feat === 'Ability Score Improvement') for (const [key, value] of Object.entries(choices.increase ?? {}) as [Ability, number][]) {
    abilities[key] = Math.min(20, abilities[key] + Math.max(0, Math.min(2, value)))
  }
  const feats = choices.feat ? [...(sheet.feats ?? []).filter(feat => feat !== choices.feat || feat === 'Ability Score Improvement'), choices.feat].slice(-20) : sheet.feats
  const classLine = nextClasses.map(entry => entry.name + ' ' + entry.level).join(' / ')
  const subclass = choices.subclass ?? sheet.subclass
  // Class and subclass resources at the new levels, keeping what was already used.
  const resources = classResources({ classLevel: classLine, abilities, subclass }).map(resource => {
    const before = sheet.resources?.find(entry => entry.name === resource.name)
    return before ? { ...resource, used: Math.min(resource.max, before.used) } : resource
  })
  const extraResources = (sheet.resources ?? []).filter(entry => !resources.some(resource => resource.name === entry.name))
  const updated = calculatedSheet({
    ...sheet, slots, ...(pactSlots !== undefined ? { pactSlots } : {}), abilities, classLevel: classLine,
    ...(subclass ? { subclass } : {}), ...(feats ? { feats } : {}), resources: [...resources, ...extraResources].slice(0, 12),
    calculations: { ...config, hp: { classes: hpClasses, bonus } }
  })
  const gained = updated.maxHp - sheet.maxHp
  return {
    sheet: { ...updated, hp: Math.min(updated.maxHp, sheet.hp + Math.max(0, gained)) },
    gained, total: total + 1, classLevel,
    checklist: checklist(className, classLevel, total + 1, !current && classes.length > 0)
  }
}
