import { randomUUID } from 'node:crypto'
import { abilities, blankSheet, damageKinds, nextLivingTurn, sizes } from '../shared/model.ts'
import type { Actor, DamageKind, InventoryItem, LogEntry, LootSkill, Member, ObjectDefinition, Roll, Room, Scene, SceneObject, Sheet, Snapshot, Token, TokenRole } from '../shared/model.ts'
import { areaContains, areaLabels, areaOutline, validArea } from '../shared/area.ts'
import type { Area } from '../shared/area.ts'
import { d20, deathSave, die, harm, heal, Invalid, parseDice, rollDice } from './rules.ts'
import { center, isNear, structureCover } from './cover.ts'
import { createRoadsideEncounter } from './encounter.ts'
import { bonusForCheck, calculatedSheet, commonSkills } from '../shared/characterStats.ts'
import { formatConditions, tickConditions } from '../shared/conditions.ts'
import type { CharacterCalculations, CheckBonus, HitDie, Skill } from '../shared/characterStats.ts'

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
function readTokenRole(value: unknown): TokenRole {
  if (value !== 'character' && value !== 'companion') throw new Invalid('เลือก Character Token หรือ Companion Token')
  return value
}
function withTokenRoles(scene: Scene, actors: Actor[]) {
  const owners = new Map(actors.filter(actor => actor.kind === 'pc').map(actor => [actor.id, actor.ownerId]))
  const main = new Set(scene.tokens.filter(token => token.role === 'character').map(token => owners.get(token.actorId)))
  return scene.tokens.map(token => {
    const owner = owners.get(token.actorId)
    if (!owner || token.role) return token
    const role: TokenRole = main.has(owner) ? 'companion' : 'character'
    main.add(owner)
    return { ...token, role }
  })
}
function image(value: unknown) {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || value.length > 32000 || !/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Invalid('รูปต้องเป็น PNG, JPEG หรือ WebP ที่ระบบย่อแล้ว')
  }
  return value
}
function description(value: unknown) {
  return value ? text(value, 2000) : ''
}
const rarities = ['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary', 'Artifact', 'Varies']
/** Facts copied from the SRD item catalog. Optional, so hand-made items and older rooms stay as they are. */
function catalogFields(item: Record<string, unknown>): Partial<InventoryItem> {
  if (item.ref === undefined) return {}
  const ref = text(item.ref)
  if (!/^srd-5\.2\.1:(equipment|magic):[a-z0-9-]+$/.test(ref)) throw new Invalid('รหัสไอเทมจากคลัง SRD ไม่ถูกต้อง')
  if (item.rarity !== undefined && !rarities.includes(item.rarity as string)) throw new Invalid('Rarity ไม่ถูกต้อง')
  const weight = item.weight === undefined ? undefined : Number(item.weight)
  if (weight !== undefined && !(Number.isFinite(weight) && weight >= 0 && weight <= 100000)) throw new Invalid('น้ำหนักไม่ถูกต้อง')
  return {
    ref, category: item.category === undefined ? undefined : text(item.category, 40),
    rarity: item.rarity as string | undefined, attunement: item.attunement === true ? true : undefined, weight
  }
}
function parseItem(value: unknown, monster: boolean): InventoryItem {
  const item = record(value)
  return {
    id: id(), name: text(item.name), description: description(item.description), image: image(item.image),
    quantity: number(item.quantity ?? 1, 1, 999), tool: item.tool === 'thievesTools' ? 'thievesTools' : undefined,
    lootTier: monster ? item.lootTier === 'bonus' ? 'bonus' : 'basic' : undefined,
    ...catalogFields(item)
  }
}
export function parseObjectDefinition(value: unknown): ObjectDefinition {
  const input = record(value)
  const kind = input.kind
  const fields = {
    name: text(input.name), description: description(input.description), image: image(input.image),
    width: number(input.width ?? 1, .5, 50, .5), height: number(input.height ?? 1, .5, 50, .5)
  }
  if (kind === 'container') {
    const items = input.items ?? []
    if (!Array.isArray(items) || items.length > 50) throw new Invalid('ใส่ของในกล่องได้สูงสุด 50 รายการ')
    return { ...fields, kind, lockDc: input.lockDc === undefined ? undefined : number(input.lockDc, 1, 30),
      items: items.map(entry => {
        const { id: _id, ...item } = parseItem(typeof entry === 'string' ? { name: entry } : entry, false)
        return item
      }) }
  }
  if (kind === 'structure') {
    const cover = input.cover
    if (cover !== 0 && cover !== 2 && cover !== 5 && cover !== 99) throw new Invalid('เลือกประเภทที่กำบัง')
    return { ...fields, kind, hp: number(input.hp, 1, 9999), ac: number(input.ac, 1, 99), cover }
  }
  if (kind === 'prop' || kind === 'item') return { ...fields, kind }
  throw new Invalid('ประเภท Object ไม่ถูกต้อง')
}

function placeObject(definition: ObjectDefinition, position: Command): SceneObject {
  const { kind, name, description, image, width, height } = definition
  const fields = { id: id(), name, description, image, width, height,
    x: number(position.x, -1000, 1000, .5), y: number(position.y, -1000, 1000, .5) }
  if (kind === 'container') return { ...fields, kind, open: false, items: definition.items.map(item => ({ ...item, id: id() })),
    lock: definition.lockDc === undefined ? undefined : { dc: definition.lockDc, locked: true, tried: [] } }
  if (kind === 'structure') return { ...fields, kind, hp: definition.hp, maxHp: definition.hp, ac: definition.ac, cover: definition.cover }
  return { ...fields, kind }
}

function copyScene(room: Room, source: Scene, name: string) {
  const monsters: Actor[] = []
  const copy: Scene = {
    id: id(), name, cell: source.cell, originX: source.originX, originY: source.originY,
    map: source.map && { ...source.map },
    tokens: source.tokens.map(token => {
      const actor = get(room.actors, token.actorId)
      let actorId = actor.id
      if (actor.kind === 'monster') {
        const duplicate = structuredClone(actor)
        duplicate.id = actorId = id()
        duplicate.inventory?.forEach(item => { item.id = id() })
        monsters.push(duplicate)
      }
      return { ...token, id: id(), actorId }
    }),
    objects: source.objects?.map(object => {
      const duplicate = structuredClone(object)
      duplicate.id = id()
      if (duplicate.kind === 'container') {
        duplicate.items.forEach(item => { item.id = id() })
        if (duplicate.lock) duplicate.lock = { dc: duplicate.lock.dc, locked: duplicate.lock.locked, tried: [] }
      }
      return duplicate
    })
  }
  room.actors.push(...monsters)
  room.scenes.splice(room.scenes.indexOf(source) + 1, 0, copy)
  return copy.id
}

