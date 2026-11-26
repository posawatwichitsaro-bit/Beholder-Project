import { randomInt } from 'node:crypto'
import type { Sheet } from '../shared/model.ts'

export class Invalid extends Error {}
export const die = (sides: number) => randomInt(1, sides + 1)

export function parseDice(formula: string) {
  const normalized = formula.replace(/\s/g, '')
  if (/^\d{1,4}$/.test(normalized)) return { count: 0, sides: 0, modifier: Number(normalized) }
  const match = /^(\d{0,3})d(100|20|12|10|8|6|4)([+-]\d{1,3})?$/i.exec(normalized)
  if (!match) throw new Invalid('สูตรเต๋าไม่ถูกต้อง เช่น 2d6+3')
  const count = Number(match[1] || 1)
  if (count < 1 || count > 100) throw new Invalid('ทอยได้ 1 ถึง 100 ลูก')
  return { count, sides: Number(match[2]), modifier: Number(match[3] || 0) }
}

export function rollDice(formula: string, random = die, critical = false) {
  const { count, sides, modifier } = parseDice(formula)
  const faces = Array.from({ length: count * (critical ? 2 : 1) }, () => random(sides))
  return { formula, faces, modifier, total: faces.reduce((sum, face) => sum + face, modifier) }
}

/**
 * A free roll from the dice panel: several dice groups plus a number, e.g. "2d6+1d4+3" or "1d20-1".
 * Sheet formulas stay single-group (parseDice); this is only for table rolls. At most 100 dice.
 */
export function rollPool(formula: string, random = die) {
  const normalized = formula.replace(/\s/g, '').toLowerCase()
  if (!/^[+-]?(\d{0,3}d(100|20|12|10|8|6|4)|\d{1,4})([+-](\d{0,3}d(100|20|12|10|8|6|4)|\d{1,4}))*$/.test(normalized)) throw new Invalid('สูตรเต๋าไม่ถูกต้อง เช่น 2d6+1d4+3')
  const faces: number[] = []
  let modifier = 0
  let total = 0
  let dice = 0
  for (const [, sign, count, sides, flat] of normalized.matchAll(/([+-]?)(?:(\d{0,3})d(\d+)|(\d+))/g)) {
    const direction = sign === '-' ? -1 : 1
    if (flat !== undefined) { modifier += direction * Number(flat); total += direction * Number(flat); continue }
    const amount = Number(count || 1)
    dice += amount
    if (amount < 1 || dice > 100) throw new Invalid('ทอยได้ 1 ถึง 100 ลูก')
    for (let index = 0; index < amount; index++) {
      const face = random(Number(sides))
      faces.push(face)
      total += direction * face
    }
  }
  return { formula, faces, modifier, total }
}

export function d20(modifier: number, advantage: boolean, disadvantage: boolean, random = die) {
  const faces = [random(20)]
  if (advantage !== disadvantage) faces.push(random(20))
  const natural = advantage && !disadvantage ? Math.max(...faces) : Math.min(...faces)
  const formula = '1d20' + (modifier < 0 ? modifier : '+' + modifier)
  return { formula, faces, natural, modifier, total: natural + modifier }
}

export function harm(actor: Sheet, amount: number, critical = false) {
  if (actor.life === 'dead' || amount === 0) return
  const absorbed = Math.min(actor.tempHp, amount)
  actor.tempHp -= absorbed
  const damage = amount - absorbed
  if (damage === 0) return
  const before = actor.hp
  actor.hp = Math.max(0, before - damage)
  if (actor.hp > 0) return
  if (actor.kind === 'monster' || damage - before >= actor.maxHp) actor.life = 'dead'
  else {
    actor.life = 'dying'
    if (before === 0) actor.failures += critical ? 2 : 1
    if (actor.failures >= 3) actor.life = 'dead'
  }
}

export function heal(actor: Sheet, amount: number) {
  if (actor.life === 'dead') throw new Invalid('สิ่งมีชีวิตนี้เสียชีวิตแล้ว')
  actor.hp = Math.min(actor.maxHp, actor.hp + amount)
  if (actor.hp > 0) {
    actor.life = 'active'
    actor.successes = actor.failures = 0
  }
}

export function deathSave(actor: Sheet, face: number) {
  if (actor.life !== 'dying') throw new Invalid('ทอย Death Save ได้เมื่อกำลังจะตาย')
  if (face === 20) heal(actor, 1)
  else if (face >= 10) {
    if (++actor.successes >= 3) {
      actor.life = 'stable'
      actor.successes = actor.failures = 0
    }
  } else {
    actor.failures += face === 1 ? 2 : 1
    if (actor.failures >= 3) actor.life = 'dead'
  }
}
