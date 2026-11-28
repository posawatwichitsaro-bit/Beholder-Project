import type { Member, Room, Scene, UndoStep } from '../shared/model.ts'

/**
 * Undo for everyone (0.12): each member takes back only what their own
 * commands changed, newest first, 20 steps each.
 *
 * A room is split into small units (an actor, a token, an object, a wall, a
 * light, a scene's settings, a fight, the room settings…). Before a command
 * runs, each unit is fingerprinted; afterwards the units that changed are kept
 * as a step with their old value and the fingerprint they were left at.
 * Undo puts the old values back, unless someone else changed one of those
 * units since: then the step is dropped and the member is told (never
 * overwriting another person's work).
 *
 * Dice: a player's own rolls stand (no re-rolling by undo), so for a step that
 * rolled dice a player gets back only changes to their own creatures (a spent
 * slot, an Action), not the damage the roll did. The DM may undo their own
 * rolls: the roll stays in the log marked undone, and the HP it took comes back.
 *
 * Redo (0.13, Ctrl+Y / Ctrl+Shift+Z) puts back what this member last undid,
 * under the same rule; doing anything else clears it.
 */
type UndoUnit = UndoStep['units'][number]
export const undoDepth = 20

/** Commands that are never undone: undo itself, chat, and moving between scenes is a reset. */
const skip = new Set(['undo', 'redo', 'chat'])
export const undoLabels: Record<string, string> = {
  move: 'การเดิน', moveTokens: 'การเดิน', stepCharacter: 'การเดิน', standUp: 'การลุกขึ้น',
  damage: 'การหัก HP', areaDamage: 'ความเสียหายแบบพื้นที่', heal: 'การรักษา', adjustHp: 'การปรับ HP',
  sheetRoll: 'การทอยจากชีต', roll: 'การทอย', castSave: 'การร่ายเวท', cast: 'การร่ายเวท', classFeature: 'การใช้ความสามารถของคลาส', dmNotes: 'การแก้โน้ตของ DM', spellbook: 'การแก้รายการเวท', spellSave: 'การทอยเซฟ', effectSave: 'การทอยเซฟ',
  conditions: 'การเปลี่ยน Condition', addEffect: 'การเพิ่ม effect', removeEffect: 'การลบ effect',
  slots: 'การใช้ช่องเวท', useResource: 'การใช้ทรัพยากร', spendHitDie: 'การใช้ Hit Die', rest: 'การพัก', magicalCunning: 'Magical Cunning',
  turnAction: 'การใช้ Action', sheet: 'การแก้ชีต', inventoryAdd: 'การเพิ่มไอเทม', inventoryRemove: 'การนำไอเทมออก', inventoryBonus: 'การตั้งโบนัสเวท',
  takeItem: 'การหยิบของ', storeItem: 'การเก็บของ', dropItem: 'การทิ้งของ', placeItem: 'การวางไอเทม', containerAdd: 'การใส่ของในกล่อง', containerRemove: 'การนำของออกจากกล่อง',
  place: 'การวาง Token', removeToken: 'การนำ Token ออก', importObject: 'การวาง Object', moveObject: 'การย้าย Object', removeObject: 'การลบ Object',
  walls: 'การแก้ผนัง', doorSettings: 'การตั้งประตู', door: 'การเปิดปิดประตู', lights: 'การแก้แหล่งแสง', darkness: 'การระบายความมืด', terrain: 'การระบาย Difficult Terrain',
  visionSettings: 'การตั้งค่าการมองเห็น', actorVision: 'การตั้งค่าการมองเห็น', lightItem: 'การจุดแสง', settings: 'การตั้งค่าห้อง', scene: 'การแก้ฉาก',
  combat: 'การเริ่มต่อสู้', end: 'การจบการต่อสู้', next: 'การไปเทิร์นถัดไป', endTurn: 'การจบเทิร์น', previousTurn: 'การย้อนเทิร์น', tie: 'การสลับลำดับ',
  template: 'การแก้ต้นแบบ', pasteBoard: 'การวาง', opportunity: 'Opportunity Attack'
}
export const isUndoable = (type: string) => !skip.has(type)

