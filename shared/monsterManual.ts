import { abilities, blankSheet, damageKinds, sizes } from './model.ts'
import type { Ability, DamageKind, Sheet, Size } from './model.ts'

export type ManualMonster = {
  id: string
  name: string
  type: string
  alignment: string
  size: Size
  cr: string
  ac: number
  hp: number
  initiative: number
  speed: number
  abilities: Record<Ability, number>
  attacks: NonNullable<Sheet['attacks']>
  statBlock: string
  page?: number
}

export function crNumber(cr: string) {
  const [numerator, denominator = 1] = cr.split('/').map(Number)
  return numerator / denominator
}

export function monsterSheet(monster: ManualMonster): Sheet {
  const attack = monster.attacks[0]
  return {
    ...blankSheet('monster'), name: monster.name, size: monster.size, speed: monster.speed,
    ac: monster.ac, hp: monster.hp, maxHp: monster.hp, initiative: monster.initiative,
    abilities: { ...monster.abilities }, proficiency: Math.max(2, 2 + Math.floor((crNumber(monster.cr) - 1) / 4)),
    classLevel: [monster.type, 'CR ' + monster.cr, monster.alignment].filter(Boolean).join(' · '),
    skills: monster.statBlock.match(/^Skills[ \t]+(.+)$/im)?.[1].slice(0, 2000) ?? '',
    saves: monster.statBlock.match(/^Saving Throws[ \t]+(.+)$/im)?.[1].slice(0, 2000) ?? '',
    attacks: monster.attacks.map(entry => ({ ...entry })), attack: attack?.bonus ?? 0, damage: attack?.damage ?? '0',
    monsterReference: { statBlock: monster.statBlock, page: monster.page }
  }
}

function record(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ต้องเป็น JSON ของมอนสเตอร์หนึ่งตัว')
  return value as Record<string, unknown>
}

function numberField(value: unknown, field: string, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(field + ' ต้องอยู่ระหว่าง ' + min + '–' + max)
  return value
}

function stringField(value: unknown, field: string, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('ตรวจข้อมูล ' + field)
  return value.trim()
}

export function readMonster(input: unknown): ManualMonster {
  const data = record(input)
  const name = stringField(data.name, 'name', 120)
  const size = stringField(data.size, 'size', 20)
  if (!Object.hasOwn(sizes, size)) throw new Error('ตรวจขนาด Tiny, Small, Medium, Large, Huge หรือ Gargantuan')
  const cr = String(data.cr)
  if (!/^(0|1\/[248]|[1-9]|[12]\d|30)$/.test(cr)) throw new Error('ตรวจค่า CR ตั้งแต่ 0 ถึง 30')
  const scores = record(data.abilities)
  const stats = Object.fromEntries(abilities.map(key => [key, numberField(scores[key], key, 1, 30)])) as Record<Ability, number>
  const list = data.attacks ?? []
  if (!Array.isArray(list) || list.length > 20) throw new Error('ระบุ attacks ได้สูงสุด 20 รายการ')
  const attacks = list.map(item => {
    const attack = record(item)
    const damage = stringField(attack.damage, 'damage', 120).replace(/\s/g, '')
    const dice = /^(\d{0,3})d(100|20|12|10|8|6|4)([+-]\d{1,3})?$/i.exec(damage)
    if (!/^\d{1,4}$/.test(damage) && (!dice || Number(dice[1] || 1) < 1 || Number(dice[1] || 1) > 100)) throw new Error('ตรวจสูตร damage เช่น 1d6+2')
    const kind = attack.damageKind ?? 'untyped'
    if (typeof kind !== 'string' || !Object.hasOwn(damageKinds, kind)) throw new Error('ตรวจประเภท damageKind')
    return { name: stringField(attack.name, 'ชื่อการโจมตี', 120), bonus: numberField(attack.bonus, 'bonus', -999, 999),
      damage, damageKind: kind as DamageKind }
  })
  const statBlock = data.statBlock === undefined ? '' : stringField(data.statBlock, 'statBlock', 32000)
  return {
    id: String(data.id ?? name), name, size: size as Size, type: stringField(data.type, 'type', 120),
    alignment: data.alignment ? stringField(data.alignment, 'alignment', 120) : '', cr,
    ac: numberField(data.ac, 'AC', 0, 999), hp: numberField(data.hp, 'HP', 1, 9999),
    speed: numberField(data.speed, 'speed', 0, 999), abilities: stats, attacks,
    initiative: numberField(data.initiative ?? Math.floor((stats.DEX - 10) / 2), 'initiative', -999, 999), statBlock
  }
}

