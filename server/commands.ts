import { randomUUID } from 'node:crypto'
import { abilities, blankSheet, damageKinds, nextLivingTurn, objectOwner, sizes } from '../shared/model.ts'
import type { Actor, Combat, DamageKind, InventoryItem, KnownSpell, LogEntry, LootSkill, Member, ObjectDefinition, Roll, Room, Scene, SceneObject, Sheet, Snapshot, Token, TokenRole } from '../shared/model.ts'
import { areaContains, areaLabels, areaOutline, validArea } from '../shared/area.ts'
import type { Area } from '../shared/area.ts'
import { d20, deathSave, die, harm, heal, Invalid, parseDice, rollDice, rollPool } from './rules.ts'
import { center, isNear, structureCover } from './cover.ts'
import { createRoadsideEncounter } from './encounter.ts'
import { bonusForCheck, calculatedSheet, commonSkills } from '../shared/characterStats.ts'
import { conditionBase, formatConditions, formatSlots, parseConditions, parseSlots, tickConditions } from '../shared/conditions.ts'
import { advanceEffects, concentrationDc, d20Penalty, effectName, hasCondition, incapacitating, tiedTo } from '../shared/effects.ts'
import { hitDiceLeft, hitDieHealing, restedSheet } from '../shared/rest.ts'
import type { ClassResource, Effect, HitDie as RestDie } from '../shared/model.ts'
import type { CharacterCalculations, CheckBonus, HitDie, Skill } from '../shared/characterStats.ts'
import { attackOdds, chooseMode, chosenMode, rollOdds } from '../shared/advantage.ts'
import type { Odds } from '../shared/advantage.ts'
import { characterLevel, criticalFrom, magicalCunning, monsterXp, srdFeats, srdSubclasses } from '../shared/progression.ts'
import { key, lightsOf, playerView, seenBy, tokenCenter, tokenSeen, visionOf, wallsForPlayer } from '../shared/vision.ts'
import type { ActorVision, Ambient, Door, LightSource, SceneVision, Wall } from '../shared/vision.ts'
import { gridFeet, moveCost, speedNow } from '../shared/movement.ts'
import { afterCommand, beforeCommand, isUndoable, redoLast, undoLast } from './undo.ts'
import { freshUse, gapBetween, reachOf } from '../shared/economy.ts'
import type { TurnUse } from '../shared/economy.ts'
import { itemLights } from '../shared/vision.ts'
import { serverSpell } from './spellCatalog.ts'
import { canSee, canvaEmbed, handoutLimits } from '../shared/handouts.ts'
import type { Handout } from '../shared/handouts.ts'
import { scaledDice } from '../shared/spells.ts'
import { bardicDie, featureResource, inspirationDie, isRaging, levelIn, plusModifier, rageDamage, resists } from '../shared/classFeatures.ts'
import { boardArt, isCatalogArt, itemIcon, monsterPortrait, sceneArtByImage } from '../shared/catalogArt.ts'

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
  if (typeof value === 'string' && isCatalogArt(value)) return value
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
function parseActorVision(value: unknown): ActorVision {
  const input = record(value)
  const feet = (item: unknown) => item === undefined || item === null || item === '' ? undefined : number(item, 0, 1000)
  const light = input.light === undefined || input.light === null ? undefined : record(input.light)
  return {
    range: feet(input.range), darkvision: feet(input.darkvision),
    light: light && { bright: number(light.bright, 0, 300), dim: number(light.dim, 0, 300), on: light.on === true }
  }
}
const cellPoint = (value: unknown): { x: number; y: number } => {
  const point = record(value)
  return { x: number(point.x, -1000, 1000, .5), y: number(point.y, -1000, 1000, .5) }
}
const cellKey = (value: unknown) => {
  const match = /^(-?\d{1,4}),(-?\d{1,4})$/.exec(String(value))
  if (!match) throw new Invalid('ช่องไม่ถูกต้อง')
  return key(Number(match[1]), Number(match[2]))
}
function baseRef(value: unknown) {
  const ref = String(value)
  if (!/^srd-5\.2\.1:equipment:[a-z0-9-]+$/.test(ref)) throw new Invalid('ไอเทมพื้นฐานไม่ถูกต้อง')
  return ref
}
function catalogFields(item: Record<string, unknown>): Partial<InventoryItem> {
  if (item.ref === undefined) return {}
  const ref = text(item.ref)
  if (!/^srd-5\.2\.1:(equipment|magic):[a-z0-9-]+$/.test(ref)) throw new Invalid('รหัสไอเทมจากคลัง SRD ไม่ถูกต้อง')
  if (item.rarity !== undefined && !rarities.includes(item.rarity as string)) throw new Invalid('Rarity ไม่ถูกต้อง')
  const weight = item.weight === undefined ? undefined : Number(item.weight)
  if (weight !== undefined && !(Number.isFinite(weight) && weight >= 0 && weight <= 100000)) throw new Invalid('น้ำหนักไม่ถูกต้อง')
  return {
    ref, category: item.category === undefined ? undefined : text(item.category, 40),
    rarity: item.rarity as string | undefined, attunement: item.attunement === true ? true : undefined, weight,
    bonus: item.bonus === undefined || item.bonus === 0 ? undefined : number(item.bonus, 1, 3),
    base: item.base === undefined ? undefined : baseRef(item.base)
  }
}
function parseItem(value: unknown, monster: boolean): InventoryItem {
  const item = record(value)
  return {
    id: id(), name: text(item.name), description: description(item.description), image: image(item.image),
    quantity: number(item.quantity ?? 1, 1, 999), tool: item.tool === 'thievesTools' ? 'thievesTools' : undefined,
    lootTier: monster ? item.lootTier === 'bonus' ? 'bonus' : 'basic' : undefined,
    lit: item.lit === true ? true : undefined,
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
    ...(source.vision ? { vision: { ...structuredClone(source.vision), explored: undefined } } : {}),
    tokens: source.tokens.map(token => {
      const actor = get(room.actors, token.actorId)
      let actorId = actor.id
      if (actor.kind === 'monster' || actor.temp) {
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
      bonus: number(armor.bonus, -30, 99), extra: armor.extra === undefined ? undefined : readAbility(armor.extra),
      armorMagic: armor.armorMagic === undefined ? undefined : number(armor.armorMagic, 0, 3),
      shieldMagic: armor.shieldMagic === undefined ? undefined : number(armor.shieldMagic, 0, 3) }
  }
  if (input.initiativeBonus !== undefined) output.initiativeBonus = number(input.initiativeBonus, -99, 99)
  if (input.spellAbility !== undefined) output.spellAbility = readAbility(input.spellAbility)
  return output
}
const restDice: RestDie[] = ['d6', 'd8', 'd10', 'd12']
/** Class resources: up to 12 named counters, each with how much a Short Rest gives back. */
function parseResources(value: unknown): ClassResource[] {
  if (!Array.isArray(value) || value.length > 12) throw new Invalid('ทรัพยากรของคลาสมีได้สูงสุด 12 รายการ')
  return value.map(item => {
    const entry = record(item)
    const max = number(entry.max, 1, 999)
    const short = entry.short === 'all' || entry.short === 'one' ? entry.short : 'none'
    return { name: text(entry.name, 40), max, used: number(entry.used ?? 0, 0, max), short }
  })
}
/** Spend one spell slot of `level` (1–9) for a cast; 0 or none means a cantrip or a free cast. */
/** Spend one slot of a level: from Pact Magic when `pact` is set (a Warlock multiclass picks which pool), else the ordinary slots. */
function spendSlot(caster: Actor, level: unknown, pact = false) {
  if (level === undefined || level === 0) return
  const wanted = number(level, 1, 9)
  const field = pact && caster.pactSlots !== undefined ? 'pactSlots' : 'slots'
  const slots = parseSlots(caster[field] ?? '')
  const slot = slots?.find(entry => entry.level === wanted)
  if (!slots || !slot || slot.left < 1) throw new Invalid('ไม่มีช่องเวท' + (field === 'pactSlots' ? ' Pact ' : '') + 'ระดับ ' + wanted + ' เหลือ')
  caster[field] = formatSlots(slots.map(entry => entry === slot ? { ...entry, left: entry.left - 1 } : entry))
}
/** A sheet's SRD spells: catalog ids only, at most 150, each once. */
export function parseSpellbook(value: unknown): KnownSpell[] {
  if (!Array.isArray(value) || value.length > 150) throw new Invalid('เวทบนชีตได้สูงสุด 150 บท')
  const seen = new Set<string>()
  return value.map(entry => {
    const item = record(entry)
    const spell = serverSpell(item.id)
    if (!spell) throw new Invalid('ไม่พบเวทนี้ในคลัง SRD')
    if (seen.has(spell.id)) throw new Invalid(spell.name + ' อยู่ในชีตแล้ว')
    seen.add(spell.id)
    return { id: spell.id, ...(item.always === true ? { always: true } : item.prepared === true ? { prepared: true } : {}) }
  })
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
function applyDamage(scene: Scene, actor: Actor, amount: number, kind: DamageKind, critical = false, room?: Room) {
  const before = actor.hp + actor.tempHp
  // Resistance (Rage: Bludgeoning, Piercing, Slashing) halves the damage, rounded down.
  harm(actor, resists(actor, kind) ? Math.floor(amount / 2) : amount, critical)
  const lost = before - actor.hp - actor.tempHp
  if (lost > 0 && room) {
    // Concentration: a CON save after taking damage, or lost outright at 0 HP.
    const focus = actor.effects?.find(effect => effect.condition === 'Concentration')
    if (focus && actor.hp === 0) breakConcentration(room, actor, 'HP เหลือ 0')
    else if (focus) focus.pending = { ability: 'CON', dc: Math.max(focus.pending?.reason === 'concentration' ? focus.pending.dc : 0, concentrationDc(lost)), reason: 'concentration' }
  }
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
  if (input.resources !== undefined) sheet.resources = parseResources(input.resources)
  if (input.pactSlots !== undefined && input.pactSlots !== '') sheet.pactSlots = text(input.pactSlots, 200)
  if (input.cunningUsed === true) sheet.cunningUsed = true
  if (input.xp !== undefined) sheet.xp = number(input.xp, 0, 1000000)
  if (input.subclass !== undefined && input.subclass !== '') {
    if (!Object.values(srdSubclasses).some(entry => entry.name === input.subclass)) throw new Invalid('Subclass นี้ไม่มีใน SRD 5.2.1')
    sheet.subclass = input.subclass as string
  }
  if (input.vision !== undefined) sheet.vision = parseActorVision(input.vision)
  if (input.spellbook !== undefined) sheet.spellbook = parseSpellbook(input.spellbook)
  if (input.attacksPerAction !== undefined && input.attacksPerAction !== null && input.attacksPerAction !== '') sheet.attacksPerAction = number(input.attacksPerAction, 1, 10)
  if (input.feats !== undefined) {
    if (!Array.isArray(input.feats) || input.feats.length > 20) throw new Invalid('Feat ได้สูงสุด 20 รายการ')
    const known = new Set(srdFeats.map(feat => feat.name))
    sheet.feats = input.feats.map(feat => {
      if (typeof feat !== 'string' || !known.has(feat)) throw new Invalid('Feat นี้ไม่มีใน SRD 5.2.1')
      return feat
    })
  }
  if (input.hitDiceSpent !== undefined) {
    const spent = record(input.hitDiceSpent)
    sheet.hitDiceSpent = Object.fromEntries(restDice.flatMap(key => spent[key] === undefined ? [] : [[key, number(spent[key], 0, 20)]]))
  }
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
  return (room.log ?? []).filter(entry => (me.role === 'dm' || !entry.sceneId || entry.sceneId === room.activeSceneId) &&
    (!entry.to || me.role === 'dm' || entry.to === me.id || entry.fromId === me.id))
}

export function visibleRolls(room: Room, me: Member) {
  const visible = new Set(room.scenes.filter(scene => scene.id === room.activeSceneId).flatMap(scene => scene.tokens.map(token => token.actorId)))
  return room.rolls.filter(roll => (!roll.privateTo || roll.privateTo === me.id) &&
    (me.role === 'dm' || !roll.targetId || visible.has(roll.targetId)))
}

/** End `caster`'s Concentration and every effect tied to it, on anyone. */
export function breakConcentration(room: Room, caster: Actor, reason: string) {
  const ended: string[] = []
  let secret = true
  for (const creature of room.actors) {
    const before = creature.effects ?? []
    const keep = before.filter(effect => !(tiedTo(caster.id, effect) || (creature.id === caster.id && effect.condition === 'Concentration')))
    if (keep.length === before.length) continue
    for (const effect of before) if (!keep.includes(effect)) {
      if (!effect.hidden) secret = false
      if (effect.condition !== 'Concentration') ended.push(creature.name + ' พ้นจาก ' + effectName(effect))
    }
    creature.effects = keep
  }
  if (!secret) addLog(room, { kind: 'combat', text: [caster.name + ' เสีย Concentration (' + reason + ')', ...ended].join(' · ') })
}

/** Effects a player may see: everything except DM-only ones. */
const visibleEffects = (effects: Effect[] | undefined, dm: boolean) => dm ? effects : effects?.filter(effect => !effect.hidden)

export function snapshot(room: Room, me: Member): Snapshot {
  const publicMember = ({ id, name, role }: Member): Member => ({ id, name, role })
  const dm = me.role === 'dm'
  // DM notes (0.13) never leave the server for players.
  const scenes = (dm ? room.scenes : room.scenes.filter(scene => scene.id === room.activeSceneId)).map(({ dmNotes, ...scene }) => ({
    ...scene, ...(dm && dmNotes ? { dmNotes } : {}), tokens: withTokenRoles(scene, room.actors), objects: dm ? scene.objects : scene.objects?.map(object => object.kind === 'container' ? {
      ...object, items: !object.open || object.lock?.locked ? [] : object.items,
      lock: object.lock && { ...object.lock, tried: object.lock.tried.filter(id => room.actors.some(actor => actor.id === id && actor.ownerId === me.id)) }
    } : object)
  }))
  // Vision on: a player gets the tokens and objects their own tokens can see, their explored squares,
  // walls with secret doors shown as plain wall, and no darkness or other players' memories.
  if (!dm) for (const view of scenes) {
    const vision = view.vision
    if (!vision) continue
    if (!vision.enabled) { view.vision = { enabled: false, ambient: vision.ambient }; continue }
    const seen = playerView(view, room.actors, me.id)
    const owned = (actorId: string) => room.actors.some(actor => actor.id === actorId && (actor.ownerId === me.id || actor.temp))
    view.tokens = view.tokens.filter(token => {
      const actor = room.actors.find(item => item.id === token.actorId)
      return owned(token.actorId) || (actor && tokenSeen(token, sizes[actor.size], seen.visible))
    })
    view.objects = view.objects?.filter(object => tokenSeen(object, Math.max(object.width, object.height), seen.visible))
    view.view = { visible: [...seen.visible], dimmed: [...seen.dimmed], darkvision: [...seen.darkvision], explored: vision.explored?.[me.id] ?? [] }
    view.vision = { enabled: true, ambient: vision.ambient, walls: wallsForPlayer(vision.walls), lights: vision.lights }
  }
  // Opportunity Attack cards go only to whoever controls the creature that may strike.
  if (!dm) for (const view of scenes) if (view.combat?.prompts) {
    view.combat = { ...view.combat, prompts: view.combat.prompts.filter(prompt => room.actors.some(actor => actor.id === prompt.attackerId && (actor.ownerId === me.id || actor.temp))) }
  }
  // Creatures in a fight here stay listed (the turn order) even when unseen; the board still leaves them out.
  const visible = new Set(scenes.flatMap(scene => [...scene.tokens.map(token => token.actorId), ...(scene.combat?.order.map(entry => entry.actorId) ?? [])]))
  // Invisible creatures leave the map for other players: no token, so no position. They still show in the turn order.
  if (!dm) {
    const unseen = new Set(room.actors.filter(actor => actor.ownerId !== me.id && !actor.temp && hasCondition(actor, 'Invisible')).map(actor => actor.id))
    if (unseen.size) for (const scene of scenes) scene.tokens = scene.tokens.filter(token => !unseen.has(token.actorId))
  }
  const active = scenes.find(scene => scene.id === room.activeSceneId)
  // On a vision scene, names of creatures this player cannot see become "บางสิ่ง" in rolls and the log.
  const onMap = new Set(active?.tokens.map(token => token.actorId) ?? [])
  const unseen = !dm && active?.view ? room.actors.filter(actor => actor.ownerId !== me.id && !onMap.has(actor.id) &&
    room.scenes.find(scene => scene.id === room.activeSceneId)?.tokens.some(token => token.actorId === actor.id)).map(actor => actor.name)
    .sort((a, b) => b.length - a.length) : [] // longest first: "Goblin 10" before "Goblin 1"
  const mask = (text: string) => unseen.reduce((value, name) => name ? value.split(name).join('บางสิ่ง') : value, text)
  const rolls = visibleRolls(room, me).map(roll => unseen.length ? { ...roll, label: mask(roll.label), outcome: roll.outcome && mask(roll.outcome) } : roll)
  return {
    id: room.id, name: room.name, revision: room.revision, me: publicMember(me), members: room.members.map(publicMember),
    activeSceneId: room.activeSceneId, scenes, invite: dm ? room.invite : undefined, dmInvite: dm ? room.dmInvite : undefined,
    actors: room.actors.filter(actor => dm || actor.ownerId === me.id || (actor.temp && visible.has(actor.id)))
      .map(({ dmNotes, ...actor }) => ({ ...actor, ...(dm && dmNotes ? { dmNotes } : {}), portrait: actor.portrait ?? monsterPortrait(actor.monsterReference?.id), effects: visibleEffects(actor.effects, dm) })),
    publicActors: room.actors.filter(actor => dm || visible.has(actor.id)).map(({ id, name, kind, size, portrait, monsterReference, hp, maxHp, tempHp, life, lootResult, conditions, effects }) =>
      ({ id, name, kind, size, portrait: portrait ?? monsterPortrait(monsterReference?.id), hp, maxHp, tempHp, lootResult, conditions, effects: visibleEffects(effects, dm), lootable: kind === 'monster' && life === 'dead' })),
    templates: dm ? room.templates : [],
    rolls: rolls.slice(-40),
    log: visibleLog(room, me).slice(-80).map(entry => unseen.length ? { ...entry, text: mask(entry.text) } : entry),
    settings: room.settings,
    handouts: room.handouts?.filter(item => canSee(item, me)).map(item => dm ? item : { ...item, recipients: item.recipients === 'all' ? 'all' : [me.id] }),
    presenting: room.presenting && room.handouts?.some(item => item.id === room.presenting!.handoutId && canSee(item, me)) ? room.presenting : undefined,
    combatQueue: dm && active ? rolls.filter(roll =>
      (roll.sceneId === active.id || (!roll.sceneId && active.tokens.some(token => token.actorId === roll.targetId))) &&
      (roll.applied === false || (roll.cast && !roll.cast.resolved))) : undefined
  }
}

export type BoardPiece = { token: Token; actor: Actor } | { object: SceneObject }

export function copyBoardSelection(room: Room, member: Member, command: Command) {
  const { tokenIds, objectIds } = command
  if (!Array.isArray(tokenIds) || !Array.isArray(objectIds) || tokenIds.length + objectIds.length > 100 ||
    [...tokenIds, ...objectIds].some(key => typeof key !== 'string')) throw new Invalid('เลือกได้สูงสุด 100 ชิ้น')
  const view = snapshot(room, member)
  const scene = get(view.scenes, command.sceneId)
  const pieces: BoardPiece[] = []
  for (const key of new Set(tokenIds)) {
    const token = scene.tokens.find(token => token.id === key)
    const actor = token && room.actors.find(actor => actor.id === token.actorId)
    if (!token || !actor || (actor.kind === 'pc' && token.role !== 'companion')) continue
    if (!actor.temp && actor.ownerId !== member.id && !token.copyShared) continue
    const visible = view.actors.find(entry => entry.id === actor.id)
    const summary = view.publicActors.find(entry => entry.id === actor.id)
    if (visible) pieces.push({ token, actor: visible })
    else if (summary) pieces.push({ token, actor: { ...blankSheet(summary.kind), ...summary, life: summary.lootable ? 'dead' : summary.hp ? 'active' : 'dying', ownerId: '' } })
  }
  for (const key of new Set(objectIds)) {
    const object = scene.objects?.find(object => object.id === key)
    if (object && (object.temp || object.copyShared || objectOwner(object, room.members) === member.id)) pieces.push({ object })
  }
  return { pieces, skipped: new Set(tokenIds).size + new Set(objectIds).size - pieces.length }
}

function pasteBoardSelection(target: Scene, room: Room, member: Member, command: Command, pieces: BoardPiece[]) {
  if (!pieces.length) throw new Invalid('ยังไม่มี Token หรือ Object ที่คัดลอกไว้')
  if (member.role !== 'dm' && pieces.some(piece => 'object' in piece || piece.actor.kind === 'monster')) {
    throw new Forbidden('ให้ DM วาง Object หรือ Monster Token ในห้องนี้')
  }
  const anchorX = number(command.x, -1000, 1000, .5)
  const anchorY = number(command.y, -1000, 1000, .5)
  const positions = pieces.map(piece => 'object' in piece ? piece.object : piece.token)
  const left = Math.min(...positions.map(point => point.x))
  const top = Math.min(...positions.map(point => point.y))
  const actorIds = new Map(pieces.flatMap(piece => 'actor' in piece ? [[piece.actor.id, id()] as const] : []))
  const remap = (key?: string) => key ? actorIds.get(key) : undefined
  const placements = pieces.map((piece, index) => {
    const x = number(anchorX + positions[index].x - left, -1000, 1000, .5)
    const y = number(anchorY + positions[index].y - top, -1000, 1000, .5)
    if ('object' in piece) {
      const object = structuredClone(piece.object)
      Object.assign(object, { id: id(), x, y, temp: true, ownerId: undefined, copyShared: undefined })
      if (object.kind === 'container') {
        for (const item of object.items) item.id = id()
        if (object.lock) object.lock.tried = object.lock.tried.flatMap(key => remap(key) ?? [])
      }
      return { object }
    }
    const actor = structuredClone(piece.actor)
    actor.id = actorIds.get(actor.id)!
    actor.ownerId = ''
    actor.temp = true
    delete actor.templateId
    for (const item of actor.inventory ?? []) item.id = id()
    for (const effect of actor.effects ?? []) {
      effect.id = id()
      effect.sourceId = remap(effect.sourceId)
      if (!effect.sourceId) effect.concentration = undefined
      const endsAt = remap(effect.ends?.actorId)
      if (effect.ends) effect.ends = endsAt ? { ...effect.ends, actorId: endsAt } : undefined
    }
    const token: Token = { id: id(), actorId: actor.id, x, y, role: actor.kind === 'pc' ? 'companion' : undefined }
    return { actor, token }
  })
  for (const placement of placements) {
    if (placement.object) (target.objects ??= []).push(placement.object)
    else {
      room.actors.push(placement.actor)
      target.tokens.push(placement.token)
    }
  }
  return { pasted: placements.length }
}

export function applyCommand(room: Room, member: Member, command: Command, clipboard: BoardPiece[] = []) {
  const type = String(command.type)
  const before = isUndoable(type) ? beforeCommand(room) : undefined
  delete (room as { undo?: unknown }).undo // 0.11's DM-only list; 0.12 keeps steps per member
  const output = runCommand(room, member, command, clipboard) as { healed?: string[] }
  // A healing spell's player may take back the HP it gave, not only their own creature's slot (Q5).
  if (before) afterCommand(room, member, type, before, output.healed)
  delete output.healed
  rememberSeen(room)
  return output
}

export { gridFeet }

/** Count a move against the Speed of the creature whose turn it is (moves by anyone else are not counted). */
function countMove(scene: Scene, actorId: string, feet: number) {
  const combat = scene.combat
  const current = combat?.order[combat.turn]?.actorId
  if (!combat || current !== actorId || feet <= 0) return
  const turnKey = combat.round + ':' + combat.turn
  const before = combat.moved?.actorId === actorId && combat.moved.turnKey === turnKey ? combat.moved.feet : 0
  combat.moved = { actorId, turnKey, feet: before + feet }
}

/** Players remember the squares they have seen on the active scene (vision on): the map stays visible there, dimmed. */
export function rememberSeen(room: Room) {
  const scene = room.scenes.find(item => item.id === room.activeSceneId)
  const vision = scene?.vision
  if (!scene || !vision?.enabled) return
  for (const member of room.members) {
    if (member.role === 'dm') continue
    const seen = playerView(scene, room.actors, member.id).visible
    if (!seen.size) continue
    const explored = new Set(vision.explored?.[member.id] ?? [])
    const before = explored.size
    for (const cell of seen) explored.add(cell)
    if (explored.size === before) continue
    vision.explored = { ...vision.explored, [member.id]: [...explored].slice(-40000) }
  }
}

function runCommand(room: Room, member: Member, command: Command, clipboard: BoardPiece[] = []) {
  const scene = () => get(room.scenes, command.sceneId)
  const active = () => {
    if (command.sceneId !== room.activeSceneId) throw new Conflict('ฉากเปลี่ยนแล้ว')
    return scene()
  }
  const actor = () => get(room.actors, command.actorId)
  const board = () => member.role === 'dm' ? scene() : active()
  function owns(member: Member, actor: Actor) {
    if (member.role === 'dm' || actor.ownerId === member.id ||
      (actor.temp && room.scenes.some(scene => scene.id === room.activeSceneId && scene.tokens.some(token => token.actorId === actor.id)))) return
    throw new Forbidden('คุณไม่ได้ควบคุมตัวนี้')
  }
  const object = (objects: SceneObject[]) => get(objects, command.objectId)
  const editableObject = () => {
    requireDM(member)
    return object(scene().objects ?? [])
  }
  /**
   * Note an Action (weapon attack or a spell) for a creature in this scene's fight. Off its turn the attack
   * is a Reaction (an Opportunity Attack, say). Only counts; never stops the roll.
   */
  function noteUse(target: Scene, creatureId: string, kind: 'weapon' | 'spell') {
    const combat = target.combat
    if (!combat?.order.some(entry => entry.actorId === creatureId)) return
    const use: TurnUse = { ...freshUse(), ...combat.uses?.[creatureId] }
    if (combat.order[combat.turn]?.actorId !== creatureId) use.reaction = true
    else if (kind === 'weapon') use.weaponAttacks++
    else use.spellActions++
    combat.uses = { ...combat.uses, [creatureId]: use }
  }
  /**
   * A creature moved by its own controller left an enemy's reach: if that enemy is in the fight,
   * standing, has its Reaction and can see the mover (vision scenes), its controller gets a card.
   */
  function opportunities(target: Scene, moverId: string, from: { x: number; y: number }, to: { x: number; y: number }) {
    const combat = target.combat
    const mover = room.actors.find(item => item.id === moverId)
    if (!combat || !mover || !combat.order.some(entry => entry.actorId === moverId)) return
    const controls = member.role === 'dm' ? mover.kind === 'monster' || mover.ownerId === member.id || mover.temp : mover.ownerId === member.id || mover.temp
    if (!controls || combat.uses?.[moverId]?.disengaged) return
    const side = (creature: Actor) => creature.kind === 'monster' ? 'foe' : 'party'
    const size = (creature: Actor) => sizes[creature.size]
    for (const token of target.tokens) {
      const enemy = room.actors.find(item => item.id === token.actorId)
      if (!enemy || enemy.id === moverId || side(enemy) === side(mover) || enemy.life !== 'active') continue
      if (!combat.order.some(entry => entry.actorId === enemy.id) || combat.uses?.[enemy.id]?.reaction) continue
      if (combat.prompts?.some(prompt => prompt.attackerId === enemy.id && prompt.targetId === moverId)) continue
      const reach = reachOf(enemy) / 5
      const was = gapBetween(from, size(mover), token, size(enemy)) < reach
      const now = gapBetween(to, size(mover), token, size(enemy)) < reach
      if (!was || now) continue
      if (target.vision?.enabled) {
        const lights = lightsOf(target, room.actors, id => { const item = room.actors.find(entry => entry.id === id); return item ? visionOf(item) : {} })
        const sees = seenBy(tokenCenter(token, enemy), visionOf(enemy), target.vision, lights)
        if (!tokenSeen(from, size(mover), sees.visible)) continue
      }
      combat.prompts = [...(combat.prompts ?? []), { id: id(), attackerId: enemy.id, targetId: moverId, at: Date.now() }].slice(-20)
    }
  }
  /** A player's token must stand within one square of the door's middle. */
  function doorReach(target: Scene, creature: Actor, wall: Wall) {
    if (creature.life !== 'active') throw new Invalid('ตัวละครนี้ยังโต้ตอบไม่ได้')
    const token = target.tokens.find(entry => entry.actorId === creature.id)
    if (!token) throw new Invalid('วาง Token ในฉากก่อน')
    const middle = { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 }
    const span = sizes[creature.size]
    const gapX = Math.max(0, token.x - middle.x, middle.x - (token.x + span))
    const gapY = Math.max(0, token.y - middle.y, middle.y - (token.y + span))
    if (Math.max(gapX, gapY) > 1) throw new Invalid('ให้ Token เข้าใกล้ประตูก่อน')
  }
  function nearby(target: Scene, creature: Actor, item: { x: number; y: number; width: number; height: number }) {
    owns(member, creature)
    if (creature.life !== 'active') throw new Invalid('ตัวละครนี้ยังโต้ตอบไม่ได้')
    const token = target.tokens.find(entry => entry.actorId === creature.id)
    if (!token || !isNear(token, creature, item)) throw new Invalid('ให้ Token เข้าใกล้เป้าหมายก่อน')
  }
  /** Left click lets the conditions decide; the right-click menu (or the old toggles) is the roller's own choice. */
  const decide = (odds: Odds) => {
    const { mode, note } = chooseMode(odds, chosenMode(command))
    return { advantage: mode === 'advantage', disadvantage: mode === 'disadvantage', note: note ? ' · ' + note : '' }
  }
  /**
   * "เพิ่ม Inspiration" from the roll menu: roll the Bardic Inspiration die the creature holds,
   * add it to this d20 roll, and the die is spent.
   */
  function inspired<T extends { total: number; modifier: number; formula: string }>(creature: Actor, result: T): T {
    if (command.inspiration !== true) return result
    const sides = inspirationDie(creature)
    if (!sides) throw new Invalid(creature.name + ' ไม่มี Bardic Inspiration')
    const face = die(sides)
    creature.effects = (creature.effects ?? []).filter(effect => effect.condition !== 'Inspired')
    addLog(room, { kind: 'combat', sceneId: sceneOf(room, creature.id), text: creature.name + ' ใช้ Bardic Inspiration d' + sides + ' ได้ +' + face })
    return { ...result, total: result.total + face, modifier: result.modifier + face, formula: result.formula + '+1d' + sides + '(' + face + ')' }
  }
  /**
   * One attack roll from `creature` at `victim` in `target`, with cover worked out, then the damage
   * (applied at once when the table's autoDamage rule is on). `before` runs once the attack is valid.
   */
  function attackRoll(target: Scene, creature: Actor, victim: Actor, how: {
    spell: boolean; weapon?: NonNullable<Actor['attacks']>[number]; formula: string; damageKind?: DamageKind; label: string; before?: () => void
  }) {
    if (![creature.id, victim.id].every(key => target.tokens.some(token => token.actorId === key))) {
      throw new Invalid('ผู้โจมตีและเป้าหมายต้องอยู่ในฉากเดียวกัน')
    }
    const manualCover = number(command.cover ?? 0, 0, 5)
    if (![0, 2, 5].includes(manualCover)) throw new Invalid('ค่าที่กำบังไม่ถูกต้อง')
    const tokenOf = (key: string) => target.tokens.find(token => token.actorId === key) as Token
    const cover = Math.max(manualCover, structureCover(target.objects ?? [], center(tokenOf(creature.id), creature), center(tokenOf(victim.id), victim)))
    if (cover === 99) throw new Invalid('เป้าหมายอยู่หลังที่กำบังเต็ม')
    how.before?.()
    const adjacent = isNear(tokenOf(creature.id), creature, { ...tokenOf(victim.id), width: sizes[victim.size], height: sizes[victim.size] })
    const odds = decide(attackOdds(creature, victim, adjacent))
    // Archery: +2 with weapons that fire ammunition.
    const archery = !how.spell && creature.feats?.includes('Archery') && /Ammunition/.test(how.weapon?.notes ?? '') ? 2 : 0
    const hitRoll = inspired(creature, d20((how.spell ? creature.spellAttack : how.weapon?.bonus ?? creature.attack) + archery + d20Penalty(creature), odds.advantage, odds.disadvantage))
    const critical = hitRoll.natural >= (how.spell ? 20 : criticalFrom(creature))
    const hit = critical || (hitRoll.natural !== 1 && hitRoll.total >= victim.ac + cover)
    const context = { sceneId: target.id, sourceId: creature.id, targetId: victim.id }
    saveRoll(how.label + ' · ' + creature.name + odds.note, hitRoll, { ...context, outcome: critical ? 'คริติคัล' : hit ? 'โดน' : 'พลาด' })
    if (!hit) return {}
    // Rage Damage on a Barbarian's weapon hits while Raging.
    const rage = !how.spell && isRaging(creature) && levelIn(creature, 'Barbarian') ? rageDamage(levelIn(creature, 'Barbarian')) : 0
    const receipt = saveRoll('Damage · ' + victim.name + (rage ? ' · Rage +' + rage : ''), rollDice(rage ? plusModifier(how.formula, rage) : how.formula, die, critical), { ...context, applied: false, critical, damageKind: how.damageKind })
    if (room.settings?.autoDamage) {
      // Table rule: hits apply at once; the DM can still adjust HP afterwards.
      const damageRoll = room.rolls[room.rolls.length - 1]
      const kind = damageRoll.damageKind ?? 'untyped'
      const lost = applyDamage(target, victim, Math.max(0, damageRoll.total), kind, critical, room)
      damageRoll.applied = true
      if (lost > 0) addLog(room, { kind: 'hp', text: damageText(victim, lost, kind), sceneId: target.id })
    }
    return receipt
  }
  /** Start `caster`'s Concentration on `label`; a different spell ends the old one first. */
  function concentrate(caster: Actor, label: string | undefined, hidden = false) {
    const current = caster.effects?.find(effect => effect.condition === 'Concentration')
    if (current && current.sourceLabel !== label) breakConcentration(room, caster, 'เริ่มตั้งสมาธิใหม่')
    if (!caster.effects?.some(effect => effect.condition === 'Concentration')) {
      caster.effects = [...(caster.effects ?? []), { id: id(), condition: 'Concentration', sourceId: caster.id, sourceLabel: label, hidden: hidden || undefined }]
    }
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
    passTurn(target, combat.order[combat.turn]?.actorId, combat.order[next.turn]?.actorId)
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
  /** The turn passes from `ended` to `started`: timed effects count down, repeat saves come due. */
  function passTurn(target: Scene, ended?: string, started?: string) {
    // A creature's Action, Bonus Action and Reaction come back as its own turn starts.
    if (started && target.combat) target.combat.uses = { ...target.combat.uses, [started]: freshUse() }
    // Unanswered Opportunity Attacks lapse when the turn moves on.
    if (target.combat) delete target.combat.prompts
    for (const creature of room.actors) {
      if (!creature.effects?.length) continue
      const result = advanceEffects(creature.id, creature.effects, ended, started)
      creature.effects = result.effects
      const shown = (list: Effect[]) => list.filter(effect => !effect.hidden).map(effectName)
      if (shown(result.expired).length) addLog(room, { kind: 'combat', sceneId: target.id, text: creature.name + ' พ้นจาก ' + shown(result.expired).join(', ') })
      for (const effect of result.prompted) if (!effect.hidden) addLog(room, { kind: 'combat', sceneId: target.id,
        text: creature.name + ' ต้องทอย ' + effect.pending!.ability + ' save DC ' + effect.pending!.dc + ' เพื่อพ้นจาก ' + effectName(effect) })
      for (const effect of result.expired) if (effect.condition === 'Concentration') breakConcentration(room, creature, 'หมดเวลา')
    }
  }
  switch (command.type) {
    case 'pasteBoard':
      return pasteBoardSelection(board(), room, member, command, clipboard)
    case 'boardCopySharing': {
      const target = board()
      if (typeof command.shared !== 'boolean' || (command.tokenId === undefined) === (command.objectId === undefined)) {
        throw new Invalid('เลือกสิ่งที่จะตั้งสิทธิ์คัดลอก')
      }
      if (command.tokenId !== undefined) {
        const token = get(target.tokens, command.tokenId)
        const creature = get(room.actors, token.actorId)
        const normalized = get(withTokenRoles(target, room.actors), token.id)
        if (creature.temp || creature.ownerId !== member.id || normalized.role === 'character') throw new Forbidden('คุณตั้งสิทธิ์คัดลอก Token นี้ไม่ได้')
        token.copyShared = command.shared
      } else {
        const item = object(target.objects ?? [])
        if (objectOwner(item, room.members) !== member.id) throw new Forbidden('เจ้าของ Object เท่านั้นที่ตั้งสิทธิ์คัดลอกได้')
        item.copyShared = command.shared
      }
      return {}
    }
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
      const removedActors = new Set(removed.tokens.map(token => token.actorId))
      room.actors = room.actors.filter(actor => !actor.temp || !removedActors.has(actor.id) ||
        room.scenes.some(scene => scene.tokens.some(token => token.actorId === actor.id)))
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
    case 'bringParty': {
      // Every player character that has a main token in another scene and none here comes along,
      // keeping the shape the party had (taken from the scene players saw last, if it has them).
      requireDM(member)
      const target = scene()
      const here = new Set(target.tokens.map(token => token.actorId))
      const others = room.scenes.filter(item => item.id !== target.id)
      const from = [others.find(item => item.id === room.activeSceneId), ...others].filter(Boolean) as Scene[]
      const moving: Token[] = []
      for (const source of from) for (const token of withTokenRoles(source, room.actors)) {
        const creature = room.actors.find(actor => actor.id === token.actorId)
        if (token.role === 'character' && creature?.kind === 'pc' && !here.has(creature.id) && !moving.some(item => item.actorId === creature.id)) moving.push(token)
      }
      if (!moving.length) throw new Invalid('ไม่มีตัวละครผู้เล่นที่ต้องพามา')
      const left = Math.min(...moving.map(token => token.x))
      const top = Math.min(...moving.map(token => token.y))
      const anchor = { x: command.x === undefined ? 1 : number(command.x, -1000, 1000), y: command.y === undefined ? 1 : number(command.y, -1000, 1000) }
      const taken = (x: number, y: number) => [...target.tokens].some(token => token.x === x && token.y === y)
      for (const token of moving) {
        let x = anchor.x + token.x - left
        const y = anchor.y + token.y - top
        while (taken(x, y)) x += 1
        target.tokens = [...target.tokens, { id: id(), actorId: token.actorId, x, y, role: 'character' }]
      }
      addLog(room, { kind: 'scene', sceneId: target.id, text: 'พา ' + moving.map(token => get(room.actors, token.actorId).name).join(', ') + ' มาที่ ' + target.name })
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
        if (member.role !== 'dm') sheet.vision = existing.vision
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
    case 'inventoryBonus': {
      // The DM sets or changes the +1/+2/+3 of an item already in a bag; re-equip it to refresh the sheet.
      requireDM(member)
      const creature = actor()
      const item = get(creature.inventory ?? [], command.itemId)
      if (!['weapon', 'armor', 'shield', 'ammunition'].includes(item.category ?? '')) throw new Invalid('ใส่โบนัสเวทได้กับอาวุธ เกราะ โล่ และกระสุน')
      const bonus = number(command.bonus, 0, 3)
      const plain = item.name.replace(/ \+[1-3]$/, '')
      if (bonus) Object.assign(item, { bonus, name: plain + ' +' + bonus, base: item.base ?? (item.ref?.includes(':equipment:') ? item.ref : undefined) })
      else { delete item.bonus; item.name = plain }
      return {}
    }
    case 'awardXp': {
      // The DM shares XP (after a fight, or by hand): each named character gets `amount`.
      requireDM(member)
      const ids = command.actorIds
      if (!Array.isArray(ids) || !ids.length || ids.length > 20) throw new Invalid('เลือกตัวละครที่จะได้ XP')
      const amount = number(command.amount, 0, 100000)
      const names: string[] = []
      for (const key of new Set(ids)) {
        const creature = get(room.actors, key)
        if (creature.kind !== 'pc') throw new Invalid('ให้ XP ได้เฉพาะตัวละครผู้เล่น')
        creature.xp = Math.min(1000000, (creature.xp ?? 0) + amount)
        names.push(creature.name)
      }
      if (command.fromFight === true) delete scene().xpAward
      if (amount) addLog(room, { kind: 'combat', text: names.join(', ') + ' ได้ ' + amount + ' XP' })
      return {}
    }
    case 'skipXp': {
      requireDM(member)
      delete scene().xpAward
      return {}
    }
    case 'magicalCunning': {
      const creature = actor()
      owns(member, creature)
      const result = magicalCunning(creature)
      if (!result) throw new Invalid('ใช้ Magical Cunning ไม่ได้ตอนนี้ (Warlock 2+, มีช่อง Pact ที่ใช้ไป และยังไม่ใช้ตั้งแต่ Long Rest ครั้งก่อน)')
      creature[result.field] = result.value
      creature.cunningUsed = true
      addLog(room, { kind: 'combat', text: creature.name + ' ใช้ Magical Cunning ได้ช่อง Pact คืน ' + result.regained + ' ช่อง' })
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
      if (command.templateId) requireDM(member)
      // A player's monster from the Manual is a temp token: it belongs to the scene, and anyone there can run it.
      const playerMonster = member.role !== 'dm' && command.kind === 'monster' && command.sheet !== undefined
      if (command.kind === 'monster' && !playerMonster) requireDM(member)
      if ([command.templateId, command.actorId, command.sheet].filter(value => value !== undefined).length !== 1) throw new Invalid('เลือกชีตสำหรับวาง Token')
      const template = command.templateId ? get(room.templates, command.templateId) : undefined
      const sheet = command.sheet === undefined ? undefined : parseSheet(command.sheet, command.kind === 'monster' ? 'monster' : 'pc')
      const creature = template ? { ...structuredClone(template.sheet), id: id(), ownerId: member.id, templateId: template.id,
        inventory: template.sheet.inventory?.map(item => ({ ...item, id: id() })) }
        : sheet ? { ...sheet, id: id(), ownerId: member.id } : actor()
      owns(member, creature)
      if (creature.temp) throw new Invalid('Temp Token ผูกกับฉากที่วางไว้')
      if (creature.kind === 'monster' && !playerMonster) requireDM(member)
      if (playerMonster) Object.assign(creature, { ownerId: '', temp: true as const })
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
      } else if (sheet && creature.kind === 'monster') {
        const base = creature.name
        const same = room.actors.filter(item => item.kind === 'monster' && (item.name === base || new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\d+$').test(item.name)))
        if (same.length) {
          const first = same.find(item => item.name === base)
          if (first) first.name = base + ' 1'
          const used = new Set(room.actors.map(item => item.name))
          let ordinal = same.length + 1
          while (used.has(base + ' ' + ordinal)) ordinal += 1
          creature.name = base + ' ' + ordinal
        }
      }
      if (template || sheet) room.actors.push(creature)
      target.tokens = [...tokens, token]
      if (playerMonster) addLog(room, { kind: 'scene', sceneId: target.id, name: member.name, text: member.name + ' วาง ' + creature.name })
      return {}
    }
    case 'tokenRole': {
      const target = board()
      const tokens = withTokenRoles(target, room.actors)
      const token = get(tokens, command.tokenId)
      const creature = get(room.actors, token.actorId)
      owns(member, creature)
      if (creature.kind !== 'pc' || creature.temp) throw new Invalid('เลือก Token ตัวละครที่มีเจ้าของ')
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
      countMove(target, token.actorId, moveCost(target, room.actors.find(item => item.id === token.actorId), token, { x, y }))
      opportunities(target, token.actorId, token, { x, y })
      Object.assign(get(target.tokens, token.id), { x, y })
      return {}
    }
    case 'move': {
      const target = member.role === 'dm' ? scene() : active()
      const token = get(target.tokens, command.tokenId)
      owns(member, get(room.actors, token.actorId))
      const to = { x: number(command.x, -1000, 1000, .5), y: number(command.y, -1000, 1000, .5) }
      countMove(target, token.actorId, moveCost(target, room.actors.find(item => item.id === token.actorId), token, to))
      opportunities(target, token.actorId, { x: token.x, y: token.y }, to)
      Object.assign(token, to)
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
      for (const { token, x, y } of moves) {
        countMove(target, token.actorId, moveCost(target, room.actors.find(item => item.id === token.actorId), token, { x, y }))
        opportunities(target, token.actorId, { x: token.x, y: token.y }, { x, y })
        Object.assign(token, { x, y })
      }
      return {}
    }
    case 'importObject': {
      requireDM(member)
      const target = scene()
      const definition = parseObjectDefinition(command.definition ?? { ...command, lockDc: command.locked === true ? command.lockDc ?? 15 : undefined })
      const imported = placeObject(definition, command)
      imported.ownerId = member.id
      ;(target.objects ??= []).push(imported)
      return {}
    }
    case 'placeItem': {
      // Anyone may set a catalog item on the map. It is temp: anyone nearby can pick it up.
      const target = board()
      if ((target.objects ?? []).length >= 300) throw new Invalid('ฉากนี้มี Object มากเกินไป')
      const { id: _id, ...item } = parseItem(command.item, false)
      const placed: SceneObject = { id: id(), kind: 'item', name: item.name, description: item.description, image: boardArt(item),
        item: { ...item, id: id() }, temp: true, width: 1, height: 1,
        x: number(command.x, -1000, 1000, .5), y: number(command.y, -1000, 1000, .5) }
      ;(target.objects ??= []).push(placed)
      addLog(room, { kind: 'scene', sceneId: target.id, name: member.name, text: member.name + ' วาง ' + item.name })
      return {}
    }
    case 'dropItem': {
      // Out of a bag onto the floor under the token: joins a pile already in that square, or starts one.
      const target = board()
      const creature = actor()
      owns(member, creature)
      const token = target.tokens.find(entry => entry.actorId === creature.id)
      if (!token) throw new Invalid('วาง Token ของตัวนี้ในฉากก่อน')
      const inventory = creature.inventory ?? []
      const item = get(inventory, command.itemId)
      const x = Math.floor(token.x), y = Math.floor(token.y)
      let pile = target.objects?.find(entry => entry.pile && entry.kind === 'container' && Math.floor(entry.x) === x && Math.floor(entry.y) === y)
      if (pile?.kind === 'container' && pile.items.length >= 50) throw new Invalid('กองของตรงนี้เต็มแล้ว')
      if (!pile) {
        if ((target.objects ?? []).length >= 300) throw new Invalid('ฉากนี้มี Object มากเกินไป')
        pile = { id: id(), kind: 'container', name: 'ของบนพื้น', description: '', image: boardArt(item), open: true, items: [],
          pile: true, temp: true, x, y, width: 1, height: 1 }
        ;(target.objects ??= []).push(pile)
      }
      if (pile.kind === 'container') pile.items.push(item)
      creature.inventory = inventory.filter(entry => entry.id !== item.id)
      addLog(room, { kind: 'scene', sceneId: target.id, name: member.name, text: creature.name + ' ทิ้ง ' + item.name + ' ลงพื้น' })
      return {}
    }
    case 'containerAdd': {
      // Straight into a box on the map (from the SRD catalog or typed): the DM, or anyone for a temp box.
      const target = board()
      const box = object(target.objects ?? [])
      if (!box.temp) requireDM(member)
      if (box.kind !== 'container') throw new Invalid('เป้าหมายต้องเป็นกล่อง')
      if (box.items.length >= 50) throw new Invalid('ใส่ของในกล่องได้สูงสุด 50 รายการ')
      box.items.push(parseItem(command.item, false))
      return {}
    }
    case 'visionSettings': {
      // DM: switch vision on for a scene, and set its light.
      requireDM(member)
      const target = scene()
      const vision: SceneVision = target.vision ??= { enabled: false, ambient: 'day' }
      if (command.enabled !== undefined) vision.enabled = command.enabled === true
      if (command.ambient !== undefined) {
        if (!['day', 'dusk', 'night', 'cave'].includes(String(command.ambient))) throw new Invalid('เลือกแสงของฉาก')
        vision.ambient = command.ambient as Ambient
      }
      if (command.clearExplored === true) delete vision.explored
      return {}
    }
    case 'walls': {
      // DM: add wall segments (doors are walls with a door), or remove some by id.
      requireDM(member)
      const vision: SceneVision = scene().vision ??= { enabled: false, ambient: 'day' }
      const walls = vision.walls ??= []
      const remove = new Set(Array.isArray(command.remove) ? command.remove.map(String) : [])
      vision.walls = walls.filter(wall => !remove.has(wall.id))
      // 0.14: move wall ends (an edit sends every wall it changes, so joined walls move in one step).
      const move = Array.isArray(command.move) ? command.move : []
      if (move.length > 2000) throw new Invalid('ย้ายผนังได้ครั้งละไม่เกิน 2000 เส้น')
      for (const value of move) {
        const input = record(value)
        const wall = get(vision.walls, input.id)
        const a = cellPoint(input.a)
        const b = cellPoint(input.b)
        if (a.x === b.x && a.y === b.y) throw new Invalid('ปลายผนังทั้งสองข้างอยู่จุดเดียวกัน')
        wall.a = a
        wall.b = b
      }
      const add = Array.isArray(command.add) ? command.add : []
      if (vision.walls.length + add.length > 2000) throw new Invalid('ผนังในฉากได้สูงสุด 2000 เส้น')
      for (const value of add) {
        const input = record(value)
        const a = cellPoint(input.a)
        const b = cellPoint(input.b)
        if (a.x === b.x && a.y === b.y) continue
        vision.walls.push({ id: id(), a, b, ...(input.door === true ? { door: { open: false } } : {}) })
      }
      return {}
    }
    case 'doorSettings': {
      // DM: lock or unlock, set a DC, hide as a secret door or reveal it, or turn a door back into wall.
      requireDM(member)
      const wall = get(scene().vision?.walls ?? [], command.wallId)
      if (command.door === null) { delete wall.door; return {} }
      const input = record(command.door)
      const door: Door = wall.door ?? { open: false }
      if (input.locked !== undefined) { door.locked = input.locked === true; if (door.locked) door.open = false }
      if (input.dc !== undefined) door.dc = number(input.dc, 1, 30)
      if (input.secret !== undefined) door.secret = input.secret === true
      if (input.open !== undefined) door.open = input.open === true && !door.locked
      wall.door = door
      return {}
    }
    case 'door': {
      // Open or shut a door: the DM anywhere; a player with a token within one square of it.
      const target = board()
      const wall = get(target.vision?.walls ?? [], command.wallId)
      if (!wall.door || (wall.door.secret && member.role !== 'dm')) throw new Invalid('ตรงนี้ไม่ใช่ประตู')
      if (member.role !== 'dm') {
        const creature = actor()
        owns(member, creature)
        doorReach(target, creature, wall)
      }
      if (wall.door.locked && command.open === true) throw new Invalid('ประตูล็อกอยู่')
      wall.door.open = command.open === true
      return {}
    }
    case 'pickDoor': {
      const target = board()
      const wall = get(target.vision?.walls ?? [], command.wallId)
      const door = wall.door
      if (!door?.locked || door.secret) throw new Invalid('ประตูนี้ไม่ได้ล็อก')
      const creature = actor()
      owns(member, creature)
      doorReach(target, creature, wall)
      door.tried ??= []
      if (door.tried.includes(creature.id)) throw new Conflict('ตัวละครนี้ลองสะเดาะประตูนี้ไปแล้ว')
      if (!creature.inventory?.some(item => item.tool === 'thievesTools')) throw new Invalid('ต้องมี Thieves’ Tools ใน Inventory')
      const hasTool = creature.itemProficiency?.thievesTools === true
      const hasSkill = creature.itemProficiency?.sleight === true
      const dc = door.dc ?? 15
      const result = d20(modifier(creature.abilities.DEX) + (hasTool || hasSkill ? creature.proficiency : 0), hasTool && hasSkill, false)
      const passed = result.total >= dc
      door.tried.push(creature.id)
      if (passed) { door.locked = false; door.open = true }
      return saveRoll('สะเดาะประตู · DC ' + dc, result, { sceneId: target.id, sourceId: creature.id, outcome: passed ? 'ปลดล็อกแล้ว' : 'สะเดาะไม่สำเร็จ' })
    }
    case 'lights': {
      // DM: place a light (torch on a wall, campfire), switch one, or remove it.
      requireDM(member)
      const vision: SceneVision = scene().vision ??= { enabled: false, ambient: 'day' }
      const lights = vision.lights ??= []
      if (command.add !== undefined) {
        if (lights.length >= 200) throw new Invalid('แหล่งแสงในฉากได้สูงสุด 200 จุด')
        const input = record(command.add)
        const at = cellPoint(input)
        const light: LightSource = { id: id(), x: at.x, y: at.y, bright: number(input.bright ?? 20, 0, 300), dim: number(input.dim ?? 20, 0, 300), on: input.on !== false }
        lights.push(light)
      }
      if (command.toggle !== undefined) { const light = get(lights, command.toggle); light.on = !light.on }
      if (command.remove !== undefined) vision.lights = lights.filter(light => light.id !== command.remove)
      return {}
    }
    case 'darkness': {
      // DM: paint darkness ("dark" — Darkvision still sees; "magic" — nothing does) or clear it, cell by cell.
      requireDM(member)
      const vision: SceneVision = scene().vision ??= { enabled: false, ambient: 'day' }
      if (!Array.isArray(command.cells) || command.cells.length > 5000) throw new Invalid('ระบายได้ครั้งละไม่เกิน 5000 ช่อง')
      const cells = new Set(command.cells.map(cellKey))
      const dark = new Set(vision.darkness ?? [])
      const magic = new Set(vision.magicDarkness ?? [])
      for (const cell of cells) {
        dark.delete(cell)
        magic.delete(cell)
        if (command.mode === 'dark') dark.add(cell)
        else if (command.mode === 'magic') magic.add(cell)
        else if (command.mode !== 'clear') throw new Invalid('เลือกชนิดความมืด')
      }
      if (dark.size + magic.size > 40000) throw new Invalid('ความมืดในฉากมากเกินไป')
      vision.darkness = [...dark]
      vision.magicDarkness = [...magic]
      return {}
    }
    case 'actorVision': {
      // DM sets range, Darkvision and a carried light; a player may only light or put out their own light.
      const creature = actor()
      owns(member, creature)
      if (member.role === 'dm') {
        creature.vision = parseActorVision(command.vision)
        return {}
      }
      if (!creature.vision?.light) throw new Forbidden('ให้ DM ตั้งแหล่งแสงก่อน')
      creature.vision.light.on = command.lightOn === true
      return {}
    }
    case 'containerRemove': {
      // DM (from the storeroom): take an item out of a box on any scene.
      requireDM(member)
      const box = object(scene().objects ?? [])
      if (box.kind !== 'container') throw new Invalid('เป้าหมายต้องเป็นกล่อง')
      const item = get(box.items, command.itemId)
      box.items = box.items.filter(entry => entry.id !== item.id)
      return {}
    }
    case 'lightItem': {
      // Light or put out a Torch / Lamp / Lantern / Candle in your own bag (players may, no DM needed).
      const creature = actor()
      owns(member, creature)
      const item = get(creature.inventory ?? [], command.itemId)
      if (!item.ref || !itemLights[item.ref]) throw new Invalid('ไอเทมนี้จุดเป็นแสงไม่ได้')
      if (command.lit === true) item.lit = true
      else delete item.lit
      return {}
    }
    case 'moveObject': {
      const target = object(board().objects ?? [])
      if (!target.temp) requireDM(member)
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
        if (member.role !== 'dm') nearby(target, creature, current)
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
          const art = current.image ? sceneArtByImage(current.image) : undefined
          const ref = art?.name === current.name ? art.ref ?? undefined : undefined
          item = current.item ? { ...current.item, id: id() }
            : { id: current.id, name: current.name, description: current.description, image: itemIcon(ref) ?? current.image, ref }
          target.objects = target.objects!.filter(entry => entry.id !== current.id)
        } else if (current.kind === 'container' && current.open) {
          item = get(current.items, command.itemId)
          current.items = current.items.filter(entry => entry.id !== item.id)
          if (current.pile && !current.items.length) target.objects = target.objects!.filter(entry => entry.id !== current.id)
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
      if (!room.scenes.some(scene => scene.tokens.some(entry => entry.actorId === token.actorId))) {
        room.actors = room.actors.filter(actor => actor.id !== token.actorId || !actor.temp)
      }
      return {}
    }
    case 'roll': {
      const formula = text(command.formula)
      const label = command.label ? text(command.label) : 'ทอยเต๋า'
      // A plain d20 with Advantage or Disadvantage rolls two and keeps one, like sheet rolls do.
      const d20Only = /^1?d20([+-]\d{1,3})?$/i.exec(formula.replace(/\s/g, ''))
      if (d20Only && (command.advantage === true || command.disadvantage === true)) {
        return saveRoll(label + (command.advantage === true ? ' · Advantage' : ' · Disadvantage'),
          d20(Number(d20Only[1] ?? 0), command.advantage === true, command.disadvantage === true))
      }
      return saveRoll(label, rollPool(formula))
    }
    case 'sheetRoll': {
      const creature = actor()
      owns(member, creature)
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
        const victim = get(room.actors, command.targetId)
        const spell = rollType === 'spellAttack'
        return attackRoll(target, creature, victim, {
          spell, weapon, label: weapon?.name ?? rollType,
          formula: spell ? text(command.formula) : weapon?.damage ?? creature.damage,
          damageKind: spell ? undefined : (weapon ?? creature.attacks?.find(attack => attack.bonus === creature.attack && attack.damage === creature.damage))?.damageKind,
          // Spend the slot only once the attack is valid (target in scene, not behind full cover).
          before: () => {
            if (spell) spendSlot(creature, command.slotLevel, command.pact === true)
            noteUse(target, creature.id, spell ? 'spell' : 'weapon')
          }
        })
      }
      if (rollType === 'initiative') {
        const odds = decide(rollOdds(creature, 'initiative'))
        return saveRoll('Initiative · ' + creature.name + odds.note, inspired(creature, d20(creature.initiative + d20Penalty(creature), odds.advantage, odds.disadvantage)))
      }
      if (rollType !== 'check' && rollType !== 'save') throw new Invalid('ประเภทการทอยไม่ถูกต้อง')
      if (!abilities.includes(command.ability as typeof abilities[number])) throw new Invalid('เลือกค่าความสามารถ')
      const ability = command.ability as typeof abilities[number]
      const skill = typeof command.skill === 'string' && Object.hasOwn(commonSkills, command.skill) ? command.skill as Skill : undefined
      const trained = rollType === 'save' ? creature.savingThrows?.[ability] : skill ? creature.skillChecks?.[skill] : undefined
      const score = skill && rollType === 'check' ? commonSkills[skill] : ability
      const bonus = trained ? bonusForCheck(creature, trained) : modifier(creature.abilities[score]) + (command.proficient === true ? creature.proficiency : 0)
      const checkOdds = rollOdds(creature, rollType, ability)
      const odds = decide(checkOdds)
      return saveRoll((rollType === 'check' && skill ? skill : ability) + ' ' + rollType + ' · ' + creature.name + odds.note,
        inspired(creature, d20(bonus + d20Penalty(creature), odds.advantage, odds.disadvantage)), checkOdds.autoFail ? { outcome: 'ล้มเหลวอัตโนมัติ (' + checkOdds.autoFail + ')' } : {})
    }
    case 'castSave': {
      const target = active()
      const caster = actor()
      owns(member, caster)
      const victim = get(room.actors, command.targetId)
      if (![caster.id, victim.id].every(key => target.tokens.some(token => token.actorId === key))) throw new Invalid('ผู้ร่ายและเป้าหมายต้องอยู่ในฉาก')
      noteUse(target, caster.id, 'spell')
      const ability = command.ability as typeof abilities[number]
      if (!abilities.includes(ability)) throw new Invalid('เลือกค่าความสามารถสำหรับ Save')
      const damage = command.formula ? text(command.formula) : undefined
      if (damage) parseDice(damage)
      const label = text(command.label)
      spendSlot(caster, command.slotLevel, command.pact === true)
      return saveRoll('Spell · ' + label + (command.slotLevel ? ' (ช่องระดับ ' + command.slotLevel + ')' : ''), { total: caster.spellDC, faces: [], formula: ability + ' Save DC', modifier: 0 }, {
        sceneId: target.id, sourceId: caster.id, targetId: victim.id, cast: { ability, dc: caster.spellDC, targetId: victim.id, damage, half: command.half === true }
      })
    }
    case 'spellbook': {
      const creature = actor()
      owns(member, creature)
      creature.spellbook = parseSpellbook(command.spellbook)
      return {}
    }
    case 'cast': {
      // 0.13: one cast from the sheet. Spends the slot and the Action (or Bonus Action / Reaction), starts
      // Concentration, then rolls the attack, asks for saves, or heals; the dice scale with the slot or level.
      const caster = actor()
      owns(member, caster)
      const spell = serverSpell(command.spellId)
      if (!spell) throw new Invalid('ไม่พบเวทนี้ในคลัง SRD')
      if (member.role !== 'dm' && !caster.spellbook?.some(entry => entry.id === spell.id)) throw new Invalid('เวทนี้ไม่อยู่ในชีต')
      const fighting = room.scenes.some(item => item.combat?.order.some(entry => entry.actorId === caster.id))
      const ritual = command.ritual === true
      if (ritual && !spell.ritual) throw new Invalid(spell.name + ' ร่ายแบบ Ritual ไม่ได้')
      if (ritual && fighting) throw new Invalid('ร่ายแบบ Ritual ระหว่างต่อสู้ไม่ได้')
      const pact = command.pact === true
      const slotLevel = spell.level === 0 || ritual ? spell.level : number(command.slotLevel ?? spell.level, 1, 9)
      if (slotLevel < spell.level) throw new Invalid(spell.name + ' ต้องใช้ช่องเวทระดับ ' + spell.level + ' ขึ้นไป')
      const where = command.sceneId ? active() : undefined
      const placed = (creature: Actor) => Boolean(where?.tokens.some(token => token.actorId === creature.id))
      // Targets: picked ones, or everyone in the drawn area (dead ones are left out).
      let area: Area | undefined
      let targets: Actor[]
      if (command.area !== undefined) {
        if (!where || !spell.area) throw new Invalid('เวทนี้ไม่ใช่เวทพื้นที่')
        const input = record(command.area)
        const point = (value: unknown) => { const item = record(value); return { x: number(item.x, -1000, 1000, .5), y: number(item.y, -1000, 1000, .5) } }
        if (typeof input.kind !== 'string' || !Object.hasOwn(areaLabels, input.kind)) throw new Invalid('เลือกรูปทรงพื้นที่')
        area = { kind: input.kind as Area['kind'], from: point(input.from), to: point(input.to) }
        if (!validArea(area) || Math.hypot(area.from.x - area.to.x, area.from.y - area.to.y) > 200) throw new Invalid('ขนาดพื้นที่ไม่ถูกต้อง')
        const outline = areaOutline(area)
        targets = where.tokens.flatMap(token => {
          const creature = get(room.actors, token.actorId)
          return creature.life !== 'dead' && areaContains(outline, center(token, creature)) ? [creature] : []
        })
      } else {
        const ids = Array.isArray(command.targetIds) ? command.targetIds : []
        if (ids.length > 12) throw new Invalid('เลือกเป้าหมายได้สูงสุด 12 ตัว')
        targets = [...new Set(ids)].map(key => get(room.actors, key))
      }
      if (spell.healing && !targets.length && !area) targets = [caster]
      const needsTarget = Boolean(spell.attack || spell.save)
      if (needsTarget && !area && !targets.length) throw new Invalid('เลือกเป้าหมายของ ' + spell.name)
      if ((needsTarget || spell.damage) && targets.length) {
        if (!where || !placed(caster)) throw new Invalid('วาง Token ของผู้ร่ายในฉากก่อน')
        for (const creature of targets) if (!placed(creature)) throw new Invalid(creature.name + ' ไม่อยู่ในฉากนี้')
      }
      // Check the slot before anything happens, then spend it.
      if (slotLevel > 0 && !ritual) spendSlot(caster, slotLevel, pact)
      const label = spell.name + (ritual ? ' (Ritual)' : slotLevel > spell.level ? ' (ช่องระดับ ' + slotLevel + ')' : '')
      const fight = where?.combat?.order.some(entry => entry.actorId === caster.id) ? where : room.scenes.find(item => item.combat?.order.some(entry => entry.actorId === caster.id))
      if (fight?.combat && !ritual) {
        if (/Bonus Action/i.test(spell.castingTime)) {
          const use: TurnUse = { ...freshUse(), ...fight.combat.uses?.[caster.id] }
          use.bonus++
          fight.combat.uses = { ...fight.combat.uses, [caster.id]: use }
        } else if (/Reaction/i.test(spell.castingTime)) {
          fight.combat.uses = { ...fight.combat.uses, [caster.id]: { ...freshUse(), ...fight.combat.uses?.[caster.id], reaction: true } }
        } else if (/Action/i.test(spell.castingTime)) noteUse(fight, caster.id, 'spell')
      }
      if (spell.concentration) concentrate(caster, spell.name)
      const level = characterLevel(caster)
      const damage = scaledDice(spell, spell.damage, slotLevel, level)
      const damageKind = spell.damageType && Object.hasOwn(damageKinds, spell.damageType) ? spell.damageType as DamageKind : undefined
      const sceneId = where?.id ?? sceneOf(room, caster.id)
      addLog(room, { kind: 'combat', sceneId, text: caster.name + ' ร่าย ' + label + (ritual ? ' · ใช้เวลาเพิ่ม 10 นาที' : '') })
      if (area && where) where.areaEffect = { area, kind: damageKind ?? 'force', at: Date.now() }
      if (spell.attack && where) {
        let receipt = {}
        for (const victim of targets) receipt = attackRoll(where, caster, victim, { spell: true, formula: damage ?? '0', damageKind, label: spell.name })
        return receipt
      }
      if (spell.save && where) {
        let receipt = {}
        for (const victim of targets) {
          receipt = saveRoll('Spell · ' + label, { total: caster.spellDC, faces: [], formula: spell.save + ' Save DC', modifier: 0 }, {
            sceneId: where.id, sourceId: caster.id, targetId: victim.id,
            cast: { ability: spell.save, dc: caster.spellDC, targetId: victim.id, damage, half: spell.half === true, spell: spell.name,
              ...(spell.condition ? { condition: spell.condition } : {}), ...(spell.concentration ? { concentration: true } : {}), ...(damageKind ? { damageKind } : {}) }
          })
        }
        if (!targets.length) addLog(room, { kind: 'combat', sceneId, text: 'ไม่มีใครอยู่ในพื้นที่ของ ' + spell.name })
        return receipt
      }
      if (spell.healing) {
        // Healing lands at once (Q5); the caster's player may undo it.
        const dice = scaledDice(spell, spell.healing, slotLevel, level) as string
        const bonus = spell.healingAddsModifier ? Math.max(0, caster.spellAttack - caster.proficiency) : 0
        let receipt = {}
        for (const creature of targets) {
          const result = rollDice(dice)
          const amount = Math.max(0, result.total + bonus)
          const before = creature.hp
          heal(creature, amount)
          addLog(room, { kind: 'hp', sceneId, text: creature.name + ' ฟื้น ' + (creature.hp - before) + ' HP จาก ' + spell.name })
          receipt = saveRoll('Healing · ' + spell.name + ' · ' + creature.name, { ...result, modifier: result.modifier + bonus, total: amount, formula: dice + (bonus ? '+' + bonus : '') }, { sceneId, sourceId: caster.id, targetId: creature.id })
        }
        return { ...receipt, healed: targets.map(creature => creature.id) }
      }
      if (damage && targets.length) {
        // Damage without an attack or save (Magic Missile): rolled for the DM to apply.
        return saveRoll('Damage · ' + spell.name + ' · ' + targets[0].name, rollDice(damage), { sceneId, sourceId: caster.id, targetId: targets[0].id, applied: false, damageKind })
      }
      return {}
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
      const saveOdds = rollOdds(victim, 'save', roll.cast.ability)
      const decided = chooseMode(saveOdds, chosenMode(command))
      const result = inspired(victim, d20(bonus + d20Penalty(victim), decided.mode === 'advantage', decided.mode === 'disadvantage'))
      const passed = !saveOdds.autoFail && result.total >= roll.cast.dc
      roll.cast.resolved = true
      const context = { sceneId: target.id, sourceId: roll.sourceId, targetId: victim.id }
      // A failed save against a spell that gives a condition offers a button to apply it (never automatic, Q6).
      const offer = !passed && roll.cast.condition && roll.sourceId
        ? { condition: roll.cast.condition, targetId: victim.id, sourceId: roll.sourceId, label: roll.cast.spell ?? roll.cast.condition, ...(roll.cast.concentration ? { concentration: true } : {}) }
        : undefined
      const saveReceipt = saveRoll('Spell Save · ' + victim.name + (decided.note ? ' · ' + decided.note : ''), result,
        { ...context, outcome: saveOdds.autoFail ? 'พลาดอัตโนมัติ (' + saveOdds.autoFail + ')' : passed ? 'ผ่าน' : 'พลาด', ...(offer ? { offer } : {}) })
      if (roll.cast.damage && (!passed || roll.cast.half)) {
        const damage = rollDice(roll.cast.damage)
        return saveRoll('Spell Damage · ' + victim.name, {
          ...damage, total: passed ? Math.floor(damage.total / 2) : damage.total
        }, { ...context, applied: false, damageKind: roll.cast.damageKind })
      }
      return saveReceipt
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
      if (member.role !== 'dm' && ((!currentActor.temp && currentActor.ownerId !== member.id) || command.actorId !== currentActor.id)) throw new Forbidden('ยังไม่ถึงเทิร์นของคุณ')
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
    case 'undo': {
      // Anyone takes back their own newest step (Ctrl+Z); a step someone else built on is dropped, not overwritten.
      const outcome = undoLast(room, member)
      if (outcome.result === 'empty') throw new Invalid('ไม่มีอะไรให้ย้อนแล้ว')
      if (outcome.result === 'blocked') return { notice: 'ย้อน' + outcome.label + 'ไม่ได้ เพราะมีคนแก้ต่อแล้ว · กด Ctrl+Z อีกครั้งเพื่อย้อนขั้นก่อนหน้า' }
      return { notice: 'ย้อน' + outcome.label + 'แล้ว' }
    }
    case 'handout': {
      // DM: write a handout (title, text, a Canva view link) for everyone or some players; edit or remove it.
      requireDM(member)
      const list = room.handouts ??= []
      const existing = command.handoutId === undefined ? undefined : get(list, command.handoutId)
      if (command.remove === true) {
        if (!existing) throw new Invalid('ไม่พบเอกสาร')
        room.handouts = list.filter(item => item !== existing)
        if (room.presenting?.handoutId === existing.id) delete room.presenting
        // The picture file stays on disk, so undo can bring the handout back whole.
        return {}
      }
      if (!existing && list.length >= handoutLimits.count) throw new Invalid('เอกสารในห้องได้สูงสุด ' + handoutLimits.count + ' ชิ้น')
      const handout: Handout = existing ?? { id: id(), title: '', recipients: 'all', at: Date.now() }
      if (command.title !== undefined || !existing) handout.title = text(command.title, handoutLimits.title)
      if (command.text !== undefined) {
        if (command.text === '') delete handout.text
        else handout.text = text(command.text, handoutLimits.text)
      }
      if (command.canva !== undefined) {
        if (command.canva === '') delete handout.canva
        else {
          const embed = canvaEmbed(String(command.canva))
          if ('error' in embed) throw new Invalid(embed.error)
          handout.canva = embed.url
        }
      }
      if (command.recipients !== undefined) {
        if (command.recipients === 'all') handout.recipients = 'all'
        else {
          if (!Array.isArray(command.recipients) || !command.recipients.length) throw new Invalid('เลือกผู้รับอย่างน้อยหนึ่งคน')
          const players = new Set(room.members.filter(item => item.role === 'player').map(item => item.id))
          const ids = [...new Set(command.recipients.map(String))]
          if (ids.some(item => !players.has(item))) throw new Invalid('ผู้รับต้องเป็นผู้เล่นในห้อง')
          handout.recipients = ids
        }
      }
      if (!existing) list.push(handout)
      return { handoutId: handout.id }
    }
    case 'present': {
      // DM: open a handout full screen for everyone who has it, or stop presenting.
      requireDM(member)
      if (command.handoutId === null) { delete room.presenting; return {} }
      const handout = get(room.handouts ?? [], command.handoutId)
      room.presenting = { handoutId: handout.id, at: Date.now() }
      return {}
    }
    case 'dmNotes': {
      // Secret notes on a scene or a sheet: the DM writes them, players never get them.
      requireDM(member)
      const notes = command.notes === '' ? undefined : text(command.notes, 5000)
      const holder: { dmNotes?: string } = command.actorId ? actor() : scene()
      if (notes) holder.dmNotes = notes
      else delete holder.dmNotes
      return {}
    }
    case 'redo': {
      // Ctrl+Y / Ctrl+Shift+Z: put back your own last undo, unless someone has changed it since.
      const outcome = redoLast(room, member)
      if (outcome.result === 'empty') throw new Invalid('ไม่มีอะไรให้ทำซ้ำ')
      if (outcome.result === 'blocked') return { notice: 'ทำซ้ำ' + outcome.label + 'ไม่ได้ เพราะมีคนแก้ต่อแล้ว' }
      return { notice: 'ทำซ้ำ' + outcome.label + 'แล้ว' }
    }
    case 'opportunity': {
      // The controller of the creature that may strike answers: attack (main attack, uses the Reaction) or pass.
      const target = active()
      const combat = target.combat
      const prompt = combat?.prompts?.find(item => item.id === command.promptId)
      if (!combat || !prompt) throw new Conflict('Opportunity Attack นี้หมดเวลาแล้ว')
      owns(member, get(room.actors, prompt.attackerId))
      combat.prompts = combat.prompts!.filter(item => item.id !== prompt.id)
      if (command.attack !== true) return {}
      if (!target.tokens.some(token => token.actorId === prompt.targetId)) throw new Invalid('เป้าหมายออกจากฉากแล้ว')
      return runCommand(room, member, { type: 'sheetRoll', rollType: 'attack', sceneId: target.id, actorId: prompt.attackerId, targetId: prompt.targetId })
    }
    case 'terrain': {
      // DM paints Difficult Terrain (any scene, vision or not), or clears it.
      requireDM(member)
      const target = scene()
      if (!Array.isArray(command.cells) || command.cells.length > 5000) throw new Invalid('ระบายได้ครั้งละไม่เกิน 5000 ช่อง')
      const cells = new Set(target.terrain ?? [])
      for (const cell of command.cells.map(cellKey)) {
        if (command.mode === 'difficult') cells.add(cell)
        else if (command.mode === 'clear') cells.delete(cell)
        else throw new Invalid('เลือกชนิดพื้นที่')
      }
      if (cells.size > 40000) throw new Invalid('Difficult Terrain ในฉากมากเกินไป')
      target.terrain = [...cells]
      return {}
    }
    case 'standUp': {
      // Prone → standing costs half the creature's Speed this turn (counted, not enforced).
      const target = board()
      const creature = actor()
      owns(member, creature)
      if (!hasCondition(creature, 'Prone')) throw new Invalid('ตัวนี้ไม่ได้ล้มอยู่')
      creature.conditions = formatConditions(parseConditions(creature.conditions).filter(item => conditionBase(item.name).base !== 'Prone'))
      if (creature.effects) creature.effects = creature.effects.filter(effect => effect.condition !== 'Prone')
      countMove(target, creature.id, Math.floor(speedNow(creature, room.settings?.encumbrance !== false) / 2))
      return {}
    }
    case 'turnAction': {
      // Owner or DM marks Action / Bonus Action / Reaction / Disengage by hand, or uses Action Surge. Counting only.
      const target = board()
      const creature = actor()
      owns(member, creature)
      const combat = target.combat
      if (!combat?.order.some(entry => entry.actorId === creature.id)) throw new Invalid('ตัวนี้ไม่ได้อยู่ในการต่อสู้')
      const use: TurnUse = { ...freshUse(), ...combat.uses?.[creature.id] }
      const count = (value: unknown) => number(value, 0, 9)
      if (command.kind === 'action') use.manualActions = count(command.value)
      else if (command.kind === 'bonus') use.bonus = count(command.value)
      else if (command.kind === 'reaction') use.reaction = command.value === true
      else if (command.kind === 'disengage') use.disengaged = command.value === true
      else if (command.kind === 'surge') {
        const surge = creature.resources?.find(resource => resource.name === 'Action Surge')
        if (!surge || surge.used >= surge.max) throw new Invalid('ไม่มี Action Surge เหลือ')
        surge.used++
        use.extraActions++
      } else throw new Invalid('เลือกสิ่งที่จะใช้')
      combat.uses = { ...combat.uses, [creature.id]: use }
      return {}
    }
    case 'settings': {
      requireDM(member)
      const input = record(command.settings)
      // Only the rules named in this command change.
      const next = { ...room.settings }
      if (input.autoDamage !== undefined) next.autoDamage = input.autoDamage === true
      if (input.encumbrance !== undefined) next.encumbrance = input.encumbrance === true
      if (input.advancement !== undefined) {
        if (input.advancement !== 'milestone' && input.advancement !== 'xp') throw new Invalid('เลือกวิธีเลื่อนระดับ')
        next.advancement = input.advancement
      }
      room.settings = next
      return {}
    }
    case 'spendHitDie': {
      const creature = actor()
      owns(member, creature)
      if (room.scenes.some(scene => scene.combat?.order.some(entry => entry.actorId === creature.id))) throw new Invalid('พักระหว่างการต่อสู้ไม่ได้')
      if (creature.hp < 1 || creature.life !== 'active') throw new Invalid('ต้องมี HP อย่างน้อย 1 จึงพักได้')
      const size = command.die as RestDie
      const pool = hitDiceLeft(creature)[size]
      if (!restDice.includes(size) || !pool?.left) throw new Invalid('ไม่มี Hit Die ' + String(command.die) + ' เหลือ')
      const face = die(Number(size.slice(1)))
      const healed = hitDieHealing(face, creature.abilities.CON)
      const before = creature.hp
      heal(creature, healed)
      creature.hitDiceSpent = { ...creature.hitDiceSpent, [size]: (creature.hitDiceSpent?.[size] ?? 0) + 1 }
      addLog(room, { kind: 'hp', text: creature.name + ' ใช้ Hit Die ' + size + ' ฟื้น ' + (creature.hp - before) + ' HP' })
      return saveRoll('Hit Die · ' + creature.name, { formula: '1' + size + '+CON', faces: [face], modifier: healed - face, total: healed })
    }
    case 'rest': {
      const kind = command.kind === 'long' ? 'long' : 'short'
      const ids = Array.isArray(command.actorIds) ? command.actorIds : [command.actorId]
      if (!ids.length || ids.length > 12) throw new Invalid('เลือกตัวละครที่จะพัก')
      const resting = ids.map(key => get(room.actors, key))
      resting.forEach(creature => owns(member, creature))
      if (resting.some(creature => room.scenes.some(scene => scene.combat?.order.some(entry => entry.actorId === creature.id)))) throw new Invalid('พักระหว่างการต่อสู้ไม่ได้')
      const skipped = resting.filter(creature => kind === 'long' && (creature.hp < 1 || creature.life !== 'active'))
      for (const creature of resting) if (!skipped.includes(creature)) Object.assign(creature, restedSheet(creature, kind))
      const rested = resting.filter(creature => !skipped.includes(creature))
      if (rested.length) addLog(room, { kind: 'hp', text: rested.map(creature => creature.name).join(', ') + (kind === 'long' ? ' พักยาว (Long Rest)' : ' พักสั้น (Short Rest)') })
      return { skipped: skipped.map(creature => creature.name) }
    }
    case 'useResource': {
      const creature = actor()
      owns(member, creature)
      const resource = creature.resources?.[number(command.index, 0, 11)]
      if (!resource) throw new Invalid('ทรัพยากรนี้เปลี่ยนแล้ว')
      const used = number(command.used, 0, resource.max)
      if (command.log === true && used > resource.used) {
        addLog(room, { kind: 'combat', sceneId: sceneOf(room, creature.id), text: creature.name + ' ใช้ ' + resource.name + (used - resource.used > 1 ? ' ' + (used - resource.used) : '') + ' · เหลือ ' + (resource.max - used) + '/' + resource.max })
      }
      resource.used = used
      return {}
    }
    case 'classFeature': {
      // Rage, Second Wind and Bardic Inspiration (0.13): spend the use and the Bonus Action, then do what the class table says.
      const creature = actor()
      owns(member, creature)
      const feature = command.feature as keyof typeof featureResource
      if (!Object.hasOwn(featureResource, feature)) throw new Invalid('เลือกความสามารถของคลาส')
      const resource = creature.resources?.find(entry => entry.name === featureResource[feature])
      if (!resource || resource.used >= resource.max) throw new Invalid('ไม่มี ' + featureResource[feature] + ' เหลือ')
      const friend = feature === 'bardicInspiration' ? get(room.actors, command.targetId) : undefined
      if (friend && friend.id === creature.id) throw new Invalid('Bardic Inspiration ให้คนอื่นเท่านั้น')
      resource.used++
      const fight = room.scenes.find(item => item.combat?.order.some(entry => entry.actorId === creature.id))
      if (fight?.combat) {
        const use: TurnUse = { ...freshUse(), ...fight.combat.uses?.[creature.id] }
        use.bonus++
        fight.combat.uses = { ...fight.combat.uses, [creature.id]: use }
      }
      const sceneId = sceneOf(room, creature.id)
      if (feature === 'rage') {
        // Raging can't keep Concentration; it lasts 10 rounds here (the DM ends it early if the rage stops).
        if (creature.effects?.some(effect => effect.condition === 'Concentration')) breakConcentration(room, creature, 'เข้าสู่ Rage')
        creature.effects = [...(creature.effects ?? []).filter(effect => effect.condition !== 'Raging'),
          { id: id(), condition: 'Raging', sourceId: creature.id, sourceLabel: 'Rage +' + rageDamage(levelIn(creature, 'Barbarian')), ends: { at: 'end', actorId: creature.id, turns: 10 } }]
        addLog(room, { kind: 'combat', sceneId, text: creature.name + ' เข้าสู่ Rage · ต้านทาน Bludgeoning, Piercing, Slashing · ความเสียหาย +' + rageDamage(levelIn(creature, 'Barbarian')) })
        return {}
      }
      if (feature === 'secondWind') {
        const level = levelIn(creature, 'Fighter')
        const face = die(10)
        const before = creature.hp
        heal(creature, face + level)
        addLog(room, { kind: 'hp', sceneId, text: creature.name + ' ใช้ Second Wind ฟื้น ' + (creature.hp - before) + ' HP' })
        return saveRoll('Second Wind · ' + creature.name, { formula: '1d10+' + level, faces: [face], modifier: level, total: face + level })
      }
      const sides = bardicDie(levelIn(creature, 'Bard'))
      const target = friend as Actor
      target.effects = [...(target.effects ?? []).filter(effect => effect.condition !== 'Inspired'),
        { id: id(), condition: 'Inspired', sourceId: creature.id, sourceLabel: 'Bardic Inspiration d' + sides }]
      addLog(room, { kind: 'combat', sceneId, text: creature.name + ' ให้ Bardic Inspiration d' + sides + ' แก่ ' + target.name })
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
      if (creature.effects?.some(effect => effect.condition === 'Concentration') && incapacitating.some(name => creature.conditions.split(/,\s*/).some(part => part.split(':')[0] === name))) {
        breakConcentration(room, creature, 'ทำอะไรไม่ได้')
      }
      return {}
    }
    case 'addEffect': {
      // The DM, or a player applying it with a creature they control (casting Hold Person, say).
      const source = command.sourceId ? get(room.actors, command.sourceId) : undefined
      const targets = (Array.isArray(command.targetIds) ? command.targetIds : []).map(key => get(room.actors, key))
      if (!targets.length || targets.length > 12) throw new Invalid('เลือกเป้าหมาย 1–12 ตัว')
      if (member.role !== 'dm') {
        if (command.hidden === true) throw new Forbidden('Condition ลับใช้ได้เฉพาะ DM')
        if (source) owns(member, source)
        else targets.forEach(creature => owns(member, creature))
      }
      const condition = text(command.condition, 40)
      if (condition.includes(',') || condition.includes(':')) throw new Invalid('ชื่อ Condition ไม่ถูกต้อง')
      const ends = command.ends === undefined ? undefined : (() => {
        const value = record(command.ends)
        const actorId = get(room.actors, value.actorId).id
        return { at: value.at === 'start' ? 'start' as const : 'end' as const, actorId, turns: number(value.turns ?? 1, 1, 100) }
      })()
      const save = command.save === undefined ? undefined : (() => {
        const value = record(command.save)
        return { ability: readAbility(value.ability), dc: number(value.dc, 1, 40), at: value.at === 'start' ? 'start' as const : 'end' as const }
      })()
      const concentration = command.concentration === true && Boolean(source)
      const label = command.sourceLabel ? text(command.sourceLabel, 60) : undefined
      // One Concentration at a time: a new spell ends the old one.
      if (concentration && source) concentrate(source, label, command.hidden === true)
      for (const creature of targets) {
        if ((creature.effects?.length ?? 0) >= 30) throw new Invalid(creature.name + ' มี Condition มากเกินไป')
        const effect: Effect = {
          id: id(), condition, level: condition === 'Exhaustion' ? number(command.level ?? 1, 1, 6) : undefined,
          sourceId: source?.id, sourceLabel: label, concentration: concentration || undefined, ends, save, hidden: command.hidden === true || undefined
        }
        creature.effects = [...(creature.effects ?? []), effect]
        if (incapacitating.includes(condition) && creature.effects.some(entry => entry.condition === 'Concentration')) breakConcentration(room, creature, 'ทำอะไรไม่ได้')
      }
      if (command.hidden !== true) addLog(room, { kind: 'combat', text: targets.map(creature => creature.name).join(', ') + ' ติด ' + condition + (label ? ' จาก ' + label : '') })
      return {}
    }
    case 'removeEffect': {
      const creature = actor()
      const effect = get(creature.effects ?? [], command.effectId)
      const source = effect.sourceId ? room.actors.find(item => item.id === effect.sourceId) : undefined
      if (member.role !== 'dm' && effect.hidden) throw new Forbidden('Condition ลับใช้ได้เฉพาะ DM')
      if (source?.ownerId !== member.id) owns(member, creature)
      if (effect.condition === 'Concentration') { breakConcentration(room, creature, 'เลิกตั้งสมาธิ'); return {} }
      creature.effects = (creature.effects ?? []).filter(entry => entry.id !== effect.id)
      if (!effect.hidden) addLog(room, { kind: 'combat', text: creature.name + ' พ้นจาก ' + effectName(effect) })
      return {}
    }
    case 'effectSave': {
      const creature = actor()
      const effect = get(creature.effects ?? [], command.effectId)
      if (member.role !== 'dm' && effect.hidden) throw new Forbidden('Condition ลับใช้ได้เฉพาะ DM')
      if (!effect.pending) throw new Conflict('ไม่มีการทอยเซฟที่รออยู่')
      if (command.skip === true) {
        requireDM(member)
        effect.pending = undefined
        return {}
      }
      owns(member, creature)
      const { ability, dc, reason } = effect.pending
      const trained = creature.savingThrows?.[ability]
      const bonus = (trained ? bonusForCheck(creature, trained) : modifier(creature.abilities[ability])) + d20Penalty(creature)
      const saveOdds = rollOdds(creature, 'save', ability)
      const decided = chooseMode(saveOdds, chosenMode(command))
      const result = inspired(creature, d20(bonus, decided.mode === 'advantage', decided.mode === 'disadvantage'))
      const passed = !saveOdds.autoFail && result.total >= dc
      effect.pending = undefined
      const label = reason === 'concentration' ? 'Concentration' : effectName(effect)
      const receipt = saveRoll(ability + ' save · ' + creature.name + ' · ' + label + (decided.note ? ' · ' + decided.note : ''), result, {
        outcome: (saveOdds.autoFail ? 'พลาดอัตโนมัติ (' + saveOdds.autoFail + ')' : passed ? 'ผ่าน' : 'พลาด') + ' DC ' + dc, ...(effect.hidden ? { privateTo: member.id } : {}) })
      if (reason === 'concentration' && !passed) breakConcentration(room, creature, 'พลาด CON save')
      if (reason === 'repeat' && passed) {
        creature.effects = (creature.effects ?? []).filter(entry => entry.id !== effect.id)
        if (!effect.hidden) addLog(room, { kind: 'combat', text: creature.name + ' พ้นจาก ' + effectName(effect) + ' (ผ่าน ' + ability + ' save)' })
      }
      return receipt
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
        // Rooms that level by XP: the defeated monsters' XP waits for the DM to share out among the characters who fought.
        if (room.settings?.advancement === 'xp') {
          const fought = combat.order.map(entry => room.actors.find(item => item.id === entry.actorId)).filter((item): item is Actor => Boolean(item))
          const total = fought.filter(item => item.kind === 'monster' && item.life === 'dead').reduce((sum, item) => sum + monsterXp(item), 0)
          const actorIds = fought.filter(item => item.kind === 'pc').map(item => item.id)
          if (total > 0 && actorIds.length) target.xpAward = { total, actorIds, at: Date.now() }
        }
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
        const lost = applyDamage(target, creature, number(command.amount, 0, 9999), kind, roll.critical, room)
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
      const hits = effects.map(entry => ({ actor: entry.actor, lost: applyDamage(target, entry.actor, Math.max(0, Math.floor(result.total * entry.multiplier)), kind, false, room) }))
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
        const lost = applyDamage(where, creature, amount, kind, false, room)
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
      // A whisper goes to one member; the DM sees every whisper (marked as one).
      const to = command.to === undefined || command.to === '' ? undefined : get(room.members, command.to)
      if (to && to.id === member.id) throw new Invalid('กระซิบถึงตัวเองไม่ได้')
      addLog(room, { kind: 'chat', text: message, name: member.name, ...(to ? { to: to.id, fromId: member.id } : {}) })
      return {}
    }
    case 'slots': {
      const creature = actor()
      owns(member, creature)
      const value = command.slots === '' ? '' : text(command.slots, 2000)
      if (command.pact === true) creature.pactSlots = value
      else creature.slots = value
      return {}
    }
    default:
      throw new Invalid('คำสั่งไม่ถูกต้อง')
  }
}
