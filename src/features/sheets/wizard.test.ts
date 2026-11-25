import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCharacter, spellSlotsFor, suggestedAbilities, weaponAttack } from './wizard.ts'

test('class suggestions place the standard array in priority order', () => {
  assert.deepEqual(suggestedAbilities('Wizard'), { INT: 15, CON: 14, DEX: 13, WIS: 12, CHA: 10, STR: 8 })
  assert.deepEqual(Object.values(suggestedAbilities('Rogue')).sort((a, b) => b - a), [15, 14, 13, 12, 10, 8])
})

test('a level 3 wizard gets SRD hit points, armor class, saves and spell numbers', () => {
  const sheet = buildCharacter({
    name: ' Lyra ', className: 'Wizard', level: 3, abilities: suggestedAbilities('Wizard'),
    armor: 'Unarmored', shield: false, weapons: ['Quarterstaff', 'Dagger']
  })
  assert.equal(sheet.name, 'Lyra')
  assert.equal(sheet.classLevel, 'Wizard 3')
  assert.equal(sheet.maxHp, 20, 'level 1: 6 + CON 2; levels 2–3: (6/2 + 1 + 2) each')
  assert.equal(sheet.hp, 20)
  assert.equal(sheet.ac, 11, '10 + DEX 1')
  assert.equal(sheet.proficiency, 2)
  assert.equal(sheet.spellAttack, 4, 'prof 2 + INT 2')
  assert.equal(sheet.spellDC, 12)
  assert.deepEqual(Object.keys(sheet.savingThrows!).sort(), ['INT', 'WIS'])
  assert.equal(sheet.attack, 1, 'Quarterstaff uses STR −1')
  assert.equal(sheet.damage, '1d6-1')
  assert.deepEqual(sheet.attacks, [{ name: 'Dagger', bonus: 3, damage: '1d4+1', damageKind: 'piercing' }], 'Dagger is finesse: DEX +1')
})

test('spell slots follow the SRD tables for full, half and pact casters', () => {
  assert.equal(spellSlotsFor('Wizard', 3), 'L1 4/4, L2 2/2')
  assert.equal(spellSlotsFor('Cleric', 1), 'L1 2/2')
  assert.equal(spellSlotsFor('Paladin', 5), 'L1 4/4, L2 2/2', 'half caster uses the full table at half level, rounded up')
  assert.equal(spellSlotsFor('Warlock', 5), 'L3 2/2')
  assert.equal(spellSlotsFor('Fighter', 10), '')
  assert.equal(buildCharacter({ name: 'Lyra', className: 'Wizard', level: 3, abilities: suggestedAbilities('Wizard'), armor: 'Unarmored', shield: false, weapons: [] }).slots, 'L1 4/4, L2 2/2')
})

test('armour, shields and ranged weapons follow their rules', () => {
  const scores = { STR: 16, DEX: 14, CON: 14, INT: 8, WIS: 12, CHA: 10 }
  const fighter = buildCharacter({ name: 'Bram', className: 'Fighter', level: 5, abilities: scores, armor: 'Chain Mail', shield: true, weapons: [] })
  assert.equal(fighter.ac, 18, 'Chain Mail 16 ignores DEX, shield +2')
  assert.equal(fighter.proficiency, 3)
  assert.equal(fighter.maxHp, 10 + 2 + 4 * 8, 'd10: 12 at level 1, then 8 per level')
  assert.equal(fighter.attack, 6, 'no weapon: unarmed strike, prof 3 + STR 3')
  const scale = buildCharacter({ name: 'Kael', className: 'Ranger', level: 1, abilities: scores, armor: 'Scale Mail', shield: false, weapons: [] })
  assert.equal(scale.ac, 16, 'medium armour adds at most +2 DEX')
  assert.deepEqual(weaponAttack('Longbow', scores, 2), { name: 'Longbow', bonus: 4, damage: '1d8+2', damageKind: 'piercing' })
})
