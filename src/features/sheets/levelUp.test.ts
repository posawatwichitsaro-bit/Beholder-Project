import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCharacter, suggestedAbilities } from './wizard.ts'
import { classesOf, levelHp, levelUp } from './levelUp.ts'

const fighter = buildCharacter({ name: 'Bram', className: 'Fighter', level: 3, abilities: suggestedAbilities('Fighter'), armor: 'Chain Mail', shield: false, weapons: [] })

test('a fixed level adds the class value + CON and keeps damage taken', () => {
  const hurt = { ...fighter, hp: fighter.maxHp - 5 }
  const result = levelUp(hurt, 'Fighter', { mode: 'fixed' })
  assert.equal(result.sheet.classLevel, 'Fighter 4')
  assert.equal(result.gained, 6 + 2, 'd10 fixed 6 + CON 14 (+2)')
  assert.equal(result.sheet.maxHp, fighter.maxHp + 8)
  assert.equal(result.sheet.hp, hurt.hp + 8)
  assert.ok(result.checklist.some(note => note.includes('Ability Score Improvement')), 'Fighter 4 gets an ASI')
})

test('a rolled level uses the roll; multiclassing appends a class and its Hit Die', () => {
  assert.equal(levelUp(fighter, 'Fighter', { mode: 'rolled', roll: 2 }).gained, 2 + 2)
  assert.equal(levelUp(fighter, 'Fighter', { mode: 'rolled', roll: 1 }).gained, Math.max(1, 1 + 2))
  const multi = levelUp(fighter, 'Wizard', { mode: 'fixed' })
  assert.equal(multi.sheet.classLevel, 'Fighter 3 / Wizard 1')
  assert.deepEqual(multi.sheet.calculations?.hp?.classes, [{ die: 10, levels: 3 }, { die: 6, levels: 1 }])
  assert.equal(multi.gained, 4 + 2)
  assert.ok(multi.checklist.some(note => note.startsWith('Multiclass')))
  assert.equal(levelHp('Wizard', 3, { mode: 'fixed' }), 1, 'CON 3 (−4) on a d6 fixed 4 still gives at least 1')
})

test('single-class casters get the next slot table, keeping slots already spent', () => {
  const wizard = buildCharacter({ name: 'Lyra', className: 'Wizard', level: 2, abilities: suggestedAbilities('Wizard'), armor: 'Unarmored', shield: false, weapons: [] })
  const spentOne = { ...wizard, slots: 'L1 2/3' }
  const result = levelUp(spentOne, 'Wizard', { mode: 'fixed' })
  assert.equal(result.sheet.slots, 'L1 3/4, L2 2/2')
  assert.ok(result.checklist.some(note => note.includes('Subclass')), 'level 3 picks a subclass')
  assert.ok(result.checklist.some(note => note.includes('Cantrips')))
})

test('dwarves keep their extra HP per level; level 20 is the end; the calculator must be on', () => {
  const dwarf = buildCharacter({ name: 'Bram', species: 'Dwarf', className: 'Fighter', level: 1, abilities: suggestedAbilities('Fighter'), armor: 'Chain Mail', shield: false, weapons: [] })
  assert.equal(levelUp(dwarf, 'Fighter', { mode: 'fixed' }).gained, 6 + 2 + 1)
  const capped = buildCharacter({ name: 'Old', className: 'Fighter', level: 20, abilities: suggestedAbilities('Fighter'), armor: 'Chain Mail', shield: false, weapons: [] })
  assert.throws(() => levelUp(capped, 'Fighter', { mode: 'fixed' }), /เลเวล 20/)
  assert.throws(() => levelUp({ ...fighter, calculations: undefined }, 'Fighter', { mode: 'fixed' }), /ตัวคำนวณ/)
  assert.deepEqual(classesOf('fighter 3/ Wizard 1'), [{ name: 'Fighter', level: 3 }, { name: 'Wizard', level: 1 }])
})
