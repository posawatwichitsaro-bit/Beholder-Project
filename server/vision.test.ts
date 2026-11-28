import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blankSheet } from '../shared/model.ts'
import type { Room } from '../shared/model.ts'
import { inside, insideStar, key, playerView, sightPolygon, speciesDarkvision, star, visionOf, wallsForPlayer } from '../shared/vision.ts'
import type { SceneVision, Wall } from '../shared/vision.ts'
import { species } from '../src/features/sheets/origins.ts'

// A room 10 × 6 cells with a wall down x = 5 (a door in it from y = 2 to 3), the hero at (1, 2).
const wall = (id: string, ax: number, ay: number, bx: number, by: number, door?: Wall['door']): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, door })
const walls = [wall('w1', 5, 0, 5, 2), wall('door', 5, 2, 5, 3, { open: false }), wall('w2', 5, 3, 5, 6)]
const hero = { ...blankSheet(), id: 'hero', ownerId: 'm', name: 'Hero' }
const goblin = { ...blankSheet('monster'), id: 'gob', ownerId: 'dm', name: 'Goblin' }
const scene = (vision: Partial<SceneVision>) => ({
  tokens: [{ id: 't1', actorId: 'hero', x: 1, y: 2 }, { id: 't2', actorId: 'gob', x: 8, y: 2 }],
  vision: { enabled: true, ambient: 'day' as const, walls, ...vision }
})

test('walls block sight; an open door lets it through', () => {
  const shut = playerView(scene({}), [hero, goblin], 'm')
  assert.ok(shut.visible.has(key(3, 2)))
  assert.ok(!shut.visible.has(key(8, 2)), 'the goblin room is behind the closed door')
  const open = playerView(scene({ walls: walls.map(item => item.door ? { ...item, door: { open: true } } : item) }), [hero, goblin], 'm')
  assert.ok(open.visible.has(key(8, 2)))
  assert.ok(!open.visible.has(key(8, 0)), 'only through the doorway, not the whole room')
})

test('darkness: unseen without light, dim through Darkvision, lit by a torch, and magical darkness defeats both', () => {
  const night = scene({ ambient: 'night', walls: [] })
  assert.equal(playerView(night, [hero, goblin], 'm').visible.size > 0, true, 'your own square is always seen')
  assert.ok(!playerView(night, [hero, goblin], 'm').visible.has(key(4, 2)))
  const dwarf = { ...hero, characterDetails: { species: 'Dwarf' } }
  const dv = playerView(night, [dwarf, goblin], 'm')
  assert.ok(dv.visible.has(key(8, 2)) && dv.darkvision.has(key(8, 2)), 'Darkvision 120 ft sees the dark as grey')
  const torch = { ...hero, vision: { light: { bright: 20, dim: 20, on: true } } }
  const lit = playerView(night, [torch, goblin], 'm')
  assert.ok(lit.visible.has(key(4, 2)) && !lit.dimmed.has(key(4, 2)), 'bright within 20 ft')
  assert.ok(lit.dimmed.has(key(8, 2)), 'dim from 20 to 40 ft')
  const magic = playerView({ ...night, vision: { ...night.vision, magicDarkness: [key(3, 2)] } }, [{ ...dwarf, vision: { light: { bright: 20, dim: 20, on: true } } }, goblin], 'm')
  assert.ok(!magic.visible.has(key(3, 2)), 'neither light nor Darkvision gets into magical darkness')
  const placed = playerView({ ...night, vision: { ...night.vision, lights: [{ id: 'l', x: 8.5, y: 2.5, bright: 10, dim: 0, on: true }] } }, [hero, goblin], 'm')
  assert.ok(placed.visible.has(key(8, 2)), 'a lit square far away is seen')
})

test('players see from their own tokens only; vision range caps sight; Blinded sees nothing', () => {
  assert.equal(playerView(scene({}), [hero, goblin], 'someone-else').visible.size, 0)
  const short = playerView(scene({ walls: [] }), [{ ...hero, vision: { range: 10 } }, goblin], 'm')
  assert.ok(short.visible.has(key(3, 2)) && !short.visible.has(key(5, 2)))
  assert.equal(playerView(scene({}), [{ ...hero, conditions: 'Blinded' }, goblin], 'm').visible.size, 0)
})

