import assert from 'node:assert/strict'
import { test } from 'node:test'
import { doorAt, knownDoor, lightAt, snapCorner, strokeCells, wallAt } from './visionTools.ts'

const wall = { id: 'w', a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }
const door = { id: 'd', a: { x: 5, y: 2 }, b: { x: 5, y: 3 }, door: { open: false } }

test('walls snap to corners; the nearest wall or door handle is found under the pointer', () => {
  assert.deepEqual(snapCorner({ x: 2.4, y: 3.6 }), { x: 2, y: 4 })
  assert.deepEqual(snapCorner({ x: 2.4, y: 3.6 }, true), { x: 2.5, y: 3.5 })
  assert.equal(wallAt([wall, door], { x: 2, y: .2 })?.id, 'w')
  assert.equal(wallAt([wall, door], { x: 2, y: .6 }), undefined)
  assert.equal(doorAt([wall, door], { x: 5.1, y: 2.6 })?.id, 'd')
  assert.equal(doorAt([wall, door], { x: 2, y: 0 }), undefined, 'plain walls have no handle')
  assert.equal(lightAt([{ id: 'l', x: 3.5, y: 3.5, bright: 20, dim: 20, on: true }], { x: 3.7, y: 3.4 })?.id, 'l')
})

test('a paint stroke covers every cell it crosses; a door is known when a cell beside it is', () => {
  assert.deepEqual([...strokeCells({ x: .5, y: .5 }, { x: 3.5, y: .5 })], ['0,0', '1,0', '2,0', '3,0'])
  assert.ok(knownDoor(door, new Set(['4,2'])), 'seen from the west side')
  assert.ok(knownDoor(door, new Set(['5,2'])), 'seen from the east side')
  assert.ok(!knownDoor(door, new Set(['1,1'])))
})
