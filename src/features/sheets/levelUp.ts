import type { Sheet } from '../../../shared/model.ts'
import { abilityModifier, calculatedSheet, hitDiceByClass, proficiencyForLevel } from '../../../shared/characterStats.ts'
import type { HitDie } from '../../../shared/characterStats.ts'
import { formatSlots, parseSlots } from '../../../shared/conditions.ts'
import { classInfo, spellSlotsFor } from './wizard.ts'
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
export function levelUp(sheet: Sheet, className: ClassName, hp: HpChoice) {
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
  let slots = sheet.slots
  const oldSlots = parseSlots(sheet.slots)
  if (nextClasses.length === 1 && oldSlots) {
    const fresh = parseSlots(spellSlotsFor(className, classLevel)) ?? []
    slots = formatSlots(fresh.map(slot => {
      const before = oldSlots.find(entry => entry.level === slot.level)
      const spent = before ? before.max - before.left : 0
      return { ...slot, left: Math.max(0, slot.max - spent) }
    }))
  }
  const updated = calculatedSheet({
    ...sheet, slots, classLevel: nextClasses.map(entry => entry.name + ' ' + entry.level).join(' / '),
    calculations: { ...config, hp: { classes: hpClasses, bonus } }
  })
  const gained = updated.maxHp - sheet.maxHp
  return {
    sheet: { ...updated, hp: Math.min(updated.maxHp, sheet.hp + Math.max(0, gained)) },
    gained, total: total + 1, classLevel,
    checklist: checklist(className, classLevel, total + 1, !current && classes.length > 0)
  }
}
