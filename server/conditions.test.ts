import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conditionBase, conditionGlyph, conditionInfo, exhaustionEffects, formatConditions, parseConditions, rankConditions, srdConditions, tickConditions } from '../shared/conditions.ts'

test('every SRD condition has a summary, a two-letter mark and its own rank', () => {
  const ranks = srdConditions.map(name => conditionInfo[name].rank)
  assert.equal(new Set(ranks).size, srdConditions.length)
  const glyphs = srdConditions.map(name => conditionInfo[name].glyph)
  assert.equal(new Set(glyphs).size, srdConditions.length)
  assert.ok(srdConditions.every(name => conditionInfo[name].summary.length > 10))
})

test('Exhaustion carries a level; the old ":N" still means rounds', () => {
  assert.deepEqual(conditionBase('Exhaustion 2'), { base: 'Exhaustion', level: 2 })
  assert.deepEqual(conditionBase('Exhaustion'), { base: 'Exhaustion', level: 1 })
  assert.deepEqual(conditionBase('Hexed'), { base: 'Hexed' })
  assert.deepEqual(parseConditions('Exhaustion 2:3, Frightened:2'), [{ name: 'Exhaustion 2', rounds: 3 }, { name: 'Frightened', rounds: 2 }])
  assert.equal(formatConditions(parseConditions('Exhaustion 3, Prone:1')), 'Exhaustion 3, Prone:1')
  assert.equal(tickConditions('Exhaustion 2, Prone:1').value, 'Exhaustion 2', 'levels do not count down with rounds')
  assert.deepEqual(exhaustionEffects(2), { d20: -4, speed: -10, dead: false })
  assert.equal(exhaustionEffects(6).dead, true)
})

test('the most limiting conditions come first, free text last; marks fit on a token', () => {
  const ranked = rankConditions(parseConditions('Hexed, Poisoned, Exhaustion 2, Paralyzed, Prone'))
  assert.deepEqual(ranked.map(item => item.name), ['Paralyzed', 'Prone', 'Poisoned', 'Exhaustion 2', 'Hexed'])
  assert.deepEqual(ranked.map(item => conditionGlyph(item.name)), ['Pa', 'Pr', 'Po', 'E2', 'He'])
})
