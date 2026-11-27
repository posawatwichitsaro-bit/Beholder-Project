import type { Ability, ClassResource, Sheet } from './model.ts'
import { abilityModifier, hitDiceByClass } from './characterStats.ts'
import { formatSlots, parseSlots } from './conditions.ts'
import type { SlotLevel } from './conditions.ts'

/**
 * Character progression from SRD 5.2.1 (CC BY 4.0): spell slots for one or
 * several classes, Warlock Pact Magic kept on its own, XP, and the SRD's
 * subclasses and feats. Descriptions are short summaries in our own words with
 * a link to the SRD for the full text.
 */

type ClassName = keyof typeof hitDiceByClass
export const srdLink = 'https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf'

/** Spell slots by caster level (SRD spellcasting and Multiclass Spellcaster tables), index = level − 1. */
export const fullCasterSlots = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1]
]
const fullCasters: string[] = ['Bard', 'Cleric', 'Druid', 'Sorcerer', 'Wizard']
const halfCasters: string[] = ['Paladin', 'Ranger', 'Artificer']

const asText = (counts: number[]) => counts.map((count, index) => 'L' + (index + 1) + ' ' + count + '/' + count).join(', ')

/** Warlock Pact Magic: how many slots and of what level, by Warlock level. */
export function pactMagic(level: number) {
  if (level < 1) return ''
  const slots = level >= 17 ? 4 : level >= 11 ? 3 : level >= 2 ? 2 : 1
  return 'L' + Math.min(5, Math.ceil(level / 2)) + ' ' + slots + '/' + slots
}

/**
 * Slots for a class line. One spellcasting class uses its own table; two or
 * more add full-caster levels and half the Paladin/Ranger levels (rounded up)
 * on the Multiclass Spellcaster table. Warlock levels never join that sum:
 * they give Pact Magic, returned apart.
 */
export function slotsForClasses(classes: { name: ClassName | string; level: number }[]) {
  const casters = classes.filter(entry => fullCasters.includes(entry.name) || halfCasters.includes(entry.name))
  const warlock = classes.find(entry => entry.name === 'Warlock')
  let casterLevel = 0
  if (casters.length === 1) {
    const [only] = casters
    casterLevel = fullCasters.includes(only.name) ? only.level : Math.ceil(only.level / 2)
  } else casterLevel = casters.reduce((sum, entry) => sum + (fullCasters.includes(entry.name) ? entry.level : Math.ceil(entry.level / 2)), 0)
  const slots = casterLevel ? asText(fullCasterSlots[Math.min(20, casterLevel) - 1]) : ''
  return { slots, pact: warlock ? pactMagic(warlock.level) : '' }
}

/** New slot maxima, keeping what was already spent at each level. */
export function keepSpent(fresh: string, before: string) {
  const next = parseSlots(fresh) ?? []
  const old = parseSlots(before) ?? []
  return formatSlots(next.map((slot: SlotLevel) => {
    const was = old.find(entry => entry.level === slot.level)
    return { ...slot, left: Math.max(0, slot.max - (was ? was.max - was.left : 0)) }
  }))
}

/**
 * Where a sheet keeps its Pact Magic: `pactSlots` once it has one, else (older
 * single-class Warlock sheets) the ordinary `slots` line.
 */
export function pactField(sheet: Pick<Sheet, 'classLevel' | 'pactSlots'>): 'pactSlots' | 'slots' | undefined {
  if (sheet.pactSlots !== undefined) return 'pactSlots'
  const classes = [...sheet.classLevel.matchAll(/([A-Za-z]+)\s*\d/g)].map(match => match[1].toLowerCase())
  return classes.length === 1 && classes[0] === 'warlock' ? 'slots' : undefined
}

/**
 * Magical Cunning (Warlock 2+): once per Long Rest, regain expended Pact Magic
 * slots, up to half the maximum rounded up. Undefined when it can't be used.
 */
export function magicalCunning(sheet: Pick<Sheet, 'classLevel' | 'pactSlots' | 'slots' | 'cunningUsed'>) {
  const level = Number(/Warlock\s*(\d{1,2})/i.exec(sheet.classLevel)?.[1] ?? 0)
  const field = pactField(sheet)
  if (level < 2 || !field || sheet.cunningUsed) return undefined
  const slots = parseSlots(sheet[field] ?? '')
  if (!slots?.length) return undefined
  const spent = slots.reduce((sum, slot) => sum + slot.max - slot.left, 0)
  if (!spent) return undefined
  let back = Math.ceil(slots.reduce((sum, slot) => sum + slot.max, 0) / 2)
  const restored = slots.map(slot => {
    const regain = Math.min(back, slot.max - slot.left)
    back -= regain
    return { ...slot, left: slot.left + regain }
  })
  return { field, value: formatSlots(restored), regained: restored.reduce((sum, slot, index) => sum + slot.left - slots[index].left, 0) }
}

