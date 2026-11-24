import type { PDFDocumentProxy } from 'pdfjs-dist'
import { abilities, blankSheet, damageKinds, sizes } from './model.ts'
import type { Ability, DamageKind, Sheet, Size } from './model.ts'
import { abilityModifier, commonSkills, proficiencyForLevel } from './characterStats.ts'
import type { CheckBonus, Skill } from './characterStats.ts'

export const maxImportBytes = 20 * 1024 * 1024
const normalize = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '')
export type FieldPage = Record<string, string>
export type BeyondImport = { sheet: Sheet; warnings: string[] }

export async function extractBeyondFields(document: PDFDocumentProxy): Promise<FieldPage[]> {
  if (document.numPages > 60) throw new Error('รองรับ PDF ไม่เกิน 60 หน้า')
  const pages: FieldPage[] = []
  for (let index = 1; index <= document.numPages; index++) {
    const annotations = await (await document.getPage(index)).getAnnotations({ intent: 'display' })
    pages.push(Object.fromEntries(annotations.flatMap(annotation =>
      annotation.subtype === 'Widget' && typeof annotation.fieldName === 'string' && typeof annotation.fieldValue === 'string'
        ? [[annotation.fieldName, annotation.fieldValue]] : []
    )))
  }
  if (!pages.some(page => Object.keys(page).length)) {
    const fields = await document.getFieldObjects()
    if (fields) pages.push(Object.fromEntries(Object.entries(fields).flatMap(([name, entries]) => {
      const value = (entries as { value: unknown }[]).find(entry => typeof entry.value === 'string')?.value
      return typeof value === 'string' ? [[name, value]] : []
    })))
  }
  return pages
}

function integer(value: string | undefined) {
  const trimmed = value?.trim().replaceAll('−', '-').replaceAll(',', '')
  return trimmed && /^[+-]?\d+$/.test(trimmed) ? Number(trimmed) : undefined
}
const bounded = (value: number | undefined, min: number, max: number) =>
  value !== undefined && Number.isInteger(value) && value >= min && value <= max ? value : undefined
const activeMark = (value: string | undefined) => Boolean(value && !/^(off|no|--)$/i.test(value))
const longAbilities = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma']

