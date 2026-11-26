import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isStandardArray, pointBuyCost, rollAbilityScores, speciesLine, withBackground } from './origins.ts'
import { buildCharacter, suggestedAbilities } from './wizard.ts'

const base = { STR: 15, DEX: 14, CON: 13, INT: 8, WIS: 10, CHA: 12 }

test('the background raises its own abilities, +2/+1 or +1 each, never past 20', () => {
  assert.deepEqual(withBackground(base, 'Soldier', { mode: 'two-one', plus2: 'STR', plus1: 'CON' }), { ...base, STR: 17, CON: 14 })
  assert.deepEqual(withBackground(base, 'Soldier', { mode: 'three' }), { ...base, STR: 16, DEX: 15, CON: 14 })
  assert.deepEqual(withBackground(base, 'Soldier', { mode: 'two-one', plus2: 'CHA', plus1: 'STR' }), { ...base, STR: 16 }, 'CHA is not a Soldier ability')
  assert.equal(withBackground({ ...base, STR: 19 }, 'Soldier', { mode: 'two-one', plus2: 'STR', plus1: 'DEX' }).STR, 20)
  assert.deepEqual(withBackground(base, undefined, { mode: 'three' }), base)
})

test('Point Buy costs follow the 27-point table; the Standard Array costs exactly 27', () => {
  assert.equal(pointBuyCost({ STR: 15, DEX: 14, CON: 13, INT: 12, WIS: 10, CHA: 8 }), 27)
  assert.equal(pointBuyCost({ STR: 15, DEX: 15, CON: 15, INT: 8, WIS: 8, CHA: 8 }), 27)
  assert.equal(pointBuyCost({ STR: 16, DEX: 8, CON: 8, INT: 8, WIS: 8, CHA: 8 }), Infinity, '16 is not allowed before the background')
  assert.ok(isStandardArray(suggestedAbilities('Rogue')))
})

test('4d6 keeps the highest three dice, six scores sorted high to low', () => {
  const faces = [6, 6, 6, 1, 1, 2, 3, 4, 5, 5, 5, 5, 1, 1, 1, 1, 2, 2, 2, 6, 4, 4, 4, 4]
  let index = 0
  assert.deepEqual(rollAbilityScores(() => faces[index++]), [18, 15, 12, 10, 9, 3])
})

test('the wizard applies species and background: size, speed, darkvision, skills, Dwarven Toughness', () => {
  const dwarf = buildCharacter({
    name: 'Bram', species: 'Dwarf', background: 'Soldier', backgroundBonus: { mode: 'two-one', plus2: 'STR', plus1: 'CON' },
    className: 'Fighter', level: 3, abilities: suggestedAbilities('Fighter'), armor: 'Chain Mail', shield: false, weapons: ['Longsword']
  })
  assert.deepEqual([dwarf.abilities.STR, dwarf.abilities.CON], [17, 15])
  assert.equal(dwarf.characterDetails?.species, 'Dwarf · Darkvision 120 ft.')
  assert.equal(dwarf.characterDetails?.background, 'Soldier · Savage Attacker · Gaming Set')
  assert.deepEqual(Object.keys(dwarf.skillChecks ?? {}), ['Athletics', 'Intimidation'])
  assert.equal(dwarf.maxHp, (10 + 2) + 2 * (6 + 2) + 3, 'Fighter 3, CON 15 (+2), plus 1 per level from Dwarven Toughness')
  assert.equal(dwarf.attack, 2 + 3, 'Longsword uses the raised STR 17')

  const halfling = buildCharacter({ name: 'Pip', species: 'Halfling', className: 'Rogue', level: 1, abilities: suggestedAbilities('Rogue'), armor: 'Leather', shield: false, weapons: [] })
  assert.deepEqual([halfling.size, halfling.speed], ['Small', 30])
  const goliath = buildCharacter({ name: 'Grom', species: 'Goliath', className: 'Barbarian', level: 1, abilities: suggestedAbilities('Barbarian'), armor: 'Unarmored', shield: false, weapons: [] })
  assert.equal(goliath.speed, 35)
  assert.equal(speciesLine('Aasimar'), 'Aasimar', 'species outside the SRD stay free text')
})
