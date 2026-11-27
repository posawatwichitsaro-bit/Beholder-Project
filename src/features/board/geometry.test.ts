import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boardTransform, bounds, gridLines, pieceAt, piecesIn, rulerFeet } from './geometry.ts'

const grid = { cell: 48, originX: 12, originY: 0 }

test('cells and screen pixels round-trip through camera, grid origin and zoom', () => {
  const t = boardTransform({ camera: { x: 36, y: 36 }, zoom: 2 }, grid)
  assert.equal(t.size, 96)
  assert.deepEqual(t.pixel({ x: 1, y: 1 }), { x: 36 + 24 + 96, y: 36 + 96 })
  assert.deepEqual(t.cell({ x: 36 + 24 + 96 + 50, y: 36 + 96 + 95 }), { x: 1, y: 1 })
  assert.deepEqual(t.cell({ x: 36 + 24 + 96 + 50, y: 36 }, .5), { x: 1.5, y: 0 })
  assert.deepEqual(t.areaPoint({ x: 36 + 24 + 140, y: 36 + 30 }), { x: 1.5, y: .5 })
  assert.deepEqual(t.world({ x: 2, y: 3 }), { x: 12 + 96, y: 144 })
})

test('the topmost piece under a point wins, and a box picks what it touches', () => {
  const t = boardTransform({ camera: { x: 0, y: 0 }, zoom: 1 }, { cell: 48, originX: 0, originY: 0 })
  const pieces = [{ id: 'a', x: 0, y: 0, size: 2 }, { id: 'b', x: 1, y: 1, size: 1 }]
  const extent = (piece: { size: number }) => ({ width: piece.size, height: piece.size })
  assert.equal(pieceAt(t, pieces, { x: 60, y: 60 }, extent)?.id, 'b')
  assert.equal(pieceAt(t, pieces, { x: 10, y: 10 }, extent)?.id, 'a')
  assert.equal(pieceAt(t, pieces, { x: 200, y: 10 }, extent), undefined)
  assert.deepEqual(piecesIn(t, pieces, bounds({ x: 50, y: 50 }, { x: 70, y: 70 }), extent).map(piece => piece.id), ['a', 'b'])
  assert.deepEqual(piecesIn(t, pieces, bounds({ x: 50, y: 50 }, { x: 52, y: 52 }), extent), [], 'a tiny box is a click')
})

test('grid lines cover the screen from the wrapped origin; the ruler counts the longer axis', () => {
  const t = boardTransform({ camera: { x: -10, y: 5 }, zoom: 1 }, { cell: 50, originX: 0, originY: 0 })
  const lines = gridLines(t, { x: 200, y: 120 })
  assert.deepEqual(lines.xs, [40, 90, 140, 190])
  assert.deepEqual(lines.ys, [5, 55, 105])
  assert.equal(rulerFeet({ x: 0, y: 0 }, { x: 3, y: -5 }), 25)
})