/** XP needed for each character level (index = level − 1). */
export const xpForLevel = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000]

const crXp: Record<string, number> = {
  '0': 10, '1/8': 25, '1/4': 50, '1/2': 100, '1': 200, '2': 450, '3': 700, '4': 1100, '5': 1800, '6': 2300, '7': 2900, '8': 3900,
  '9': 5000, '10': 5900, '11': 7200, '12': 8400, '13': 10000, '14': 11500, '15': 13000, '16': 15000, '17': 18000, '18': 20000,
  '19': 22000, '20': 25000, '21': 33000, '22': 41000, '23': 50000, '24': 62000, '25': 75000, '26': 90000, '27': 105000,
  '28': 120000, '29': 135000, '30': 155000
}

/** A monster's XP from the "CR 1/4" in its class line; 0 when it has no CR. */
export function monsterXp(sheet: Pick<Sheet, 'classLevel'>) {
  const cr = /\bCR\s*(\d{1,2}(?:\/\d)?)/i.exec(sheet.classLevel)?.[1]
  return cr ? crXp[cr] ?? 0 : 0
}

/** Total character level from the class line. */
export const characterLevel = (sheet: Pick<Sheet, 'classLevel'>) =>
  [...sheet.classLevel.matchAll(/[A-Za-z]+\s*(\d{1,2})/g)].reduce((sum, match) => sum + Number(match[1]), 0)

/** True when the XP reaches the next level (and the character is below 20). */
export function readyToLevel(sheet: Pick<Sheet, 'classLevel' | 'xp'>) {
  const level = characterLevel(sheet)
  return level > 0 && level < 20 && (sheet.xp ?? 0) >= xpForLevel[level]
}

/** The SRD 5.2.1 subclass of each class (all chosen at class level 3). */
export const srdSubclasses: Partial<Record<ClassName, { name: string; summary: string }>> = {
  Barbarian: { name: 'Path of the Berserker', summary: 'ความโกรธแบบบ้าคลั่ง โจมตีเพิ่มตอน Rage และทนต่อการถูกควบคุมจิตใจ' },
  Bard: { name: 'College of Lore', summary: 'นักปราชญ์ ได้ Proficiency เพิ่ม ใช้ Bardic Inspiration ตัดลดผลทอยศัตรู และเรียนเวทจากคลาสอื่น' },
  Cleric: { name: 'Life Domain', summary: 'สายรักษา เวทรักษาฟื้น HP มากขึ้น และ Channel Divinity ใช้รักษาเป็นกลุ่ม' },
  Druid: { name: 'Circle of the Land', summary: 'ผูกกับภูมิประเทศ ได้เวทประจำพื้นที่ และฟื้นช่องเวทระหว่างพักได้วันละครั้ง (Natural Recovery)' },
  Fighter: { name: 'Champion', summary: 'นักสู้ล้วน คริติคอลง่ายขึ้น (19–20 ตั้งแต่เลเวล 3, 18–20 ที่เลเวล 15) และร่างกายแข็งแรงขึ้น' },
  Monk: { name: 'Warrior of the Open Hand', summary: 'ศิลปะมือเปล่า Flurry of Blows ผลักหรือล้มเป้าหมายได้' },
  Paladin: { name: 'Oath of Devotion', summary: 'คำปฏิญาณแห่งความดีงาม อาวุธเรืองแสงศักดิ์สิทธิ์และออร่าป้องกันการถูกสะกด' },
  Ranger: { name: 'Hunter', summary: 'นักล่า เพิ่มความเสียหายต่อเป้าหมายที่บาดเจ็บ และเลือกเทคนิคต่อสู้กับฝูงหรือศัตรูตัวใหญ่' },
  Rogue: { name: 'Thief', summary: 'มือไว ใช้ Cunning Action กับไอเทมได้ ปีนป่ายเร็ว และใช้ไอเทมเวทได้คล่อง' },
  Sorcerer: { name: 'Draconic Sorcery', summary: 'สายเลือดมังกร AC และ HP สูงขึ้น เวทธาตุแรงขึ้น และงอกปีกได้ในเลเวลสูง' },
  Warlock: { name: 'Fiend Patron', summary: 'สัญญากับปีศาจ ได้ Temp HP เมื่อล้มศัตรู และใช้โชคของปีศาจบวกผลทอย (Dark One’s Own Luck)' },
  Wizard: { name: 'Evoker', summary: 'ผู้เชี่ยวชาญเวทระเบิด ปั้นพื้นที่เวทไม่ให้โดนพวกเดียวกัน และเวทโจมตีแรงขึ้น' }
}

