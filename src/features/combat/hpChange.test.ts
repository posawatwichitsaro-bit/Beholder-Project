import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readHpChange } from './hpChange.ts'

test('a plain or + number heals, a - number damages; anything else is ignored', () => {
  assert.deepEqual(readHpChange('15'), { mode: 'heal', amount: 15 })
  assert.deepEqual(readHpChange('+7'), { mode: 'heal', amount: 7 })
  assert.deepEqual(readHpChange('-15'), { mode: 'damage', amount: 15 })
  assert.deepEqual(readHpChange(' − 3 '), { mode: 'damage', amount: 3 }, 'the typographic minus works too')
  for (const text of ['', '0', '-0', 'abc', '1.5', '99999', '--3']) assert.equal(readHpChange(text), undefined, text)
})
