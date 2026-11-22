import { randomUUID } from 'node:crypto'
import { abilities, blankSheet, sizes } from '../shared/model.ts'
import type { Actor, Member, Roll, Room, Sheet, Snapshot } from '../shared/model.ts'
import { d20, deathSave, die, harm, heal, Invalid, parseDice, rollDice } from './rules.ts'

export class Forbidden extends Error {}
export class Conflict extends Error {}
export type Command = Record<string, unknown>
const id = randomUUID

export function text(value: unknown, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Invalid('กรุณากรอกข้อความให้ถูกต้อง')
  return value.trim()
}
function number(value: unknown, min: number, max: number, step = 1) {
  if (typeof value !== 'number' || !Number.isInteger(value / step) || value < min || value > max) {
    throw new Invalid('ตัวเลขอยู่นอกช่วงที่รองรับ')
  }
  return value
}
function record(value: unknown): Command {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Invalid('ข้อมูลไม่ถูกต้อง')
  return value as Command
}
function get<T extends { id: string }>(items: T[], key: unknown): T {
  const item = items.find(item => item.id === key)
  if (!item) throw new Invalid('ไม่พบรายการ')
  return item
}
function requireDM(member: Member) {
  if (member.role !== 'dm') throw new Forbidden('สงวนให้ DM')
}
function owns(member: Member, actor: Actor) {
  if (member.role !== 'dm' && actor.ownerId !== member.id) throw new Forbidden('คุณไม่ได้ควบคุมตัวนี้')
}

function parseSheet(value: unknown, kind: Sheet['kind']): Sheet {
  const input = record(value)
  const sheet = blankSheet(kind)
  sheet.name = text(input.name)
  if (typeof input.size !== 'string' || !Object.hasOwn(sizes, input.size)) throw new Invalid('ขนาดไม่ถูกต้อง')
  sheet.size = input.size as Sheet['size']
  for (const field of ['classLevel', 'skills', 'saves', 'spells', 'slots', 'conditions'] as const) {
    sheet[field] = input[field] === '' ? '' : text(input[field], 2000)
  }
  for (const field of ['speed', 'ac', 'proficiency', 'spellDC', 'tempHp'] as const) sheet[field] = number(input[field], 0, 999)
  for (const field of ['attack', 'spellAttack', 'initiative'] as const) sheet[field] = number(input[field], -999, 999)
  sheet.maxHp = number(input.maxHp, 1, 9999)
  sheet.hp = number(input.hp, 0, sheet.maxHp)
  sheet.damage = text(input.damage)
  parseDice(sheet.damage)
  if (input.attacks !== undefined) {
    if (!Array.isArray(input.attacks) || input.attacks.length > 20) throw new Invalid('บันทึกอาวุธเพิ่มได้สูงสุด 20 รายการ')
    sheet.attacks = input.attacks.map(value => {
      const attack = record(value)
      const damage = text(attack.damage)
      parseDice(damage)
      return { name: text(attack.name), bonus: number(attack.bonus, -999, 999), damage }
    })
  } else sheet.attacks = []
  const scores = record(input.abilities)
  for (const ability of abilities) sheet.abilities[ability] = number(scores[ability], 1, 30)
  if (sheet.hp === 0) sheet.life = kind === 'pc' ? 'dying' : 'dead'
  return sheet
}

export function visibleRolls(room: Room, me: Member) {
  const visible = new Set(room.scenes.filter(scene => scene.id === room.activeSceneId).flatMap(scene => scene.tokens.map(token => token.actorId)))
  return room.rolls.filter(roll => me.role === 'dm' || !roll.targetId || visible.has(roll.targetId))
}

export function snapshot(room: Room, me: Member): Snapshot {
  const dm = me.role === 'dm'
  const scenes = dm ? room.scenes : room.scenes.filter(scene => scene.id === room.activeSceneId)
  const visible = new Set(scenes.flatMap(scene => scene.tokens.map(token => token.actorId)))
  return {
    id: room.id, name: room.name, revision: room.revision, me, members: room.members,
    activeSceneId: room.activeSceneId, scenes, invite: dm ? room.invite : undefined,
    actors: room.actors.filter(actor => dm || actor.ownerId === me.id),
    publicActors: room.actors.filter(actor => dm || visible.has(actor.id)).map(({ id, name, kind, size }) => ({ id, name, kind, size })),
    templates: dm ? room.templates : [],
    rolls: visibleRolls(room, me).slice(-40)
  }
}