function lootSettings(dc: unknown, skill: unknown) {
  if (skill !== 'investigation' && skill !== 'perception') throw new Invalid('เลือกทักษะค้นหา')
  return { lootDc: number(dc, 1, 30), lootSkill: skill as LootSkill }
}
function modifier(score: number) { return Math.floor((score - 10) / 2) }
function readAbility(value: unknown) {
  if (!abilities.includes(value as typeof abilities[number])) throw new Invalid('ค่าความสามารถไม่ถูกต้อง')
  return value as typeof abilities[number]
}
function parseCalculations(value: unknown): CharacterCalculations {
  const input = record(value)
  const output: CharacterCalculations = {}
  if (input.level !== undefined) output.level = number(input.level, 1, 20)
  if (input.hp !== undefined) {
    const hp = record(input.hp)
    if (!Array.isArray(hp.classes) || !hp.classes.length || hp.classes.length > 20) throw new Invalid('ระบุ Hit Dice และระดับคลาส')
    const classes = hp.classes.map(value => {
      const entry = record(value)
      if (![6, 8, 10, 12].includes(entry.die as number)) throw new Invalid('Hit Die ไม่ถูกต้อง')
      return { die: entry.die as HitDie, levels: number(entry.levels, 1, 20) }
    })
    if (classes.reduce((sum, entry) => sum + entry.levels, 0) > 20) throw new Invalid('เลเวลรวมต้องไม่เกิน 20')
    output.hp = { classes, bonus: number(hp.bonus, -200, 500) }
  }
  if (input.armor !== undefined) {
    const armor = record(input.armor)
    if (armor.dex !== 'full' && armor.dex !== 'medium' && armor.dex !== 'none') throw new Invalid('เลือกวิธีใช้ DEX กับ AC')
    output.armor = { base: number(armor.base, 1, 99), dex: armor.dex, shield: armor.shield === true,
      bonus: number(armor.bonus, -30, 99), extra: armor.extra === undefined ? undefined : readAbility(armor.extra) }
  }
  if (input.initiativeBonus !== undefined) output.initiativeBonus = number(input.initiativeBonus, -99, 99)
  if (input.spellAbility !== undefined) output.spellAbility = readAbility(input.spellAbility)
  return output
}
function parseChecks<K extends string>(value: unknown, keys: readonly K[]) {
  const source = record(value)
  const result: Partial<Record<K, CheckBonus>> = {}
  for (const key of keys) if (source[key] !== undefined) {
    const check = record(source[key])
    if (![0, .5, 1, 2].includes(check.training as number)) throw new Invalid('ระดับความชำนาญไม่ถูกต้อง')
    result[key] = { ability: readAbility(check.ability), training: check.training as number, adjustment: number(check.adjustment, -999, 999) }
  }
  return result
}
function damageKind(value: unknown): DamageKind {
  if (value === undefined) return 'untyped'
  if (typeof value !== 'string' || !Object.hasOwn(damageKinds, value)) throw new Invalid('เลือกประเภทความเสียหาย')
  return value as DamageKind
}
function applyDamage(scene: Scene, actor: Actor, amount: number, kind: DamageKind, critical = false) {
  const before = actor.hp + actor.tempHp
  harm(actor, amount, critical)
  const lost = before - actor.hp - actor.tempHp
  if (lost > 0) {
    const at = Date.now()
    scene.damageEvents = [...(scene.damageEvents ?? []).filter(event => at - event.at < 6000),
      { id: id(), actorId: actor.id, amount: lost, kind, at }].slice(-100)
  }
  return lost
}
/** "Goblin เสีย 7 HP (ไฟ) · ล้มลง" — the HP line for the Adventure Log. */
function damageText(actor: Actor, lost: number, kind: DamageKind) {
  return actor.name + ' เสีย ' + lost + ' HP' + (kind === 'untyped' ? '' : ' (' + damageKinds[kind][0] + ')') + (actor.hp === 0 ? ' · ล้มลง' : '')
}
const sceneOf = (room: Room, actorId: string) => room.scenes.find(scene => scene.tokens.some(token => token.actorId === actorId))?.id