export function parseMonsterText(source: string): ManualMonster {
  if (!source.trim() || source.length > 32000) throw new Error('วางข้อมูลมอนสเตอร์หนึ่งตัว ความยาวไม่เกิน 32,000 ตัวอักษร')
  if (source.trimStart().startsWith('{')) {
    let value: unknown
    try { value = JSON.parse(source) } catch { throw new Error('อ่าน JSON ไม่สำเร็จ ตรวจวงเล็บและเครื่องหมายคำพูด') }
    const imported = readMonster(value)
    if (!imported.statBlock) imported.statBlock = JSON.stringify(value, null, 2).slice(0, 32000)
    return imported
  }
  const lines = source.replace(/[−–]/g, '-').replace(/[|*\u00a0]/g, ' ').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const metadata = /^(Tiny|Small|Medium|Large|Huge|Gargantuan)\s+(.+?),\s*(.+)$/i
  const index = lines.findIndex(line => metadata.test(line))
  if (index < 1) throw new Error('กรุณาวางตั้งแต่ชื่อมอนสเตอร์ รวมบรรทัดขนาด ประเภท และ Alignment')
  const [, rawSize, type, alignment] = lines[index].match(metadata)!
  const size = Object.keys(sizes).find(size => size.toLowerCase() === rawSize.toLowerCase())
  const block = lines.slice(index + 1).join('\n')
  function required(pattern: RegExp, field: string) {
    const result = block.match(pattern)
    if (!result) throw new Error('ไม่พบ ' + field + ' ใน Stat Block')
    return result[1]
  }
  const scoreRow = /\bSTR\s+DEX\s+CON\s+INT\s+WIS\s+CHA\s+([\d\s()+-]+)/i.exec(block)
  const legacyScores = scoreRow?.[1].match(/\d+(?=\s*\()/g)
  const stats = Object.fromEntries(abilities.map((key, idx) => {
    const score = legacyScores?.[idx] ?? required(new RegExp('\\b' + key + '\\s+(\\d+)\\b', 'i'), key)
    return [key, Number(score)]
  }))
  const actions = block.match(/(?:^|\n)Actions\s*\n([\s\S]*)/i)?.[1] ?? ''
  const attacks: NonNullable<Sheet['attacks']> = []
  const pattern = /(?:^|\n)([^\n.:]{1,100})[.:]\s*(?:Melee|Ranged)[^\n:]{0,60}Attack(?: Roll)?:\s*([+-]\s*\d+)[^\n]{0,300}?\bHit:\s*(\d+)\s*(?:\((\d+d(?:100|20|12|10|8|6|4)(?:\s*[+-]\s*\d+)?)\))?\s*(\w+)\s+damage/gim
  for (const match of actions.matchAll(pattern)) {
    const damageKind = match[5].toLowerCase()
    attacks.push({ name: match[1].trim(), bonus: Number(match[2].replace(/\s/g, '')),
      damage: (match[4] ?? match[3]).replace(/\s/g, ''), damageKind: Object.hasOwn(damageKinds, damageKind) ? damageKind as DamageKind : 'untyped' })
  }
  const speed = required(/^Speed\s+([^\n]+)/im, 'Speed')
  return readMonster({
    name: lines[index - 1].replace(/^#+\s*/, ''), size, type, alignment,
    cr: required(/^(?:CR|Challenge(?: Rating)?)\s+(\d+(?:\/\d+)?)/im, 'CR'),
    hp: Number(required(/^(?:HP|Hit Points)\s+(\d+)/im, 'HP')), ac: Number(required(/^(?:AC|Armor Class)\s+(\d+)/im, 'AC')),
    speed: Number(speed.match(/^(?:walk\s+)?(\d+)/i)?.[1] ?? 0), abilities: stats,
    initiative: block.match(/\bInitiative\s*([+-]?\d+)/i)?.[1] === undefined ? undefined : Number(block.match(/\bInitiative\s*([+-]?\d+)/i)![1]),
    attacks, statBlock: source.trim()
  })
}
