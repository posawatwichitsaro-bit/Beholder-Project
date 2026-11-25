import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diceOutcome, dieOf, faceOf } from './diceOutcome.ts'
import { timeline } from './timeline.ts'

const roll = (formula: string, faces: number[], modifier = 0, extra = {}) =>
  ({ formula, faces, modifier, total: faces.reduce((a, b) => a + b, modifier), ...extra })

test('natural 20s and 1s are spotted on d20 rolls only, including advantage', () => {
  assert.equal(diceOutcome(roll('1d20+5', [20], 5)), 'critical')
  assert.equal(diceOutcome(roll('1d20-1', [1], -1)), 'fumble')
  assert.equal(diceOutcome(roll('1d20+2', [11], 2)), 'normal')
  const advantage = { formula: '1d20+3', faces: [4, 20], modifier: 3, total: 23 }
  assert.equal(diceOutcome(advantage), 'critical', 'the kept die decides')
  const disadvantage = { formula: '1d20+3', faces: [1, 20], modifier: 3, total: 4 }
  assert.equal(diceOutcome(disadvantage), 'fumble')
  assert.equal(diceOutcome(roll('1d6', [1])), 'normal', 'a 1 on a d6 is not a fumble')
  assert.equal(diceOutcome(roll('2d6+3', [6, 6], 3, { critical: true })), 'critical', 'critical damage from the server')
})

test('the die shape and face come from the formula and the dice', () => {
  assert.equal(dieOf({ formula: '2d6+3' }), 6)
  assert.equal(dieOf({ formula: '1d100' }), 100)
  assert.equal(faceOf(roll('1d20+5', [17], 5)), 17)
  assert.equal(faceOf(roll('2d6+3', [2, 5], 3)), 7)
})

test('the adventure log interleaves rolls and log lines by time; old untimed rolls come first', () => {
  const entries = timeline(
    [{ id: 'r0', name: 'DM', label: 'd20', formula: '1d20', faces: [3], modifier: 0, total: 3 },
      { id: 'r2', name: 'Mira', label: 'STR check', formula: '1d20', faces: [9], modifier: 0, total: 9, at: 300 }],
    [{ id: 'l1', at: 200, kind: 'chat', text: 'hi', name: 'Hawk' }, { id: 'l3', at: 400, kind: 'scene', text: 'เปิดฉาก Gate' }]
  )
  assert.deepEqual(entries.map(entry => entry.id), ['r0', 'l1', 'r2', 'l3'])
  assert.deepEqual(entries.map(entry => entry.type), ['roll', 'log', 'roll', 'log'])
})
