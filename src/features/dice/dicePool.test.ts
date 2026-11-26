import assert from 'node:assert/strict'
import { test } from 'node:test'
import { composeFormula } from './dicePool.ts'

test('picked dice become one formula, largest first, with the modifier', () => {
  assert.equal(composeFormula({ 6: 2, 4: 1 }, 3), '2d6+1d4+3')
  assert.equal(composeFormula({ 20: 1 }, -1), '1d20-1')
  assert.equal(composeFormula({ 8: 0 }, 2), '', 'no dice, no roll')
  assert.equal(composeFormula({ 100: 1, 10: 1 }, 0), '1d100+1d10')
})