export type FeatCategory = 'Origin' | 'General' | 'Fighting Style' | 'Epic Boon'
/** The feats in SRD 5.2.1, each with what Beholder works out for you (if anything). */
export const srdFeats: { name: string; category: FeatCategory; summary: string; automatic?: string }[] = [
  { name: 'Alert', category: 'Origin', summary: 'ตื่นตัวเสมอ บวก Proficiency Bonus ให้ Initiative และสลับลำดับกับพวกเดียวกันได้', automatic: 'Initiative + Proficiency' },
  { name: 'Magic Initiate', category: 'Origin', summary: 'เรียน Cantrip 2 บทและเวทเลเวล 1 อีก 1 บทจากรายชื่อเวทของคลาสที่เลือก' },
  { name: 'Savage Attacker', category: 'Origin', summary: 'ครั้งหนึ่งต่อเทิร์น ทอยความเสียหายของอาวุธสองครั้งแล้วเลือกค่าที่ดีกว่า' },
  { name: 'Skilled', category: 'Origin', summary: 'ได้ Proficiency ในสกิลหรือเครื่องมือรวม 3 อย่าง' },
  { name: 'Ability Score Improvement', category: 'General', summary: 'เพิ่มค่าความสามารถ +2 หนึ่งค่า หรือ +1 สองค่า (สูงสุด 20)', automatic: 'ปรับค่าความสามารถให้' },
  { name: 'Grappler', category: 'General', summary: 'ถนัดการจับล็อก ได้ Advantage โจมตีคนที่ตัวเองจับอยู่ และลากไปได้ไม่เสียความเร็ว' },
  { name: 'Archery', category: 'Fighting Style', summary: '+2 ให้การโจมตีด้วยอาวุธระยะไกล', automatic: '+2 โจมตีอาวุธที่ใช้กระสุน' },
  { name: 'Defense', category: 'Fighting Style', summary: '+1 AC ขณะสวมเกราะ', automatic: '+1 AC เมื่อสวมเกราะ' },
  { name: 'Great Weapon Fighting', category: 'Fighting Style', summary: 'ทอยความเสียหายอาวุธสองมือได้ 1 หรือ 2 ให้นับเป็น 3' },
  { name: 'Two-Weapon Fighting', category: 'Fighting Style', summary: 'การโจมตีมือรองได้บวกค่าความสามารถในความเสียหาย' },
  { name: 'Boon of Combat Prowess', category: 'Epic Boon', summary: 'ครั้งหนึ่งต่อเทิร์น เปลี่ยนการโจมตีที่พลาดให้โดน' },
  { name: 'Boon of Dimensional Travel', category: 'Epic Boon', summary: 'หลังโจมตีหรือร่ายเวท วาร์ปสั้น ๆ ไปที่ที่มองเห็นได้' },
  { name: 'Boon of Fate', category: 'Epic Boon', summary: 'บวกหรือลบ 2d4 ให้ผลทอย d20 ของคนใกล้ ๆ ได้เป็นครั้งคราว' },
  { name: 'Boon of Irresistible Offense', category: 'Epic Boon', summary: 'การโจมตีทะลุการต้านทานความเสียหายทางกายภาพ และ nat 20 ทำความเสียหายเพิ่ม' },
  { name: 'Boon of Spell Recall', category: 'Epic Boon', summary: 'ร่ายเวทเลเวล 1–4 ได้โดยไม่ใช้ช่องเวท วันละครั้ง' },
  { name: 'Boon of the Night Spirit', category: 'Epic Boon', summary: 'กลืนกับความมืด ซ่อนตัวในที่มืดได้และต้านทานความเสียหายเกือบทุกชนิด' },
  { name: 'Boon of Truesight', category: 'Epic Boon', summary: 'มองเห็นตามจริง (Truesight) ในระยะ 60 ฟุต' }
]

/** Feats that may be taken at this class level: Origin feats come from backgrounds, Epic Boons from level 19. */
export function featChoices(totalLevel: number) {
  return srdFeats.filter(feat => feat.category !== 'Origin' && (feat.category !== 'Epic Boon' || totalLevel >= 19))
}

/** Counted resources a subclass adds (on top of the class's own). */
export function subclassResources(subclass: string | undefined, classLevel: number, abilities: Record<Ability, number>): ClassResource[] {
  if (subclass === 'Circle of the Land' && classLevel >= 6) return [{ name: 'Natural Recovery', max: 1, used: 0, short: 'none' }]
  if (subclass === 'Fiend Patron' && classLevel >= 6) return [{ name: 'Dark One’s Own Luck', max: Math.max(1, abilityModifier(abilities.CHA)), used: 0, short: 'none' }]
  return []
}

/** Champion: the lowest natural roll that is a critical hit. */
export function criticalFrom(sheet: Pick<Sheet, 'classLevel' | 'subclass'>) {
  if (sheet.subclass !== 'Champion') return 20
  const level = Number(/Fighter\s*(\d{1,2})/i.exec(sheet.classLevel)?.[1] ?? 0)
  return level >= 15 ? 18 : level >= 3 ? 19 : 20
}