/**
 * JSON with object keys sorted. The room is stored as PostgreSQL jsonb, which reorders keys on every save,
 * so plain JSON.stringify would see a change where there is none.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().flatMap(key => {
      const item = (value as Record<string, unknown>)[key]
      return item === undefined ? [] : [[key, canonical(item)]]
    }))
  }
  return value
}
const textOf = (value: unknown) => value === undefined ? '∅' : JSON.stringify(canonical(value))
/** 32-bit FNV-1a of a value's JSON: enough to tell "still as I left it" from "someone changed it". */
function fingerprint(value: unknown) {
  return hashText(textOf(value))
}
function hashText(text: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Everything undo can put back, as units keyed by what they are. Visual and derived data is left out. */
function units(room: Room) {
  const map = new Map<string, unknown>()
  map.set('settings', room.settings)
  map.set('active', room.activeSceneId)
  map.set('sceneOrder', room.scenes.map(scene => scene.id))
  for (const actor of room.actors) map.set('actor:' + actor.id, actor)
  for (const template of room.templates) map.set('template:' + template.id, template)
  for (const scene of room.scenes) {
    const { tokens, objects, vision, combat, damageEvents: _damage, areaEffect: _area, view: _view, ...meta } = scene
    map.set('scene:' + scene.id, meta)
    // The fight in pieces, so one person's move doesn't collide with someone else's Reaction or card:
    // turn order, feet moved this turn, and each creature's Action use. Opportunity cards are passing, never undone.
    if (combat) {
      const { moved, uses, prompts: _prompts, ...order } = combat
      map.set('scene:' + scene.id + ':combat', order)
      map.set('scene:' + scene.id + ':moved', moved)
      for (const [actorId, use] of Object.entries(uses ?? {})) map.set('scene:' + scene.id + ':use:' + actorId, use)
    } else map.set('scene:' + scene.id + ':combat', undefined)
    for (const token of tokens) map.set('scene:' + scene.id + ':token:' + token.id, token)
    for (const object of objects ?? []) map.set('scene:' + scene.id + ':object:' + object.id, object)
    if (vision) {
      const { walls, lights, explored: _explored, ...rest } = vision
      map.set('scene:' + scene.id + ':vision', rest)
      for (const wall of walls ?? []) map.set('scene:' + scene.id + ':wall:' + wall.id, wall)
      for (const light of lights ?? []) map.set('scene:' + scene.id + ':light:' + light.id, light)
    }
  }
  return map
}

export type Before = { prints: Map<string, number>; texts: Map<string, string>; rolls: number; active?: string; rounds: Map<string, number> }

/** Fingerprints of every unit before a command runs, keeping the JSON so only changed units are ever parsed back. */
export function beforeCommand(room: Room): Before {
  const texts = new Map<string, string>()
  const prints = new Map<string, number>()
  for (const [key, value] of units(room)) {
    const text = textOf(value)
    texts.set(key, text)
    prints.set(key, hashText(text))
  }
  const rounds = new Map(room.scenes.flatMap(scene => scene.combat ? [[scene.id, scene.combat.round] as const] : []))
  return { prints, texts, rolls: room.rolls.length, active: room.activeSceneId, rounds }
}

/**
 * After a command: keep what it changed as this member's newest undo step.
 * Moving the table to another scene or starting a new round of a fight clears everyone's steps.
 */
export function afterCommand(room: Room, member: Member, type: string, before: Before, alsoOwn: string[] = []) {
  const roundUp = room.scenes.some(scene => scene.combat && (before.rounds.get(scene.id) ?? scene.combat.round) < scene.combat.round)
  if (room.activeSceneId !== before.active || roundUp) {
    delete room.undoSteps
    delete room.redoSteps
    return
  }
  // Something new was done: what this member undid can no longer be redone.
  if (room.redoSteps?.[member.id]) {
    const { [member.id]: _gone, ...rest } = room.redoSteps
    room.redoSteps = rest
  }
  const now = units(room)
  const keys = new Set([...before.prints.keys(), ...now.keys()])
  let changed: UndoUnit[] = []
  for (const key of keys) {
    const after = fingerprint(now.get(key))
    if (after === (before.prints.get(key) ?? fingerprint(undefined))) continue
    const text = before.texts.get(key)
    changed.push({ key, before: text === undefined || text === '∅' ? undefined : JSON.parse(text), after })
  }
  const rollIds = room.rolls.slice(before.rolls).map(roll => roll.id)
  // A player's dice stand: from a step that rolled, keep only changes to their own creatures.
  if (member.role !== 'dm' && rollIds.length) {
    const own = new Set([...room.actors.filter(actor => actor.ownerId === member.id).map(actor => actor.id), ...alsoOwn].map(id => 'actor:' + id))
    // …and that creature's Action use in a fight (scene:<id>:use:<actor>).
    changed = changed.filter(unit => own.has(unit.key) || own.has('actor:' + (/:use:(.+)$/.exec(unit.key)?.[1] ?? '')))
  }
  if (!changed.length && !(member.role === 'dm' && rollIds.length)) return
  const step: UndoStep = { at: Date.now(), label: undoLabels[type] ?? 'การกระทำ', units: changed, ...(member.role === 'dm' && rollIds.length ? { rollIds } : {}) }
  room.undoSteps = { ...room.undoSteps, [member.id]: [...(room.undoSteps?.[member.id] ?? []), step].slice(-undoDepth) }
}

/** Put one unit back to `value` (undefined = it did not exist). */
function restore(room: Room, key: string, value: unknown) {
  const parts = key.split(':')
  const replace = <T extends { id: string }>(list: T[], id: string) => {
    const index = list.findIndex(item => item.id === id)
    if (value === undefined) { if (index >= 0) list.splice(index, 1) }
    else if (index >= 0) {
      // In place, so anything holding this object sees the old values again.
      const item = list[index] as Record<string, unknown>
      for (const field of Object.keys(item)) delete item[field]
      Object.assign(item, structuredClone(value))
    }
    else list.push(structuredClone(value) as T)
  }
  if (key === 'settings') room.settings = value === undefined ? undefined : structuredClone(value) as Room['settings']
  else if (key === 'active') room.activeSceneId = value as string | undefined
  else if (key === 'sceneOrder') {
    const order = value as string[]
    room.scenes.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  } else if (parts[0] === 'actor') replace(room.actors, parts[1])
  else if (parts[0] === 'template') replace(room.templates, parts[1])
  else if (parts[0] === 'scene') {
    const sceneId = parts[1]
    let scene = room.scenes.find(item => item.id === sceneId)
    if (parts.length === 2) {
      if (value === undefined) { room.scenes = room.scenes.filter(item => item.id !== sceneId); return }
      if (!scene) { scene = { ...(structuredClone(value) as Scene), tokens: [] }; room.scenes.push(scene); return }
      const { tokens, objects, vision, combat, damageEvents, areaEffect } = scene
      Object.keys(scene).forEach(field => delete (scene as Record<string, unknown>)[field])
      Object.assign(scene, structuredClone(value), { tokens, objects, vision, combat, damageEvents, areaEffect })
      return
    }
    if (!scene) return
    const kind = parts[2]
    const id = parts[3]
    if (kind === 'combat') {
      if (value === undefined) delete scene.combat
      else {
        const { moved, uses, prompts } = scene.combat ?? {}
        scene.combat = { ...(structuredClone(value) as NonNullable<Scene['combat']>), moved, uses, prompts }
      }
    } else if (kind === 'moved') { if (scene.combat) { if (value === undefined) delete scene.combat.moved; else scene.combat.moved = structuredClone(value) as NonNullable<Scene['combat']>['moved'] } }
    else if (kind === 'use') {
      if (!scene.combat) return
      const uses = { ...scene.combat.uses }
      if (value === undefined) delete uses[id]
      else uses[id] = structuredClone(value) as NonNullable<NonNullable<Scene['combat']>['uses']>[string]
      scene.combat.uses = uses
    }
    else if (kind === 'token') replace(scene.tokens, id)
    else if (kind === 'object') replace(scene.objects ??= [], id)
    else if (kind === 'vision') {
      const { walls, lights, explored } = scene.vision ?? {}
      if (value === undefined) { if (!walls?.length && !lights?.length) delete scene.vision }
      else scene.vision = { ...(structuredClone(value) as NonNullable<Scene['vision']>), walls, lights, explored }
    } else if (kind === 'wall') replace((scene.vision ??= { enabled: false, ambient: 'day' }).walls ??= [], id)
    else if (kind === 'light') replace((scene.vision ??= { enabled: false, ambient: 'day' }).lights ??= [], id)
  }
}

/**
 * Apply a step's old values if nobody changed its units since, and return the step that reverses it
 * (each unit's value now and the fingerprint it is left at). Rolls are marked undone, or back.
 */
function swap(room: Room, step: UndoStep, undone: boolean): UndoStep | undefined {
  const now = units(room)
  if (step.units.some(unit => fingerprint(now.get(unit.key)) !== unit.after)) return undefined
  const current = new Map(step.units.map(unit => [unit.key, now.get(unit.key) === undefined ? undefined : JSON.parse(textOf(now.get(unit.key)))]))
  for (const unit of step.units) restore(room, unit.key, unit.before)
  const after = units(room)
  for (const id of step.rollIds ?? []) {
    const roll = room.rolls.find(item => item.id === id)
    if (roll) roll.undone = undone || undefined
  }
  return { ...step, at: Date.now(), units: step.units.map(unit => ({ key: unit.key, before: current.get(unit.key), after: fingerprint(after.get(unit.key)) })) }
}

type Outcome = { result: 'done' | 'blocked' | 'empty'; label?: string }
/** Move this member's newest step from one list to the other, applying it on the way. */
function move(room: Room, member: Member, from: 'undoSteps' | 'redoSteps', undone: boolean): Outcome {
  const to = from === 'undoSteps' ? 'redoSteps' : 'undoSteps'
  const steps = room[from]?.[member.id] ?? []
  const step = steps.at(-1)
  if (!step) return { result: 'empty' }
  room[from] = { ...room[from], [member.id]: steps.slice(0, -1) }
  const reverse = swap(room, step, undone)
  if (!reverse) return { result: 'blocked', label: step.label }
  room[to] = { ...room[to], [member.id]: [...(room[to]?.[member.id] ?? []), reverse].slice(-undoDepth) }
  return { result: 'done', label: step.label }
}

/**
 * Take back this member's newest step. Returns what happened: undone, or
 * dropped because someone else changed it since (then the next Ctrl+Z goes
 * one step further back), or nothing left.
 */
export const undoLast = (room: Room, member: Member) => move(room, member, 'undoSteps', true)
/** Put back what this member last undid (same rules as undo). */
export const redoLast = (room: Room, member: Member) => move(room, member, 'redoSteps', false)
