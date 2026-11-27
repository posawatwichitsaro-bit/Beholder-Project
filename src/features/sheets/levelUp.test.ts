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

test('0.07: multiclass casters use the Multiclass Spellcaster table and Warlock Pact Magic stays apart', async () => {
  const { slotsForClasses, magicalCunning, monsterXp, readyToLevel, criticalFrom } = await import('../../../shared/progression.ts')
  assert.deepEqual(slotsForClasses([{ name: 'Wizard', level: 3 }, { name: 'Paladin', level: 3 }]), { slots: 'L1 4/4, L2 3/3, L3 2/2', pact: '' }, 'Wizard 3 + ceil(Paladin 3 / 2) = caster level 5')
  assert.deepEqual(slotsForClasses([{ name: 'Paladin', level: 5 }]), { slots: 'L1 4/4, L2 2/2', pact: '' })
  assert.deepEqual(slotsForClasses([{ name: 'Sorcerer', level: 2 }, { name: 'Warlock', level: 3 }]), { slots: 'L1 3/3', pact: 'L2 2/2' })

  const wizard = buildCharacter({ name: 'Ilse', className: 'Wizard', level: 2, abilities: suggestedAbilities('Wizard'), armor: 'Unarmored', shield: false, weapons: [] })
  const dipped = levelUp({ ...wizard, slots: 'L1 1/3' }, 'Warlock', { mode: 'fixed' }).sheet
  assert.equal(dipped.classLevel, 'Wizard 2 / Warlock 1')
  assert.equal(dipped.slots, 'L1 1/3', 'Wizard slots stay (spent ones too); Warlock levels do not join them')
  assert.equal(dipped.pactSlots, 'L1 1/1')

  const warlock = { ...dipped, classLevel: 'Warlock 4', pactSlots: 'L2 0/2' }
  const cunning = magicalCunning(warlock)!
  assert.deepEqual(cunning, { field: 'pactSlots', value: 'L2 1/2', regained: 1 }, 'half of 2, rounded up')
  assert.equal(magicalCunning({ ...warlock, cunningUsed: true }), undefined)
  assert.equal(magicalCunning({ ...warlock, classLevel: 'Warlock 1' }), undefined)

  assert.equal(monsterXp({ classLevel: 'Humanoid · CR 1/4 · Neutral' }), 50)
  assert.equal(monsterXp({ classLevel: 'Dragon · CR 17' }), 18000)
  assert.equal(readyToLevel({ classLevel: 'Fighter 2', xp: 900 }), true)
  assert.equal(readyToLevel({ classLevel: 'Fighter 2', xp: 899 }), false)
  assert.equal(criticalFrom({ classLevel: 'Fighter 3', subclass: 'Champion' }), 19)
  assert.equal(criticalFrom({ classLevel: 'Fighter 15', subclass: 'Champion' }), 18)
})

test('0.07: subclass at level 3, feats and Ability Score Improvement when levelling', () => {
  const two = levelUp(fighter, 'Fighter', { mode: 'fixed' }, { subclass: 'Champion' }).sheet
  assert.equal(two.subclass, 'Champion')
  const asi = levelUp(fighter, 'Fighter', { mode: 'fixed' }, { feat: 'Ability Score Improvement', increase: { STR: 2 } }).sheet
  assert.equal(asi.abilities.STR, Math.min(20, fighter.abilities.STR + 2))
  const alert = levelUp(fighter, 'Fighter', { mode: 'fixed' }, { feat: 'Alert' }).sheet
  assert.equal(alert.initiative, fighter.initiative + alert.proficiency, 'Alert adds Proficiency to Initiative')
  const defense = levelUp(fighter, 'Fighter', { mode: 'fixed' }, { feat: 'Defense' }).sheet
  assert.equal(defense.ac, fighter.ac + 1, 'Defense: +1 AC in Chain Mail')
})
