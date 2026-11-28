import assert from 'node:assert/strict'
import test from 'node:test'
import type { Wall } from '../../../shared/vision.ts'
import { wallEdit, wallEndAt, wallsIn } from './visionTools.ts'

// A 2×2 room: four walls meeting at its corners, plus one loose wall.
const room: Wall[] = [
  { id: 'top', a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
  { id: 'right', a: { x: 2, y: 0 }, b: { x: 2, y: 2 } },
  { id: 'bottom', a: { x: 2, y: 2 }, b: { x: 0, y: 2 } },
  { id: 'left', a: { x: 0, y: 2 }, b: { x: 0, y: 0 } },
  { id: 'loose', a: { x: 5, y: 5 }, b: { x: 6, y: 5 } }
]
const byId = <T extends { id: string }>(list: T[]): Record<string, T> => Object.fromEntries(list.map(item => [item.id, item]))

test('dragging a corner moves every wall end on it, so the room stays closed', () => {
  const grab = wallEndAt(room, { x: 2.1, y: .1 })
  assert.deepEqual(grab, { kind: 'end', wallId: 'top', end: 'b' })
  const moved = byId(wallEdit(room, [], grab!, { to: { x: 3, y: 0 } }))
  assert.deepEqual(Object.keys(moved).sort(), ['right', 'top'])
  assert.deepEqual(moved.top, { id: 'top', a: { x: 0, y: 0 }, b: { x: 3, y: 0 } })
  assert.deepEqual(moved.right, { id: 'right', a: { x: 3, y: 0 }, b: { x: 2, y: 2 } })
})

test('Alt pulls one wall end away from its neighbours', () => {
  const moved = wallEdit(room, [], { kind: 'end', wallId: 'top', end: 'b' }, { to: { x: 3, y: 0 } }, true)
  assert.deepEqual(moved, [{ id: 'top', a: { x: 0, y: 0 }, b: { x: 3, y: 0 } }])
})

test('moving selected walls stretches the walls joined to them', () => {
  const moved = byId(wallEdit(room, ['right'], { kind: 'body' }, { delta: { x: 1, y: 0 } }))
  assert.deepEqual(moved.right, { id: 'right', a: { x: 3, y: 0 }, b: { x: 3, y: 2 } })
  assert.deepEqual(moved.top.b, { x: 3, y: 0 })
  assert.deepEqual(moved.bottom.a, { x: 3, y: 2 })
  assert.equal(moved.left, undefined)
  assert.equal(moved.loose, undefined)
})

test('moving the whole room moves only the room', () => {
  const all = wallsIn(room, { x: -.5, y: -.5 }, { x: 2.5, y: 2.5 }).map(wall => wall.id)
  assert.deepEqual(all, ['top', 'right', 'bottom', 'left'])
  const moved = wallEdit(room, all, { kind: 'body' }, { delta: { x: 0, y: 3 } })
  assert.equal(moved.length, 4)
  assert.deepEqual(byId(moved).left, { id: 'left', a: { x: 0, y: 5 }, b: { x: 0, y: 3 } })
})

test('a wall dragged onto its own other end is left as it was', () => {
  assert.deepEqual(wallEdit(room, [], { kind: 'end', wallId: 'loose', end: 'b' }, { to: { x: 5, y: 5 } }, true), [])
})