export function parseSheet(value: unknown, kind: Sheet['kind'], includeInventory = true): Sheet {
  const input = record(value)
  let sheet = blankSheet(kind)
  sheet.portrait = image(input.portrait)
  if (kind === 'monster' && input.monsterReference !== undefined) {
    const reference = record(input.monsterReference)
    const url = reference.url === undefined ? undefined : text(reference.url, 300)
    if (url && !url.startsWith('https://www.dndbeyond.com/')) throw new Invalid('ลิงก์อ้างอิงมอนสเตอร์ต้องเป็นหน้า D&D Beyond')
    sheet.monsterReference = { statBlock: text(reference.statBlock, 32000), page: reference.page === undefined ? undefined : number(reference.page, 258, 364),
      id: reference.id === undefined ? undefined : text(reference.id, 120), url }
  }
  const proficiencies = input.itemProficiency === undefined ? {} : record(input.itemProficiency)
  sheet.itemProficiency = {
    thievesTools: proficiencies.thievesTools === true, sleight: proficiencies.sleight === true,
    investigation: proficiencies.investigation === true, perception: proficiencies.perception === true
  }
  if (includeInventory && input.inventory !== undefined) {
    if (!Array.isArray(input.inventory) || input.inventory.length > 100) throw new Invalid('Inventory เก็บได้สูงสุด 100 รายการ')
    sheet.inventory = input.inventory.map(item => parseItem(item, kind === 'monster'))
  }
  if (kind === 'monster' && input.lootDc !== undefined) Object.assign(sheet, lootSettings(input.lootDc, input.lootSkill ?? 'investigation'))
  sheet.name = text(input.name)
  if (typeof input.size !== 'string' || !Object.hasOwn(sizes, input.size)) throw new Invalid('ขนาดไม่ถูกต้อง')
  sheet.size = input.size as Sheet['size']
  for (const field of ['classLevel', 'skills', 'saves', 'spells', 'slots', 'conditions'] as const) {
    sheet[field] = input[field] === '' ? '' : text(input[field], 2000)
  }
  for (const field of ['speed', 'ac', 'proficiency', 'spellDC', 'tempHp'] as const) sheet[field] = number(input[field], 0, 999)
  for (const field of ['attack', 'spellAttack', 'initiative'] as const) sheet[field] = number(input[field], -999, 999)
  sheet.maxHp = number(input.maxHp, 1, 9999)
  sheet.hp = number(input.hp, 0, kind === 'pc' && input.calculations !== undefined ? 9999 : sheet.maxHp)
  sheet.damage = text(input.damage)
  parseDice(sheet.damage)
  if (input.attacks !== undefined) {
    if (!Array.isArray(input.attacks) || input.attacks.length > 20) throw new Invalid('บันทึกอาวุธเพิ่มได้สูงสุด 20 รายการ')
    sheet.attacks = input.attacks.map(value => {
      const attack = record(value)
      const damage = text(attack.damage)
      parseDice(damage)
      return { name: text(attack.name), bonus: number(attack.bonus, -999, 999), damage,
        damageKind: attack.damageKind === undefined ? undefined : damageKind(attack.damageKind),
        notes: attack.notes ? text(attack.notes, 500) : undefined }
    })
  } else sheet.attacks = []
  const scores = record(input.abilities)
  for (const ability of abilities) sheet.abilities[ability] = number(scores[ability], 1, 30)
  // Trained saves and skills, hit dice and defenses: player characters and SRD monsters both carry them.
  if (input.characterDetails !== undefined) {
    const details = record(input.characterDetails)
    sheet.characterDetails = Object.fromEntries(['species', 'background', 'hitDice', 'defenses'].map(key =>
      [key, details[key] ? text(details[key], 500) : undefined]))
  }
  if (input.skillChecks !== undefined) sheet.skillChecks = parseChecks(input.skillChecks, Object.keys(commonSkills) as Skill[])
  if (input.savingThrows !== undefined) sheet.savingThrows = parseChecks(input.savingThrows, abilities)
  if (kind === 'pc') {
    if (input.calculations !== undefined) sheet.calculations = parseCalculations(input.calculations)
    sheet = calculatedSheet(sheet)
  }
  if (sheet.hp === 0) sheet.life = kind === 'pc' ? 'dying' : 'dead'
  return sheet
}

const logLimit = 300

/** Append an Adventure Log entry (keeps the most recent 300). */
export function addLog(room: Room, entry: Omit<LogEntry, 'id' | 'at'>) {
  room.log = [...(room.log ?? []), { id: id(), at: Date.now(), ...entry }].slice(-logLimit)
}

/** Log entries this seat may see: everything without a scene, plus the scene players can see (all scenes for the DM). */
export function visibleLog(room: Room, me: Member) {
  return (room.log ?? []).filter(entry => me.role === 'dm' || !entry.sceneId || entry.sceneId === room.activeSceneId)
}

export function visibleRolls(room: Room, me: Member) {
  const visible = new Set(room.scenes.filter(scene => scene.id === room.activeSceneId).flatMap(scene => scene.tokens.map(token => token.actorId)))
  return room.rolls.filter(roll => (!roll.privateTo || roll.privateTo === me.id) &&
    (me.role === 'dm' || !roll.targetId || visible.has(roll.targetId)))
}

export function snapshot(room: Room, me: Member): Snapshot {
  const publicMember = ({ id, name, role }: Member): Member => ({ id, name, role })
  const dm = me.role === 'dm'
  const scenes = (dm ? room.scenes : room.scenes.filter(scene => scene.id === room.activeSceneId)).map(scene => ({
    ...scene, tokens: withTokenRoles(scene, room.actors), objects: dm ? scene.objects : scene.objects?.map(object => object.kind === 'container' ? {
      ...object, items: !object.open || object.lock?.locked ? [] : object.items,
      lock: object.lock && { ...object.lock, tried: object.lock.tried.filter(id => room.actors.some(actor => actor.id === id && actor.ownerId === me.id)) }
    } : object)
  }))
  const visible = new Set(scenes.flatMap(scene => scene.tokens.map(token => token.actorId)))
  const rolls = visibleRolls(room, me)
  const active = scenes.find(scene => scene.id === room.activeSceneId)
  return {
    id: room.id, name: room.name, revision: room.revision, me: publicMember(me), members: room.members.map(publicMember),
    activeSceneId: room.activeSceneId, scenes, invite: dm ? room.invite : undefined, dmInvite: dm ? room.dmInvite : undefined,
    actors: room.actors.filter(actor => dm || actor.ownerId === me.id),
    publicActors: room.actors.filter(actor => dm || visible.has(actor.id)).map(({ id, name, kind, size, portrait, hp, maxHp, tempHp, life, lootResult, conditions }) =>
      ({ id, name, kind, size, portrait, hp, maxHp, tempHp, lootResult, conditions, lootable: kind === 'monster' && life === 'dead' })),
    templates: dm ? room.templates : [],
    rolls: rolls.slice(-40),
    log: visibleLog(room, me).slice(-80),
    settings: room.settings,
    combatQueue: dm && active ? rolls.filter(roll =>
      (roll.sceneId === active.id || (!roll.sceneId && active.tokens.some(token => token.actorId === roll.targetId))) &&
      (roll.applied === false || (roll.cast && !roll.cast.resolved))) : undefined
  }
}

