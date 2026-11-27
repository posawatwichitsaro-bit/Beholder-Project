import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blankSheet } from '../shared/model.ts'
import { inside, key, playerView, sightPolygon, speciesDarkvision, visionOf, wallsForPlayer } from '../shared/vision.ts'
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
