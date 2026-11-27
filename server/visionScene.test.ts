import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blankSheet } from '../shared/model.ts'
import type { Actor, Member, Room } from '../shared/model.ts'
import { applyCommand, snapshot } from './commands.ts'

/** A 10 × 6 room split by a wall at x = 5 with a door; Mira's hero west, a goblin east. */
function table() {
  const dm: Member = { id: 'dm', name: 'DM', role: 'dm' }
  const mira: Member = { id: 'm', name: 'Mira', role: 'player' }
  const hero: Actor = { ...blankSheet(), id: 'hero', ownerId: 'm', name: 'Hero', inventory: [{ id: 'tt', name: 'Thieves’ Tools', description: '', tool: 'thievesTools' }] }
  const goblin: Actor = { ...blankSheet('monster'), id: 'gob', ownerId: 'dm', name: 'Goblin' }
  const room: Room = {
    id: 'r', name: 'R', invite: 'i', revision: 0, activeSceneId: 's', members: [dm, mira], templates: [], rolls: [], actors: [hero, goblin],
    scenes: [{ id: 's', name: 'Hall', cell: 48, originX: 0, originY: 0, tokens: [{ id: 't1', actorId: 'hero', x: 4, y: 2 }, { id: 't2', actorId: 'gob', x: 8, y: 2 }] }]
  }
  const run = (who: Member, body: Record<string, unknown>) => applyCommand(room, who, { sceneId: 's', ...body })
  run(dm, { type: 'walls', add: [{ a: { x: 5, y: 0 }, b: { x: 5, y: 2 } }, { a: { x: 5, y: 2 }, b: { x: 5, y: 3 }, door: true }, { a: { x: 5, y: 3 }, b: { x: 5, y: 6 } }] })
  run(dm, { type: 'visionSettings', enabled: true, ambient: 'day' })
  const door = room.scenes[0].vision!.walls!.find(wall => wall.door)!
  return { dm, mira, hero, goblin, room, run, door }
}

test('a player is sent only the tokens their own tokens see, and remembers what they saw', () => {
  const { dm, mira, room, run, door } = table()
  const view = () => snapshot(room, mira).scenes[0]
  assert.deepEqual(view().tokens.map(token => token.actorId), ['hero'], 'the goblin is behind the closed door')
  assert.equal(snapshot(room, dm).scenes[0].tokens.length, 2, 'the DM sees everything')
  run(mira, { type: 'door', wallId: door.id, actorId: 'hero', open: true })
  assert.deepEqual(view().tokens.map(token => token.actorId), ['hero', 'gob'])
  assert.ok(view().view!.explored.includes('8,2'), 'the goblin square is now explored')
  run(dm, { type: 'door', wallId: door.id, open: false })
  assert.deepEqual(view().tokens.map(token => token.actorId), ['hero'])
  assert.ok(view().view!.explored.includes('8,2'), 'explored squares stay after the door shuts')
  run(dm, { type: 'visionSettings', clearExplored: true })
  assert.ok(!(view().view!.explored.includes('8,2')))
  assert.equal(view().vision!.darkness, undefined, 'players are not sent the darkness map')
})

test('doors: players need to stand next to them; locked doors need a DC; secret doors are just wall to players', () => {
  const { dm, mira, room, run, door, hero } = table()
  room.scenes[0].tokens[0].x = 1
  assert.throws(() => run(mira, { type: 'door', wallId: door.id, actorId: 'hero', open: true }), /เข้าใกล้ประตู/)
  room.scenes[0].tokens[0].x = 4
  run(dm, { type: 'doorSettings', wallId: door.id, door: { locked: true, dc: 1 } })
  assert.throws(() => run(mira, { type: 'door', wallId: door.id, actorId: 'hero', open: true }), /ล็อก/)
  hero.itemProficiency = { thievesTools: true, sleight: false, investigation: false, perception: false }
  run(mira, { type: 'pickDoor', wallId: door.id, actorId: 'hero' })
  assert.equal(door.door!.locked, false)
  assert.equal(door.door!.open, true)
  run(dm, { type: 'doorSettings', wallId: door.id, door: { secret: true, open: false } })
  const seen = snapshot(room, mira).scenes[0].vision!.walls!.find(wall => wall.id === door.id)!
  assert.equal(seen.door, undefined)
  assert.throws(() => run(mira, { type: 'door', wallId: door.id, actorId: 'hero', open: true }), /ไม่ใช่ประตู/)
})

test('night: lights, darkness painting, actor vision and masked names', () => {
  const { dm, mira, room, run, door, goblin } = table()
  run(dm, { type: 'door', wallId: door.id, open: true })
  run(dm, { type: 'visionSettings', ambient: 'night' })
  const tokens = () => snapshot(room, mira).scenes[0].tokens.map(token => token.actorId)
  assert.deepEqual(tokens(), ['hero'], 'a dark room hides the goblin')
  run(dm, { type: 'lights', add: { x: 8.5, y: 2.5, bright: 10, dim: 0 } })
  assert.deepEqual(tokens(), ['hero', 'gob'], 'a lit square is seen from afar')
  run(dm, { type: 'darkness', cells: ['8,2'], mode: 'magic' })
  assert.deepEqual(tokens(), ['hero'], 'magical darkness swallows the light')
  run(dm, { type: 'darkness', cells: ['8,2'], mode: 'clear' })
  // Darkvision set by the DM; the player can only switch a light the DM gave them.
  assert.throws(() => run(mira, { type: 'actorVision', actorId: 'hero', lightOn: true }), /DM/)
  run(dm, { type: 'actorVision', actorId: 'hero', vision: { darkvision: 60, light: { bright: 20, dim: 20, on: false } } })
  run(mira, { type: 'actorVision', actorId: 'hero', lightOn: true })
  assert.equal(room.actors[0].vision?.light?.on, true)
  assert.equal(room.actors[0].vision?.darkvision, 60)
  // Rolls by a creature the player cannot see show as "บางสิ่ง".
  run(dm, { type: 'lights', remove: room.scenes[0].vision!.lights![0].id })
  run(dm, { type: 'door', wallId: door.id, open: false })
  run(dm, { type: 'sheetRoll', rollType: 'check', ability: 'STR', actorId: goblin.id })
  assert.match(snapshot(room, mira).rolls.at(-1)!.label, /บางสิ่ง/)
  assert.match(snapshot(room, dm).rolls.at(-1)!.label, /Goblin/)
})