export function applyCommand(room: Room, member: Member, command: Command) {
  const scene = () => get(room.scenes, command.sceneId)
  const active = () => {
    if (command.sceneId !== room.activeSceneId) throw new Conflict('ฉากเปลี่ยนแล้ว')
    return scene()
  }
  const actor = () => get(room.actors, command.actorId)
  const saveRoll = (label: string, result: Pick<Roll, 'formula' | 'faces' | 'modifier' | 'total'>, extra: Partial<Roll> = {}) => {
    const roll = { id: id(), name: member.name, label, ...result, ...extra }
    room.rolls.push(roll)
    return { rollId: roll.id }
  }
  switch (command.type) {
    case 'scene': {
      requireDM(member)
      const fields = {
        name: text(command.name), cell: number(command.cell, 12, 300),
        originX: number(command.originX, -4000, 4000), originY: number(command.originY, -4000, 4000)
      }
      if (command.sceneId) Object.assign(scene(), fields)
      else {
        const sceneId = id()
        room.scenes.push({ id: sceneId, ...fields, tokens: [] })
        room.activeSceneId ??= sceneId
      }
      return {}
    }
    case 'activate':
      requireDM(member)
      room.activeSceneId = scene().id
      return {}
    case 'reuseMap': {
      requireDM(member)
      const source = get(room.scenes, command.sourceId)
      if (!source.map) throw new Invalid('ฉากต้นทางไม่มีแผนที่')
      scene().map = { ...source.map }
      return {}
    }
    case 'sheet': {
      const existing = command.actorId ? actor() : undefined
      if (existing) owns(member, existing)
      const kind = existing?.kind ?? (command.kind === 'monster' ? 'monster' : 'pc')
      if (kind === 'monster') requireDM(member)
      const sheet = parseSheet(command.sheet, kind)
      if (existing) {
        if (member.role !== 'dm' && room.scenes.some(scene => scene.combat?.order.some(entry => entry.actorId === existing.id))
          && (existing.hp !== sheet.hp || existing.tempHp !== sheet.tempHp)) throw new Forbidden('ให้ DM แก้ HP ระหว่างต่อสู้')
        if (existing.hp === 0 && sheet.hp === 0) Object.assign(sheet, {
          life: existing.life, successes: existing.successes, failures: existing.failures
        })
        Object.assign(existing, sheet)
      } else room.actors.push({ id: id(), ownerId: member.id, ...sheet })
      return {}
    }
    case 'template': {
      requireDM(member)
      const sheet = parseSheet(command.sheet, 'monster')
      if (command.templateId) get(room.templates, command.templateId).sheet = sheet
      else room.templates.push({ id: id(), sheet })
      return {}
    }
    case 'place': {
      requireDM(member)
      const target = scene()
      const template = command.templateId ? get(room.templates, command.templateId) : undefined
      const creature = template ? { ...structuredClone(template.sheet), id: id(), ownerId: member.id, templateId: template.id } : actor()
      if (target.tokens.some(token => token.actorId === creature.id)) throw new Invalid('มี Token ของตัวนี้ในฉากแล้ว')
      if (template) {
        const ordinal = room.actors.filter(item => item.templateId === template.id).length + 1
        creature.name = template.sheet.name + ' ' + ordinal
        room.actors.push(creature)
      }
      target.tokens.push({
        id: id(), actorId: creature.id,
        x: number(command.x, -1000, 1000, .5), y: number(command.y, -1000, 1000, .5)
      })
      return {}
    }
    case 'move': {
      const target = member.role === 'dm' ? scene() : active()
      const token = get(target.tokens, command.tokenId)
      owns(member, get(room.actors, token.actorId))
      token.x = number(command.x, -1000, 1000, .5)
      token.y = number(command.y, -1000, 1000, .5)
      return {}
    }
    case 'roll':
      return saveRoll(command.label ? text(command.label) : 'ทอยเต๋า', rollDice(text(command.formula)))
    case 'sheetRoll': {
      const creature = actor()
      owns(member, creature)
      const advantage = command.advantage === true
      const disadvantage = command.disadvantage === true
      const rollType = command.rollType
      const weapon = command.weaponIndex === undefined ? undefined : creature.attacks?.[number(command.weaponIndex, 0, 19)]
      if (command.weaponIndex !== undefined && !weapon) throw new Invalid('รายการโจมตีเปลี่ยนแล้ว')
      if (rollType === 'damage') return saveRoll('Damage · ' + (weapon?.name ?? creature.name), rollDice(weapon?.damage ?? creature.damage))
      if (rollType === 'death') {
        const target = active()
        const encounter = target.combat
        if (!encounter || encounter.order[encounter.turn]?.actorId !== creature.id) throw new Invalid('ยังไม่ถึงเทิร์นของตัวละคร')
        const key = encounter.round + ':' + creature.id
        if (encounter.deathSaveAt === key) throw new Conflict('ทอย Death Save สำหรับเทิร์นนี้แล้ว')
        const face = die(20)
        deathSave(creature, face)
        encounter.deathSaveAt = key
        return saveRoll('Death save · ' + creature.name, { formula: '1d20', faces: [face], total: face, modifier: 0 }, { outcome: face === 20 ? 'Natural 20' : face >= 10 ? 'สำเร็จ' : 'ล้มเหลว' })
      }
      if (rollType === 'attack' || rollType === 'spellAttack') {
        const target = active()
        if (![command.actorId, command.targetId].every(key => target.tokens.some(token => token.actorId === key))) {
          throw new Invalid('ผู้โจมตีและเป้าหมายต้องอยู่ในฉากเดียวกัน')
        }
        const victim = get(room.actors, command.targetId)
        const cover = number(command.cover ?? 0, 0, 5)
        if (![0, 2, 5].includes(cover)) throw new Invalid('ค่าที่กำบังไม่ถูกต้อง')
        const hitRoll = d20(rollType === 'attack' ? weapon?.bonus ?? creature.attack : creature.spellAttack, advantage, disadvantage)
        const critical = hitRoll.natural === 20
        const hit = critical || (hitRoll.natural !== 1 && hitRoll.total >= victim.ac + cover)
        saveRoll((weapon?.name ?? rollType) + ' · ' + creature.name, hitRoll, { outcome: critical ? 'คริติคัล' : hit ? 'โดน' : 'พลาด', targetId: victim.id })
        if (hit) return saveRoll('Damage · ' + victim.name, rollDice(rollType === 'attack' ? weapon?.damage ?? creature.damage : text(command.formula), die, critical), { targetId: victim.id, applied: false, critical })
        return {}
      }
      if (rollType === 'initiative') return saveRoll('Initiative · ' + creature.name, d20(creature.initiative, advantage, disadvantage))
      if (rollType !== 'check' && rollType !== 'save') throw new Invalid('ประเภทการทอยไม่ถูกต้อง')
      if (!abilities.includes(command.ability as typeof abilities[number])) throw new Invalid('เลือกค่าความสามารถ')
      const ability = command.ability as typeof abilities[number]
      const modifier = Math.floor((creature.abilities[ability] - 10) / 2) + (command.proficient === true ? creature.proficiency : 0)
      return saveRoll(ability + ' ' + rollType + ' · ' + creature.name, d20(modifier, advantage, disadvantage))
    }
    case 'castSave': {
      const target = active()
      const caster = actor()
      owns(member, caster)
      const victim = get(room.actors, command.targetId)
      if (![caster.id, victim.id].every(key => target.tokens.some(token => token.actorId === key))) throw new Invalid('ผู้ร่ายและเป้าหมายต้องอยู่ในฉาก')
      const ability = command.ability as typeof abilities[number]
      if (!abilities.includes(ability)) throw new Invalid('เลือกค่าความสามารถสำหรับ Save')
      const damage = command.formula ? text(command.formula) : undefined
      if (damage) parseDice(damage)
      return saveRoll('Spell · ' + text(command.label), { total: caster.spellDC, faces: [], formula: ability + ' Save DC', modifier: 0 }, {
        targetId: victim.id, cast: { ability, dc: caster.spellDC, targetId: victim.id, damage, half: command.half === true }
      })
    }
    case 'spellSave': {
      const target = active()
      const roll = get(room.rolls, command.rollId)
      if (!roll.cast || roll.cast.resolved) throw new Conflict('คำขอ Save นี้ถูกใช้แล้ว')
      const victim = get(room.actors, roll.cast.targetId)
      owns(member, victim)
      if (!target.tokens.some(token => token.actorId === victim.id)) throw new Invalid('เป้าหมายต้องอยู่ในฉาก')
      const proficient = command.proficient === true ? victim.proficiency : 0
      const bonus = Math.floor((victim.abilities[roll.cast.ability] - 10) / 2) + proficient
      const result = d20(bonus, command.advantage === true, command.disadvantage === true)
      const passed = result.total >= roll.cast.dc
      roll.cast.resolved = true
      saveRoll('Spell Save · ' + victim.name, result, { outcome: passed ? 'ผ่าน' : 'พลาด', targetId: victim.id })
      if (roll.cast.damage && (!passed || roll.cast.half)) {
        const damage = rollDice(roll.cast.damage)
        return saveRoll('Spell Damage · ' + victim.name, {
          ...damage, total: passed ? Math.floor(damage.total / 2) : damage.total
        }, { targetId: victim.id, applied: false })
      }
      return {}
    }
    case 'combat': {
      requireDM(member)
      const target = active()
      if (target.combat) throw new Conflict('กำลังต่อสู้อยู่')
      if (!Array.isArray(command.participants) || !command.participants.length) throw new Invalid('เลือกผู้ร่วมต่อสู้')
      const participants = [...new Set(command.participants)]
      const initiativeByGroup = new Map<string, number>()
      const order = participants.map(key => {
        const creature = get(room.actors, key)
        if (!target.tokens.some(token => token.actorId === key)) throw new Invalid('ผู้ร่วมต่อสู้ต้องอยู่ในฉาก')
        const surprised = Array.isArray(command.surprised) && command.surprised.includes(creature.id)
        const group = creature.templateId && [creature.templateId, creature.initiative, surprised].join(':')
        const grouped = group ? initiativeByGroup.get(group) : undefined
        const initiative = grouped ?? d20(creature.initiative, false, surprised).total
        if (group) initiativeByGroup.set(group, initiative)
        return { actorId: creature.id, initiative }
      })
      target.combat = { order: order.sort((a, b) => b.initiative - a.initiative), round: 1, turn: 0 }
      return {}
    }
    case 'next':
    case 'end':
    case 'tie': {
      requireDM(member)
      const target = active()
      const combat = target.combat
      if (!combat) throw new Invalid('ยังไม่ได้เริ่มการต่อสู้')
      if (command.type === 'end') delete target.combat
      else if (command.type === 'tie') {
        const index = combat.order.findIndex(entry => entry.actorId === command.actorId)
        if (index < 1 || combat.order[index].initiative !== combat.order[index - 1].initiative) throw new Invalid('สลับได้เฉพาะ Initiative ที่เสมอกัน')
        const order = combat.order
        const current = order[combat.turn].actorId
        ;[order[index - 1], order[index]] = [order[index], order[index - 1]]
        combat.turn = order.findIndex(entry => entry.actorId === current)
      } else if (++combat.turn === combat.order.length) {
        combat.turn = 0
        combat.round++
      }
      return {}
    }
    case 'damage': {
      requireDM(member)
      const target = active()
      const creature = actor()
      if (!target.tokens.some(token => token.actorId === creature.id)) throw new Invalid('เป้าหมายต้องอยู่ในฉาก')
      const roll = get(room.rolls, command.rollId)
      if (roll.targetId !== creature.id || roll.applied === undefined) throw new Invalid('ผลทอยนี้ใช้กับเป้าหมายไม่ได้')
      if (!roll.applied) {
        harm(creature, number(command.amount, 0, 9999), roll.critical)
        roll.applied = true
      }
      return {}
    }
    case 'heal':
      requireDM(member)
      heal(actor(), number(command.amount, 1, 9999))
      return {}
    case 'slots': {
      const creature = actor()
      owns(member, creature)
      creature.slots = command.slots === '' ? '' : text(command.slots, 2000)
      return {}
    }
    default:
      throw new Invalid('คำสั่งไม่ถูกต้อง')
  }
}