export function applyCommand(room: Room, member: Member, command: Command) {
  const scene = () => get(room.scenes, command.sceneId)
  const active = () => {
    if (command.sceneId !== room.activeSceneId) throw new Conflict('ฉากเปลี่ยนแล้ว')
    return scene()
  }
  const actor = () => get(room.actors, command.actorId)
  const board = () => member.role === 'dm' ? scene() : active()
  const object = (objects: SceneObject[]) => get(objects, command.objectId)
  const editableObject = () => {
    requireDM(member)
    return object(scene().objects ?? [])
  }
  function nearby(target: Scene, creature: Actor, item: { x: number; y: number; width: number; height: number }) {
    owns(member, creature)
    if (creature.life !== 'active') throw new Invalid('ตัวละครนี้ยังโต้ตอบไม่ได้')
    const token = target.tokens.find(entry => entry.actorId === creature.id)
    if (!token || !isNear(token, creature, item)) throw new Invalid('ให้ Token เข้าใกล้เป้าหมายก่อน')
  }
  const saveRoll = (label: string, result: Pick<Roll, 'formula' | 'faces' | 'modifier' | 'total'>, extra: Partial<Roll> = {}) => {
    const privateTo = member.role === 'dm' && command.privateRoll === true ? member.id : undefined
    const roll = { id: id(), name: member.name, label, privateTo, at: Date.now(), ...result, ...extra }
    room.rolls.push(roll)
    return { rollId: roll.id }
  }
  /** Move to the next living combatant; a new round counts down timed conditions. */
  function advanceTurn(target: Scene, combat: NonNullable<Scene['combat']>) {
    const next = nextLivingTurn(combat, actorId => get(room.actors, actorId).life === 'dead')
    if (!next) throw new Invalid('ไม่มีผู้ร่วมต่อสู้ที่ยังมีเทิร์น')
    if (next.round > combat.round) {
      addLog(room, { kind: 'combat', sceneId: target.id, text: 'รอบที่ ' + next.round })
      for (const entry of combat.order) {
        const creature = room.actors.find(item => item.id === entry.actorId)
        if (!creature?.conditions) continue
        const { value, expired } = tickConditions(creature.conditions)
        creature.conditions = value
        if (expired.length) addLog(room, { kind: 'combat', sceneId: target.id, text: creature.name + ' พ้นจาก ' + expired.join(', ') })
      }
    }
    Object.assign(combat, next)
  }
  switch (command.type) {
    case 'dmInvite':
      requireDM(member)
      room.dmInvite = id()
      return {}
    case 'demoEncounter':
      requireDM(member)
      createRoadsideEncounter(room, member.id)
      return {}
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
    case 'copyScene': {
      requireDM(member)
      return { sceneId: copyScene(room, scene(), text(command.name)) }
    }
    case 'moveScene': {
      requireDM(member)
      const index = room.scenes.indexOf(scene())
      const offset = command.offset
      if (offset !== -1 && offset !== 1) throw new Invalid('ระบุทิศทางการย้ายฉาก')
      const destination = index + offset
      if (room.scenes[destination]) [room.scenes[index], room.scenes[destination]] = [room.scenes[destination], room.scenes[index]]
      return {}
    }
    case 'reorderScenes': {
      // Drag-and-drop order from the scene strip: the full list of scene ids, each exactly once.
      requireDM(member)
      const ids = command.sceneIds
      if (!Array.isArray(ids) || ids.length !== room.scenes.length || new Set(ids).size !== ids.length) throw new Invalid('ลำดับฉากไม่ครบ')
      room.scenes = ids.map(sceneId => get(room.scenes, sceneId))
      return {}
    }
    case 'deleteScene': {
      requireDM(member)
      const removed = scene()
      const index = room.scenes.indexOf(removed)
      room.scenes.splice(index, 1)
      if (room.activeSceneId === removed.id) room.activeSceneId = (room.scenes[index] ?? room.scenes[index - 1])?.id
      return {}
    }
    case 'activate': {
      requireDM(member)
      const opened = scene()
      if (room.activeSceneId !== opened.id) addLog(room, { kind: 'scene', text: 'เปิดฉาก ' + opened.name, sceneId: opened.id })
      room.activeSceneId = opened.id
      return {}
    }
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
      const sheet = parseSheet(command.sheet, kind, !existing)
      if (existing) {
        if (member.role !== 'dm' && room.scenes.some(scene => scene.combat?.order.some(entry => entry.actorId === existing.id))
          && (existing.hp !== sheet.hp || existing.tempHp !== sheet.tempHp)) throw new Forbidden('ให้ DM แก้ HP ระหว่างต่อสู้')
        if (existing.hp === 0 && sheet.hp === 0) Object.assign(sheet, {
          life: existing.life, successes: existing.successes, failures: existing.failures
        })
        Object.assign(existing, sheet)
        if (!sheet.calculations) delete existing.calculations
      } else room.actors.push({ id: id(), ownerId: member.id, ...sheet })
      return {}
    }
    case 'inventoryAdd':
    case 'inventoryRemove': {
      const creature = actor()
      owns(member, creature)
      if (creature.lootResult) throw new Invalid('ค้นศพนี้แล้ว')
      const inventory = creature.inventory ?? []
      if (command.type === 'inventoryAdd') {
        if (inventory.length >= 100) throw new Invalid('Inventory เต็ม')
        creature.inventory = [...inventory, parseItem(command.item, creature.kind === 'monster')]
      } else {
        const item = get(inventory, command.itemId)
        creature.inventory = inventory.filter(entry => entry.id !== item.id)
      }
      return {}
    }
    case 'lootSettings': {
      requireDM(member)
      const creature = actor()
      if (creature.kind !== 'monster' || creature.lootResult) throw new Invalid('ตั้งค่าได้ก่อนค้นศพมอนสเตอร์')
      Object.assign(creature, lootSettings(command.dc, command.skill))
      return {}
    }
    case 'searchLoot': {
      const target = active()
      const monster = actor()
      if (monster.kind !== 'monster' || monster.life !== 'dead') throw new Invalid('ค้นได้เมื่อมอนสเตอร์ถูกสังหารแล้ว')
      if (monster.lootResult) throw new Conflict('ค้นศพนี้แล้ว')
      const corpse = target.tokens.find(token => token.actorId === monster.id)
      if (!corpse) throw new Invalid('ไม่พบศพในฉาก')
      const searcher = get(room.actors, command.searcherId)
      if (searcher.kind !== 'pc') throw new Invalid('เลือกตัวละครผู้เล่นที่จะค้น')
      nearby(target, searcher, { ...corpse, width: sizes[monster.size], height: sizes[monster.size] })
      const inventory = searcher.inventory ?? []
      const loot = monster.inventory ?? []
      if (!loot.length) throw new Invalid('มอนสเตอร์ตัวนี้ไม่มีของให้ค้น')
      if (inventory.length + loot.length > 100) throw new Invalid('Inventory ต้องมีที่ว่างพอสำหรับของทั้งหมด')
      const skill = monster.lootSkill ?? 'investigation'
      const dc = monster.lootDc ?? 12
      const imported = searcher.skillChecks?.[skill === 'perception' ? 'Perception' : 'Investigation']
      const bonus = imported ? bonusForCheck(searcher, imported) : modifier(searcher.abilities[skill === 'perception' ? 'WIS' : 'INT']) +
        (searcher.itemProficiency?.[skill] ? searcher.proficiency : 0)
      const result = d20(bonus, false, false)
      const passed = result.total >= dc
      const found = loot.filter(item => passed || item.lootTier !== 'bonus')
      searcher.inventory = [...inventory, ...found.map(({ lootTier: _tier, ...item }) => item)]
      monster.inventory = []
      monster.lootResult = { passed, total: result.total, searcher: searcher.name,
        found: found.map(item => ({ name: item.name, quantity: item.quantity ?? 1 })) }
      return saveRoll('ค้น ' + monster.name + ' · DC ' + dc, result, { sceneId: target.id, sourceId: searcher.id,
        outcome: (passed ? 'ผ่าน' : 'ได้เฉพาะของพื้นฐาน') + ' · ' + found.length + ' รายการ' })
    }
    case 'template': {
      requireDM(member)
      const sheet = parseSheet(command.sheet, 'monster')
      if (command.templateId) get(room.templates, command.templateId).sheet = sheet
      else room.templates.push({ id: id(), sheet })
      return {}
    }
    case 'place': {
      const target = board()
      if (command.templateId || command.kind === 'monster') requireDM(member)
      if ([command.templateId, command.actorId, command.sheet].filter(value => value !== undefined).length !== 1) throw new Invalid('เลือกชีตสำหรับวาง Token')
      const template = command.templateId ? get(room.templates, command.templateId) : undefined
      const sheet = command.sheet === undefined ? undefined : parseSheet(command.sheet, command.kind === 'monster' ? 'monster' : 'pc')
      const creature = template ? { ...structuredClone(template.sheet), id: id(), ownerId: member.id, templateId: template.id,
        inventory: template.sheet.inventory?.map(item => ({ ...item, id: id() })) }
        : sheet ? { ...sheet, id: id(), ownerId: member.id } : actor()
      owns(member, creature)
      if (creature.kind === 'monster') requireDM(member)
      if (target.tokens.some(token => token.actorId === creature.id)) throw new Invalid('มี Token ของตัวนี้ในฉากแล้ว')
      const tokens = withTokenRoles(target, room.actors)
      const hasMain = tokens.some(token => token.role === 'character' && room.actors.some(actor => actor.id === token.actorId && actor.ownerId === creature.ownerId))
      const role = creature.kind === 'pc' ? command.role === undefined ? hasMain ? 'companion' : 'character' : readTokenRole(command.role) : undefined
      if (role === 'character' && hasMain) throw new Conflict('ผู้เล่นนี้มี Character Token ในฉากแล้ว เลือก Companion Token หรือเปลี่ยนตัวหลักจากเมนู Token')
      const token = { id: id(), actorId: creature.id, role,
        x: number(command.x, -1000, 1000, .5), y: number(command.y, -1000, 1000, .5) }
      if (template) {
        const ordinal = room.actors.filter(item => item.templateId === template.id).length + 1
        creature.name = template.sheet.name + ' ' + ordinal
      }
      if (template || sheet) room.actors.push(creature)
      target.tokens = [...tokens, token]
      return {}
    }
    case 'tokenRole': {
      const target = board()
      const tokens = withTokenRoles(target, room.actors)
      const token = get(tokens, command.tokenId)
      const creature = get(room.actors, token.actorId)
      owns(member, creature)
      if (creature.kind !== 'pc') throw new Invalid('เลือก Token ตัวละคร')
      const role = readTokenRole(command.role)
      const owned = new Set(room.actors.filter(actor => actor.ownerId === creature.ownerId).map(actor => actor.id))
      target.tokens = tokens.map(entry => {
        if (entry.id === token.id) return { ...entry, role }
        if (role === 'character' && entry.role === 'character' && owned.has(entry.actorId)) return { ...entry, role: 'companion' }
        return entry
      })
      return {}
    }
    case 'stepCharacter': {
      const target = active()
      const token = get(withTokenRoles(target, room.actors), command.tokenId)
      if (member.role !== 'player' || token.role !== 'character') throw new Forbidden('ใช้ปุ่มลูกศรกับ Character Token ของตัวเอง')
      owns(member, get(room.actors, token.actorId))
      const dx = number(command.dx, -1, 1)
      const dy = number(command.dy, -1, 1)
      if (Math.abs(dx) + Math.abs(dy) !== 1) throw new Invalid('ย้ายได้ทีละหนึ่งช่อง')
      const x = number(token.x + dx, -1000, 1000, .5)
      const y = number(token.y + dy, -1000, 1000, .5)
      Object.assign(get(target.tokens, token.id), { x, y })
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
    case 'moveTokens': {
      const target = board()
      if (!Array.isArray(command.tokenIds) || command.tokenIds.length < 1 || command.tokenIds.length > 100) throw new Invalid('เลือกได้สูงสุด 100 Token')
      const dx = number(command.dx, -2000, 2000, .5)
      const dy = number(command.dy, -2000, 2000, .5)
      const moves = [...new Set(command.tokenIds)].map(key => {
        const token = get(target.tokens, key)
        owns(member, get(room.actors, token.actorId))
        return { token, x: number(token.x + dx, -1000, 1000, .5), y: number(token.y + dy, -1000, 1000, .5) }
      })
      for (const { token, x, y } of moves) Object.assign(token, { x, y })
      return {}
    }
    case 'importObject': {
      requireDM(member)
      const target = scene()
      const definition = parseObjectDefinition(command.definition ?? { ...command, lockDc: command.locked === true ? command.lockDc ?? 15 : undefined })
      const imported = placeObject(definition, command)
      ;(target.objects ??= []).push(imported)
      return {}
    }
    case 'moveObject': {
      const target = editableObject()
      target.x = number(command.x, -1000, 1000, .5)
      target.y = number(command.y, -1000, 1000, .5)
      return {}
    }
    case 'removeObject': {
      const removed = editableObject()
      const target = scene()
      target.objects = target.objects!.filter(item => item.id !== removed.id)
      return {}
    }
    case 'damageObject': {
      const target = editableObject()
      if (target.kind !== 'structure') throw new Invalid('เป้าหมายต้องเป็นสิ่งก่อสร้าง')
      target.hp = Math.max(0, target.hp - number(command.amount, 1, 9999))
      return {}
    }
    case 'setLock': {
      const current = editableObject()
      if (current.kind !== 'container') throw new Invalid('ล็อกได้เฉพาะกล่อง')
      current.lock = { dc: number(command.dc, 1, 30), locked: true, tried: [] }
      current.open = false
      return {}
    }
    case 'pickLock': {
      const target = board()
      const current = object(target.objects ?? [])
      if (current.kind !== 'container' || !current.lock?.locked) throw new Invalid('กล่องนี้ไม่ได้ล็อก')
      const creature = actor()
      nearby(target, creature, current)
      if (current.lock.tried.includes(creature.id)) throw new Conflict('ตัวละครนี้ลองสะเดาะล็อกไปแล้ว')
      if (!creature.inventory?.some(item => item.tool === 'thievesTools')) throw new Invalid('ต้องมี Thieves’ Tools ใน Inventory')
      const hasTool = creature.itemProficiency?.thievesTools === true
      const hasSkill = creature.itemProficiency?.sleight === true
      const result = d20(modifier(creature.abilities.DEX) + (hasTool || hasSkill ? creature.proficiency : 0), hasTool && hasSkill, false)
      const passed = result.total >= current.lock.dc
      current.lock.tried.push(creature.id)
      current.lock.last = { total: result.total, passed }
      if (passed) { current.lock.locked = false; current.open = true }
      return saveRoll('สะเดาะ ' + current.name + ' · DC ' + current.lock.dc, result, { sceneId: target.id, sourceId: creature.id,
        outcome: passed ? 'ปลดล็อกแล้ว' : 'สะเดาะไม่สำเร็จ' })
    }
    case 'openObject':
    case 'takeItem':
    case 'storeItem': {
      const target = board()
      const current = object(target.objects ?? [])
      const creature = command.actorId ? actor() : undefined
      if (creature) {
        nearby(target, creature, current)
      } else if (member.role !== 'dm' || command.type !== 'openObject') throw new Invalid('เลือกตัวละครก่อน')
      if (command.type === 'openObject') {
        if (current.kind !== 'container') throw new Invalid('เป้าหมายต้องเป็นกล่อง')
        if (current.lock?.locked) {
          requireDM(member)
          current.lock.locked = false
          current.open = true
          return {}
        }
        current.open = !current.open
        return {}
      }
      if (current.kind === 'container' && current.lock?.locked) throw new Invalid('กล่องยังล็อกอยู่')
      const inventory = creature!.inventory ??= []
      if (command.type === 'storeItem') {
        if (current.kind !== 'container' || !current.open || current.items.length >= 50) throw new Invalid('กล่องต้องเปิดอยู่และมีที่ว่าง')
        const item = get(inventory, command.itemId)
        current.items.push(item)
        creature!.inventory = inventory.filter(entry => entry.id !== item.id)
      } else {
        if (inventory.length >= 100) throw new Invalid('Inventory เต็ม')
        let item: InventoryItem
        if (current.kind === 'item') {
          item = { id: current.id, name: current.name, description: current.description, image: current.image }
          target.objects = target.objects!.filter(entry => entry.id !== current.id)
        } else if (current.kind === 'container' && current.open) {
          item = get(current.items, command.itemId)
          current.items = current.items.filter(entry => entry.id !== item.id)
        } else throw new Invalid('เปิดกล่องก่อนหยิบของ')
        inventory.push(item)
      }
      return {}
    }
    case 'attackObject': {
      const target = active()
      const creature = actor()
      owns(member, creature)
      const source = target.tokens.find(token => token.actorId === creature.id)
      const item = object(target.objects ?? [])
      if (!source || item.kind !== 'structure' || item.hp <= 0) throw new Invalid('เลือกผู้โจมตีและสิ่งก่อสร้างในฉาก')
      if (!isNear(source, creature, item)) throw new Invalid('ขยับเข้าใกล้ก่อนโจมตีสิ่งก่อสร้าง')
      const roll = d20(creature.attack, command.advantage === true, command.disadvantage === true)
      const hit = roll.natural === 20 || (roll.natural !== 1 && roll.total >= item.ac)
      saveRoll('โจมตี ' + item.name, roll, { outcome: hit ? 'โดน' : 'พลาด' })
      if (hit) {
        const damage = rollDice(creature.damage, die, roll.natural === 20)
        item.hp = Math.max(0, item.hp - Math.max(0, damage.total))
        saveRoll('Damage · ' + item.name, damage, { outcome: item.hp === 0 ? 'ถูกทำลาย' : undefined })
      }
      return {}
    }
    case 'removeToken': {
      requireDM(member)
      const target = scene()
      const token = get(target.tokens, command.tokenId)
      if (target.combat?.order.some(entry => entry.actorId === token.actorId)) {
        throw new Conflict('ให้นำ Token ออกหลังจบการต่อสู้')
      }
      target.tokens = withTokenRoles(target, room.actors).filter(item => item.id !== token.id)
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
        const manualCover = number(command.cover ?? 0, 0, 5)
        if (![0, 2, 5].includes(manualCover)) throw new Invalid('ค่าที่กำบังไม่ถูกต้อง')
        const tokenOf = (key: string) => target.tokens.find(token => token.actorId === key) as Token
        const cover = Math.max(manualCover, structureCover(target.objects ?? [], center(tokenOf(creature.id), creature), center(tokenOf(victim.id), victim)))
        if (cover === 99) throw new Invalid('เป้าหมายอยู่หลังที่กำบังเต็ม')
        const hitRoll = d20(rollType === 'attack' ? weapon?.bonus ?? creature.attack : creature.spellAttack, advantage, disadvantage)
        const critical = hitRoll.natural === 20
        const hit = critical || (hitRoll.natural !== 1 && hitRoll.total >= victim.ac + cover)
        const context = { sceneId: target.id, sourceId: creature.id, targetId: victim.id }
        saveRoll((weapon?.name ?? rollType) + ' · ' + creature.name, hitRoll, { ...context, outcome: critical ? 'คริติคัล' : hit ? 'โดน' : 'พลาด' })
        if (!hit) return {}
        const receipt = saveRoll('Damage · ' + victim.name, rollDice(rollType === 'attack' ? weapon?.damage ?? creature.damage : text(command.formula), die, critical), {
          ...context, applied: false, critical, damageKind: rollType === 'attack'
            ? (weapon ?? creature.attacks?.find(attack => attack.bonus === creature.attack && attack.damage === creature.damage))?.damageKind : undefined
        })
        if (room.settings?.autoDamage) {
          // Table rule: hits apply at once; the DM can still adjust HP afterwards.
          const damageRoll = room.rolls[room.rolls.length - 1]
          const kind = damageRoll.damageKind ?? 'untyped'
          const lost = applyDamage(target, victim, Math.max(0, damageRoll.total), kind, critical)
          damageRoll.applied = true
          if (lost > 0) addLog(room, { kind: 'hp', text: damageText(victim, lost, kind), sceneId: target.id })
        }
        return receipt
      }
      if (rollType === 'initiative') return saveRoll('Initiative · ' + creature.name, d20(creature.initiative, advantage, disadvantage))
      if (rollType !== 'check' && rollType !== 'save') throw new Invalid('ประเภทการทอยไม่ถูกต้อง')
      if (!abilities.includes(command.ability as typeof abilities[number])) throw new Invalid('เลือกค่าความสามารถ')
      const ability = command.ability as typeof abilities[number]
      const skill = typeof command.skill === 'string' && Object.hasOwn(commonSkills, command.skill) ? command.skill as Skill : undefined
      const trained = rollType === 'save' ? creature.savingThrows?.[ability] : skill ? creature.skillChecks?.[skill] : undefined
      const score = skill && rollType === 'check' ? commonSkills[skill] : ability
      const bonus = trained ? bonusForCheck(creature, trained) : modifier(creature.abilities[score]) + (command.proficient === true ? creature.proficiency : 0)
      return saveRoll((rollType === 'check' && skill ? skill : ability) + ' ' + rollType + ' · ' + creature.name, d20(bonus, advantage, disadvantage))
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
        sceneId: target.id, sourceId: caster.id, targetId: victim.id, cast: { ability, dc: caster.spellDC, targetId: victim.id, damage, half: command.half === true }
      })
    }
    case 'spellSave': {
      const target = active()
      const roll = get(room.rolls, command.rollId)
      if (!roll.cast || roll.cast.resolved || (roll.sceneId && roll.sceneId !== target.id)) throw new Conflict('คำขอ Save นี้ใช้ไม่ได้ในฉากนี้')
      const victim = get(room.actors, roll.cast.targetId)
      owns(member, victim)
      if (!target.tokens.some(token => token.actorId === victim.id)) throw new Invalid('เป้าหมายต้องอยู่ในฉาก')
      const proficient = command.proficient === true ? victim.proficiency : 0
      const saved = victim.savingThrows?.[roll.cast.ability]
      const bonus = saved ? bonusForCheck(victim, saved) : modifier(victim.abilities[roll.cast.ability]) + proficient
      const result = d20(bonus, command.advantage === true, command.disadvantage === true)
      const passed = result.total >= roll.cast.dc
      roll.cast.resolved = true
      const context = { sceneId: target.id, sourceId: roll.sourceId, targetId: victim.id }
      saveRoll('Spell Save · ' + victim.name, result, { ...context, outcome: passed ? 'ผ่าน' : 'พลาด' })
      if (roll.cast.damage && (!passed || roll.cast.half)) {
        const damage = rollDice(roll.cast.damage)
        return saveRoll('Spell Damage · ' + victim.name, {
          ...damage, total: passed ? Math.floor(damage.total / 2) : damage.total
        }, { ...context, applied: false })
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
      target.lastParticipants = participants as string[]
      addLog(room, { kind: 'combat', sceneId: target.id, text: 'เริ่มการต่อสู้ · ' + target.combat.order.map(entry =>
        get(room.actors, entry.actorId).name + ' ' + entry.initiative).join(', ') })
      return {}
    }
    case 'endTurn': {
      // A player ends their own character's turn; the DM can end anyone's.
      const target = active()
      const combat = target.combat
      if (!combat) throw new Invalid('ยังไม่ได้เริ่มการต่อสู้')
      const currentActor = get(room.actors, combat.order[combat.turn].actorId)
      if (member.role !== 'dm' && (currentActor.ownerId !== member.id || command.actorId !== currentActor.id)) throw new Forbidden('ยังไม่ถึงเทิร์นของคุณ')
      advanceTurn(target, combat)
      return {}
    }
    case 'previousTurn': {
      requireDM(member)
      const combat = active().combat
      if (!combat) throw new Invalid('ยังไม่ได้เริ่มการต่อสู้')
      if (combat.turn > 0) combat.turn--
      else if (combat.round > 1) { combat.round--; combat.turn = combat.order.length - 1 }
      else throw new Invalid('นี่คือเทิร์นแรกของการต่อสู้แล้ว')
      return {}
    }
    case 'settings': {
      requireDM(member)
      const input = record(command.settings)
      room.settings = { ...room.settings, autoDamage: input.autoDamage === true }
      return {}
    }
    case 'conditions': {
      const creature = actor()
      owns(member, creature)
      if (!Array.isArray(command.conditions) || command.conditions.length > 20) throw new Invalid('เลือก Condition ได้สูงสุด 20 อย่าง')
      creature.conditions = formatConditions(command.conditions.map(value => {
        const entry = record(value)
        const name = text(entry.name, 40)
        if (name.includes(',') || name.includes(':')) throw new Invalid('ชื่อ Condition ไม่ถูกต้อง')
        return { name, rounds: entry.rounds === undefined ? undefined : number(entry.rounds, 1, 99) }
      }))
      return {}
    }
    case 'next':
    case 'end':
    case 'tie': {
      requireDM(member)
      const target = active()
      const combat = target.combat
      if (!combat) throw new Invalid('ยังไม่ได้เริ่มการต่อสู้')
      if (command.type === 'end') {
        delete target.combat
        addLog(room, { kind: 'combat', sceneId: target.id, text: 'จบการต่อสู้' })
      } else if (command.type === 'tie') {
        const index = combat.order.findIndex(entry => entry.actorId === command.actorId)
        if (index < 1 || combat.order[index].initiative !== combat.order[index - 1].initiative) throw new Invalid('สลับได้เฉพาะ Initiative ที่เสมอกัน')
        const order = combat.order
        const current = order[combat.turn].actorId
        ;[order[index - 1], order[index]] = [order[index], order[index - 1]]
        combat.turn = order.findIndex(entry => entry.actorId === current)
      } else advanceTurn(target, combat)
      return {}
    }
    case 'damage': {
      requireDM(member)
      const target = active()
      const creature = actor()
      if (!target.tokens.some(token => token.actorId === creature.id)) throw new Invalid('เป้าหมายต้องอยู่ในฉาก')
      const roll = get(room.rolls, command.rollId)
      if (roll.targetId !== creature.id || roll.applied === undefined || (roll.sceneId && roll.sceneId !== target.id)) throw new Invalid('ผลทอยนี้ใช้กับเป้าหมายไม่ได้')
      if (!roll.applied) {
        const kind = damageKind(command.damageKind)
        const lost = applyDamage(target, creature, number(command.amount, 0, 9999), kind, roll.critical)
        roll.applied = true
        if (lost > 0) addLog(room, { kind: 'hp', text: damageText(creature, lost, kind), sceneId: target.id })
      }
      return {}
    }
    case 'areaDamage': {
      requireDM(member)
      const target = active()
      if (!target.combat) throw new Invalid('เริ่ม Encounter ก่อนใช้ AoE')
      const input = record(command.area)
      const coordinates = (value: unknown) => {
        const point = record(value)
        return { x: number(point.x, -1000, 1000, .5), y: number(point.y, -1000, 1000, .5) }
      }
      if (typeof input.kind !== 'string' || !Object.hasOwn(areaLabels, input.kind)) throw new Invalid('เลือกรูปทรง AoE')
      const area: Area = { kind: input.kind as Area['kind'], from: coordinates(input.from), to: coordinates(input.to) }
      if (!validArea(area) || Math.hypot(area.from.x - area.to.x, area.from.y - area.to.y) > 200) throw new Invalid('ขนาดพื้นที่ AoE ไม่ถูกต้อง')
      const outline = areaOutline(area)
      const kind = damageKind(command.damageKind)
      const allowed = target.tokens.flatMap(token => {
        const creature = get(room.actors, token.actorId)
        return creature.life !== 'dead' && areaContains(outline, center(token, creature)) ? [creature] : []
      })
      if (!Array.isArray(command.targets) || !command.targets.length || command.targets.length > 100) throw new Invalid('เลือกเป้าหมายในพื้นที่ AoE')
      const effects = command.targets.map(value => {
        const entry = record(value)
        if (entry.effect !== 'full' && entry.effect !== 'half') throw new Invalid('เลือกผลของเป้าหมาย')
        return { actor: get(allowed, entry.actorId), multiplier: entry.effect === 'half' ? .5 : 1 }
      })
      if (new Set(effects.map(entry => entry.actor.id)).size !== effects.length) throw new Invalid('เลือกเป้าหมายซ้ำ')
      const result = rollDice(text(command.formula))
      const hits = effects.map(entry => ({ actor: entry.actor, lost: applyDamage(target, entry.actor, Math.max(0, Math.floor(result.total * entry.multiplier)), kind) }))
      const hurt = hits.filter(hit => hit.lost > 0)
      if (hurt.length) addLog(room, { kind: 'hp', sceneId: target.id, text: 'AoE ' + damageKinds[kind][0] + ' · ' +
        hurt.map(hit => hit.actor.name + ' −' + hit.lost + (hit.actor.hp === 0 ? ' ล้มลง' : '')).join(', ') })
      target.areaEffect = { area, kind, at: Date.now() }
      return saveRoll('AoE · ' + areaLabels[area.kind] + ' · ' + damageKinds[kind][0], result, {
        sceneId: target.id, sourceId: target.combat.order[target.combat.turn].actorId, outcome: effects.length + ' เป้าหมาย'
      })
    }
    case 'heal': {
      requireDM(member)
      const creature = actor()
      const amount = number(command.amount, 1, 9999)
      heal(creature, amount)
      const sceneId = sceneOf(room, creature.id)
      if (sceneId) addLog(room, { kind: 'hp', text: creature.name + ' ฟื้น ' + amount + ' HP', sceneId })
      return {}
    }
    case 'adjustHp': {
      requireDM(member)
      const creature = actor()
      const where = scene()
      if (!where.tokens.some(token => token.actorId === creature.id)) throw new Invalid('ไม่พบ Token ในฉาก')
      const amount = number(command.amount, 1, 9999)
      if (command.mode === 'damage') {
        const kind = damageKind(command.damageKind)
        const lost = applyDamage(where, creature, amount, kind)
        if (lost > 0) addLog(room, { kind: 'hp', text: damageText(creature, lost, kind), sceneId: where.id })
      } else if (command.mode === 'heal') {
        heal(creature, amount)
        addLog(room, { kind: 'hp', text: creature.name + ' ฟื้น ' + amount + ' HP', sceneId: where.id })
      } else if (command.mode === 'temp') {
        creature.tempHp = amount
        addLog(room, { kind: 'hp', text: creature.name + ' ได้ Temp HP ' + amount, sceneId: where.id })
      } else throw new Invalid('ประเภทการปรับ HP ไม่ถูกต้อง')
      return {}
    }
    case 'chat': {
      const message = text(command.text, 500)
      addLog(room, { kind: 'chat', text: message, name: member.name })
      return {}
    }
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
