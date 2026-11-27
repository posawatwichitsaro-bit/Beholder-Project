import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diceFor, faceLabel } from './plan.ts'

test('a roll becomes the dice it was rolled with, in formula order', () => {
  assert.deepEqual(diceFor({ formula: '2d6+1d4+3', faces: [3, 5, 2] }), [{ sides: 6, value: 3 }, { sides: 6, value: 5 }, { sides: 4, value: 2 }])
  assert.deepEqual(diceFor({ formula: '1d20+5', faces: [17, 4] }), [{ sides: 20, value: 17 }, { sides: 20, value: 4 }], 'Advantage: two d20')
  assert.deepEqual(diceFor({ formula: '1d100', faces: [47] }), [
    { sides: 10, value: 4, label: '40', percentile: 'tens' }, { sides: 10, value: 7, label: '7', percentile: 'units' }])
  assert.deepEqual(diceFor({ formula: '1d100', faces: [100] })?.map(die => die.label), ['00', '0'])
})

test('too many dice, no faces or an unknown die shows no 3D dice', () => {
  assert.equal(diceFor({ formula: '8d6', faces: [1, 2, 3, 4, 5, 6, 1, 2] }), undefined)
  assert.equal(diceFor({ formula: 'DEX Save DC', faces: [] }), undefined)
  assert.equal(diceFor({ formula: '1d7', faces: [3] }), undefined)
  assert.equal(diceFor({ formula: '2d6', faces: [3] }), undefined, 'faces must match the dice')
})

test('face labels: d10 shows 0 for ten, percentile tens show 00–90', () => {
  assert.equal(faceLabel(20, 20), '20')
  assert.equal(faceLabel(10, 10), '0')
  assert.equal(faceLabel(10, 3, 'tens'), '30')
  assert.equal(faceLabel(10, 10, 'tens'), '00')
})