export function parseBeyondFields(input: FieldPage[]): BeyondImport {
  const fields = new Map<string, string>()
  for (const page of input) for (const [raw, value] of Object.entries(page)) {
    const key = normalize(raw)
    if (!fields.has(key) && value.trim()) fields.set(key, value.trim())
  }
  const find = (...keys: string[]) => keys.map(key => fields.get(normalize(key))).find(Boolean)
  const name = find('CharacterName', 'CharacterName1', 'CharacterName2')
  const maxHp = bounded(integer(find('MaxHP', 'HPMax', 'HitPointMaximum')), 1, 9999)
  const ac = bounded(integer(find('AC', 'ArmorClass')), 0, 999)
  if (!name || maxHp === undefined || ac === undefined) throw new Error('หา Character Name, Max HP หรือ AC ไม่พบ กรุณาใช้ PDF ที่ Export จาก D&D Beyond โดยตรง')
  const warnings: string[] = []
  const sheet = { ...blankSheet(), name: name.slice(0, 120), maxHp, ac }
  for (const [index, ability] of abilities.entries()) {
    const score = bounded(integer(find(ability, longAbilities[index] + 'Score')), 1, 30)
    if (score === undefined) throw new Error('ไม่พบคะแนน ' + ability + ' ใน PDF')
    sheet.abilities[ability] = score
  }
  const hp = bounded(integer(find('CurrentHP', 'HPCurrent')), 0, maxHp)
  sheet.hp = hp ?? maxHp
  if (hp === undefined) warnings.push('ช่อง Current HP ว่างหรืออ่านค่าไม่ได้ จึงใช้ Max HP เป็น HP เริ่มต้น')
  sheet.tempHp = bounded(integer(find('TempHP', 'HPTemp')), 0, 999) ?? 0
  sheet.classLevel = (find('Class Level', 'Class and Level') ?? '').slice(0, 120)
  const levels = [...sheet.classLevel.matchAll(/\b([1-9]|1\d|20)\b/g)].reduce((sum, match) => sum + Number(match[1]), 0)
  sheet.proficiency = bounded(integer(find('ProfBonus', 'ProficiencyBonus')), 0, 999) ??
    (levels > 0 && levels <= 20 ? proficiencyForLevel(levels) : sheet.proficiency)
  sheet.initiative = bounded(integer(find('Init', 'Initiative')), -999, 999) ?? abilityModifier(sheet.abilities.DEX)
  const speed = find('Speed')?.match(/(\d+)\s*ft\.?\s*\(walking\)/i) ?? find('Speed')?.match(/^(\d+)/)
  sheet.speed = bounded(speed ? Number(speed[1]) : undefined, 0, 999) ?? sheet.speed
  const size = find('Size')
  if (size && Object.hasOwn(sizes, size)) sheet.size = size as Size
  sheet.characterDetails = { species: find('Race', 'Species')?.slice(0, 500), background: find('Background')?.slice(0, 500),
    hitDice: find('Total', 'HitDice')?.slice(0, 500), defenses: find('Defenses')?.slice(0, 500) }

  function check(ability: Ability, value: number, mark?: string): CheckBonus {
    const training = mark === 'E' ? 2 : mark === 'H' ? .5 : activeMark(mark) ? 1 : 0
    return { ability, training, adjustment: value - abilityModifier(sheet.abilities[ability]) - Math.floor(training * sheet.proficiency) }
  }
  const skillChecks: NonNullable<Sheet['skillChecks']> = {}
  const savingThrows: NonNullable<Sheet['savingThrows']> = {}
  const signed = (bonus: number) => (bonus < 0 ? '' : '+') + bonus
  const skills: string[] = []
  const saves: string[] = []
  for (const [name, standard] of Object.entries(commonSkills) as [Skill, Ability][]) {
    const key = name === 'Animal Handling' ? 'Animal' : name
    const value = bounded(integer(find(name, key)), -999, 999)
    if (value === undefined) continue
    const printedAbility = find(key + 'Mod')?.toUpperCase() as Ability
    skillChecks[name] = check(abilities.includes(printedAbility) ? printedAbility : standard, value, find(name + 'Prof', key + 'Prof'))
    skills.push(name + ' ' + signed(value))
  }
  for (const [index, ability] of abilities.entries()) {
    const value = bounded(integer(find('ST ' + longAbilities[index], ability + 'save')), -999, 999)
    if (value === undefined) continue
    savingThrows[ability] = check(ability, value, find(ability + 'Prof'))
    saves.push(ability + ' ' + signed(value))
  }
  sheet.skillChecks = skillChecks
  sheet.savingThrows = savingThrows
  sheet.skills = skills.join(' · ')
  sheet.saves = saves.join(' · ')
  sheet.itemProficiency = {
    thievesTools: /thieves[’']?\s+tools/i.test(find('ProficienciesLang') ?? ''),
    sleight: Boolean(skillChecks['Sleight of Hand']?.training), investigation: Boolean(skillChecks.Investigation?.training),
    perception: Boolean(skillChecks.Perception?.training)
  }

  sheet.attacks = []
  for (let index = 1; index <= 20; index++) {
    const title = find('Wpn Name ' + index, index === 1 ? 'Wpn Name' : 'AttackName' + index)
    if (!title) continue
    const bonus = bounded(integer(find('Wpn' + index + ' AtkBonus')), -999, 999)
    const originalDamage = find('Wpn' + index + ' Damage')
    const damage = /^(\d{0,3}d(?:100|20|12|10|8|6|4)(?:\s*[+-]\s*\d{1,3})?|\d{1,4})(?=\s|$)/i.exec(originalDamage ?? '')?.[1].replace(/\s/g, '').toLowerCase()
    if (bonus === undefined || !damage || (/d/.test(damage) && Number(damage.split('d')[0] || 1) < 1) ||
      (/d/.test(damage) && Number(damage.split('d')[0]) > 100)) {
      warnings.push('ตรวจรายการ ' + title + ' เอง เนื่องจากโบนัสหรือสูตรความเสียหายอ่านอัตโนมัติไม่ได้')
      continue
    }
    const kind = originalDamage?.slice(originalDamage.indexOf(' ') + 1).toLowerCase().match(/[a-z]+$/)?.[0]
    const tail = originalDamage?.replace(/^\S+\s*/, '').trim()
    const listed = find('Wpn Notes ' + index)
    const notes = [tail, listed].filter(Boolean).join(' · ')
    sheet.attacks.push({ name: title.slice(0, 120), bonus, damage,
      damageKind: kind && Object.hasOwn(damageKinds, kind) ? kind as DamageKind : undefined, notes: notes.slice(0, 500) })
  }
  if (sheet.attacks.length) { sheet.attack = sheet.attacks[0].bonus; sheet.damage = sheet.attacks[0].damage }
  const spells = new Set<string>()
  const slots = new Map<number, number>()
  for (const [key, value] of fields) {
    if (/^spellname\d+$/.test(key)) spells.add(value)
    const header = /^spellheader(\d+)$/.exec(key)
    const level = value.match(/\b([1-9])(?:st|nd|rd|th)\s+level/i)
    if (header && level) {
      const count = fields.get('spellslotheader' + header[1])?.match(/(\d+)\s+slots?/i)
      if (count) slots.set(Number(level[1]), Number(count[1]))
    }
  }
  const spellNames = [...spells].join(', ')
  sheet.spells = spellNames.length > 2000 ? spellNames.slice(0, 2000).replace(/, [^,]*$/, '') : spellNames
  if (spellNames.length > 2000) warnings.push('รายการเวทบางส่วนยาวเกินช่องบันทึก')
  sheet.slots = [...slots].sort(([a], [b]) => a - b).map(([level, count]) => 'Lv' + level + ': ' + count).join(' · ')
  sheet.spellDC = bounded(integer(find('spellSaveDC0', 'SpellSaveDC')), 0, 999) ?? sheet.spellDC
  sheet.spellAttack = bounded(integer(find('spellAtkBonus0', 'SpellAttackBonus')), -999, 999) ?? sheet.spellAttack
  if (find('spellCastingClass1')) warnings.push('ชีตรองรับ Spell Attack และ Spell Save DC ชุดหลัก โปรดตรวจค่าของคลาสเวทอื่น')
  sheet.inventory = []
  for (const [key, title] of fields) {
    const row = /^eqname(\d+)$/.exec(key)
    if (!row) continue
    const quantity = bounded(integer(find('Eq Qty' + row[1])), 0, 999) ?? 1
    if (quantity) sheet.inventory.push({ id: 'pdf-' + row[1], name: title.slice(0, 120), quantity, description: '',
      tool: /thieves[’']?\s+tools/i.test(title) ? 'thievesTools' : undefined })
  }
  if (sheet.inventory.length > 100) { sheet.inventory = sheet.inventory.slice(0, 100); warnings.push('นำเข้า Inventory ได้สูงสุด 100 รายการ') }
  return { sheet, warnings }
}
