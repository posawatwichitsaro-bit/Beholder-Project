import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { addDice, catalogSpells, scaledDice } from '../shared/spells.ts'

const spells = catalogSpells(JSON.parse(readFileSync(new URL('../public/data/srd-spells.json', import.meta.url), 'utf8')))
const spell = (name: string) => {
  const found = spells.find(item => item.name === name)
  assert.ok(found, name + ' is in the catalog')
  return found
}

test('every SRD 5.2.1 spell is extracted with its fields', () => {
  assert.equal(spells.length, 339)
  const byLevel = spells.reduce<Record<number, number>>((count, item) => ({ ...count, [item.level]: (count[item.level] ?? 0) + 1 }), {})
  assert.deepEqual(byLevel, { 0: 27, 1: 57, 2: 57, 3: 42, 4: 34, 5: 38, 6: 31, 7: 20, 8: 17, 9: 16 })
  for (const item of spells) {
    assert.ok(item.castingTime && item.range && item.components && item.duration, item.name + ' has its four fields')
    assert.ok(item.classes.length, item.name + ' has classes')
    assert.ok(!/Casting Time|Components?:|Duration:/.test(item.range + item.components + item.castingTime), item.name + ' fields are not mixed up')
  }
  assert.equal(new Set(spells.map(item => item.id)).size, spells.length, 'ids are unique')
})

// Checked by hand against the SRD PDF (pages 107–175).
test('twenty spells match the PDF', () => {
  const checks: [string, Record<string, unknown>][] = [
    ['Acid Splash', { level: 0, school: 'Evocation', save: 'DEX', damage: '1d6', damageType: 'acid', cantripScaling: '1d6', area: { shape: 'Sphere', size: 5 } }],
    ['Fire Bolt', { level: 0, attack: 'ranged', damage: '1d10', damageType: 'fire', cantripScaling: '1d10' }],
    ['Chill Touch', { level: 0, attack: 'melee', damage: '1d10', damageType: 'necrotic', range: 'Touch' }],
    ['Sacred Flame', { level: 0, save: 'DEX', damage: '1d8', damageType: 'radiant' }],
    ['Eldritch Blast', { level: 0, attack: 'ranged', damage: '1d10', damageType: 'force' }],
    ['Guidance', { level: 0, concentration: true }],
    ['Magic Missile', { level: 1, damage: '1d4+1', damageType: 'force' }],
    ['Burning Hands', { level: 1, save: 'DEX', half: true, damage: '3d6', area: { shape: 'Cone', size: 15 }, perSlot: '1d6' }],
    ['Cure Wounds', { level: 1, healing: '2d8', perSlot: '2d8' }],
    ['Healing Word', { level: 1, healing: '2d4', castingTime: 'Bonus Action' }],
    ['Guiding Bolt', { level: 1, attack: 'ranged', damage: '4d6', damageType: 'radiant', perSlot: '1d6' }],
    ['Detect Magic', { level: 1, ritual: true, concentration: true }],
    ['Shield', { level: 1, duration: '1 round' }],
    ['Hold Person', { level: 2, save: 'WIS', condition: 'Paralyzed', concentration: true }],
    ['Acid Arrow', { level: 2, attack: 'ranged', damage: '4d4', perSlot: '1d4' }],
    ['Fireball', { level: 3, save: 'DEX', half: true, damage: '8d6', damageType: 'fire', area: { shape: 'Sphere', size: 20 }, perSlot: '1d6' }],
    ['Lightning Bolt', { level: 3, save: 'DEX', damage: '8d6', damageType: 'lightning', area: { shape: 'Line', size: 100 } }],
    ['Banishment', { level: 4, save: 'CHA', condition: 'Incapacitated', concentration: true }],
    ['Cone of Cold', { level: 5, save: 'CON', damage: '8d8', damageType: 'cold', area: { shape: 'Cone', size: 60 } }],
    ['Power Word Kill', { level: 9, range: '60 feet' }]
  ]
  for (const [name, expected] of checks) {
    const actual = spell(name) as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, name + ' ' + key)
  }
  assert.deepEqual(spell('Cure Wounds').classes, ['Bard', 'Cleric', 'Druid', 'Paladin', 'Ranger'])
})

test('damage and healing scale with the slot, cantrips with the character level', () => {
  const fireball = spell('Fireball')
  assert.equal(scaledDice(fireball, fireball.damage, 3, 5), '8d6')
  assert.equal(scaledDice(fireball, fireball.damage, 5, 9), '10d6')
  const cure = spell('Cure Wounds')
  assert.equal(scaledDice(cure, cure.healing, 2, 3), '4d8')
  const bolt = spell('Fire Bolt')
  assert.equal(scaledDice(bolt, bolt.damage, 0, 4), '1d10')
  assert.equal(scaledDice(bolt, bolt.damage, 0, 11), '3d10')
  assert.equal(scaledDice(bolt, bolt.damage, 0, 17), '4d10')
  assert.equal(addDice('1d4+1', '1d6'), '1d4+1+1d6')
})