test('sight polygon and helpers', () => {
  const polygon = sightPolygon({ x: 0, y: 0 }, 5, [{ a: { x: 2, y: -5 }, b: { x: 2, y: 5 } }])
  assert.ok(inside(polygon, { x: 1.5, y: 0 }) && !inside(polygon, { x: 3, y: 0 }))
  assert.deepEqual(wallsForPlayer([wall('s', 0, 0, 1, 0, { open: false, secret: true, dc: 15, tried: ['x'] })]), [{ id: 's', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }], 'a secret door is just wall to players')
  assert.equal(visionOf({ ...goblin, monsterReference: { statBlock: 'Senses Darkvision 60 ft.; Passive Perception 9' } }).darkvision, 60)
  for (const [name, entry] of Object.entries(species)) assert.equal(speciesDarkvision[name], entry.darkvision, name + ' Darkvision matches the character builder')
})

test('the fast star test agrees with the plain polygon test (edge points aside)', () => {
  const corridors = Array.from({ length: 20 }, (_, i) => ({ a: { x: 3 + i, y: -2 }, b: { x: 3 + i, y: 4 } }))
  const shape = star({ x: 1.5, y: 1.5 }, 30, corridors)
  let disagree = 0
  let total = 0
  for (let y = -30; y < 30; y++) for (let x = -30; x < 30; x++) {
    total++
    if (insideStar(shape, { x: x + .5, y: y + .5 }) !== inside(shape.points, { x: x + .5, y: y + .5 })) disagree++
  }
  assert.ok(disagree <= total / 1000, disagree + ' of ' + total + ' cells disagree')
})

test('0.14: a Bullseye Lantern lights a 60-ft cone the way its carrier faces, and moving turns it', async () => {
  const { facingOf } = await import('../shared/vision.ts')
  const { applyCommand } = await import('./commands.ts')
  const lantern = { ...hero, inventory: [{ id: 'l', name: 'Lantern, Bullseye', description: '', ref: 'srd-5.2.1:equipment:lantern-bullseye', lit: true }] }
  assert.equal(visionOf(lantern).light?.cone, true)
  const dark = (facing?: number) => playerView({ tokens: [{ id: 't1', actorId: 'hero', x: 20, y: 20, facing }], vision: { enabled: true, ambient: 'night', walls: [] } }, [lantern], 'm').visible
  const east = dark()
  assert.ok(east.has(key(30, 20)) && east.has(key(40, 20)), 'lit ahead, 50 and 100 ft east')
  assert.ok(east.has(key(30, 24)), 'the cone widens: 20 ft off the line, 50 ft out')
  assert.ok(!east.has(key(30, 27)), 'outside the cone stays dark')
  assert.ok(!east.has(key(15, 20)), 'behind the carrier stays dark')
  const south = dark(90)
  assert.ok(south.has(key(20, 30)) && !south.has(key(30, 20)), 'facing south lights south, not east')
  assert.deepEqual([facingOf(1, 0), facingOf(0, 1), facingOf(-2, -2), facingOf(0, -3), facingOf(0, 0)], [0, 90, 225, 270, undefined])
  // Moving turns the token toward where it went; the owner can also turn it by hand.
  const room: Room = {
    id: 'r', name: 'R', invite: 'i', revision: 0, activeSceneId: 's', templates: [], rolls: [], actors: [lantern],
    members: [{ id: 'dm', name: 'DM', role: 'dm' as const }, { id: 'm', name: 'Mira', role: 'player' as const }],
    scenes: [{ id: 's', name: 'Hall', cell: 48, originX: 0, originY: 0, tokens: [{ id: 't1', actorId: 'hero', x: 20, y: 20 }] }]
  }
  const mira = room.members[1]
  applyCommand(room, mira, { type: 'move', sceneId: 's', tokenId: 't1', x: 20, y: 23 })
  assert.equal(room.scenes[0].tokens[0].facing, 90)
  applyCommand(room, mira, { type: 'face', sceneId: 's', tokenId: 't1', facing: 180 })
  assert.equal(room.scenes[0].tokens[0].facing, 180)
  assert.throws(() => applyCommand(room, mira, { type: 'face', sceneId: 's', tokenId: 't1', facing: 100 }))
})
