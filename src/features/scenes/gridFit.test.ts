import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fitGrid } from './gridFit.ts'

test('a box over one map square gives the cell size and an origin on its corner', () => {
  assert.deepEqual(fitGrid({ x: 130, y: 75, width: 70, height: 70 }), { cell: 70, originX: 60, originY: 5 })
})

test('a box over several squares is divided by how many it covers', () => {
  assert.deepEqual(fitGrid({ x: 12, y: 0, width: 352, height: 176 }, 5, 2.5), { cell: 70, originX: 12, originY: 0 })
  assert.deepEqual(fitGrid({ x: -20, y: -50, width: 96, height: 96 }, 2), { cell: 48, originX: 28, originY: 46 }, 'negative corners wrap into the first cell')
})

test('the cell size stays within what the server accepts', () => {
  assert.equal(fitGrid({ x: 0, y: 0, width: 4, height: 4 }).cell, 12)
  assert.equal(fitGrid({ x: 0, y: 0, width: 900, height: 900 }).cell, 300)
})
