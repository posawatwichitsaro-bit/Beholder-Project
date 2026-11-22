import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blankSheet } from '../shared/model.ts'
import { d20, deathSave, harm, heal, rollDice } from './rules.ts'

test('critical doubles only dice and Advantage/Disadvantage cancel', () => {
  assert.deepEqual(rollDice('1d8+3', () => 4, true), { formula: '1d8+3', faces: [4, 4], modifier: 3, total: 11 })
  const faces = [3, 18]
  assert.equal(d20(2, true, false, () => faces.shift()!).total, 20)
  assert.equal(d20(2, true, true, () => 9).faces.length, 1)
  for (const bad of ['0d20', '3d7', '101d20', '1d6+1d8']) assert.throws(() => rollDice(bad))
})

test('temporary HP absorbs damage and recovery resets death saves', () => {
  const actor = { ...blankSheet(), hp: 7, tempHp: 3 }
  harm(actor, 8)
  assert.deepEqual([actor.hp, actor.tempHp], [2, 0])
  harm(actor, 2)
  assert.equal(actor.life, 'dying')
  deathSave(actor, 1)
  assert.equal(actor.failures, 2)
  deathSave(actor, 20)
  assert.deepEqual([actor.life, actor.hp, actor.failures], ['active', 1, 0])
  heal(actor, 100)
  assert.equal(actor.hp, actor.maxHp)
})
