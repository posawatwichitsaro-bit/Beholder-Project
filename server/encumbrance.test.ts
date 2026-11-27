import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blankSheet } from '../shared/model.ts'
import { carryingLoad, itemWeight } from '../shared/encumbrance.ts'
import { magicFromBase, withMagicBonus } from '../shared/itemCatalog.ts'
import { calculatedSheet } from '../shared/characterStats.ts'

test('carrying capacity is STR × 15 lb by size; coins weigh 50 to the pound; over it, Speed is 5 ft', () => {
  const sheet = { ...blankSheet(), abilities: { ...blankSheet().abilities, STR: 10 }, speed: 30, inventory: [
    { id: 'a', name: 'Chain Mail', description: '', weight: 55 },
    { id: 'b', name: 'gp', description: '', quantity: 100 },
    { id: 'c', name: 'Torch', description: '', weight: 1, quantity: 10 },
    { id: 'd', name: 'Mystery', description: '' }
  ] }
  assert.equal(itemWeight({ name: 'Gold coins', quantity: 25 }), .5)
  assert.deepEqual(carryingLoad(sheet), { carried: 67, capacity: 150, over: false, speed: 30 })
  assert.equal(carryingLoad({ ...sheet, size: 'Large' }).capacity, 300)
  assert.equal(carryingLoad({ ...sheet, size: 'Tiny' }).capacity, 75)
  const heavy = carryingLoad({ ...sheet, inventory: [...sheet.inventory, { id: 'e', name: 'Anvil', description: '', weight: 100 }] })
  assert.equal(heavy.over, true)
  assert.equal(heavy.speed, 5)
})

test('+N weapons add to attack and damage; +N armor and shields add to AC without stacking', () => {
  assert.deepEqual(withMagicBonus({ bonus: 5, damage: '1d8+3' }, 2), { bonus: 7, damage: '1d8+5' })
  assert.deepEqual(withMagicBonus({ bonus: 2, damage: '1d6-1' }, 1), { bonus: 3, damage: '1d6' })
  assert.deepEqual(withMagicBonus({ bonus: 2, damage: '1d6' }, 3), { bonus: 5, damage: '1d6+3' })
  const longsword = { id: 'srd-5.2.1:equipment:longsword', name: 'Longsword', category: 'weapon', weightLb: 3 } as Parameters<typeof magicFromBase>[1]
  const made = magicFromBase({ name: 'Weapon, +2', description: '', ref: 'srd-5.2.1:magic:weapon-1-2-or-3', rarity: 'Rare' }, longsword, 2)
  assert.equal(made.name, 'Longsword +2')
  assert.equal(made.base, longsword.id)
  assert.equal(made.weight, 3)
  const sheet = { ...blankSheet(), abilities: { ...blankSheet().abilities, DEX: 14 } }
  const ac = (armor: object) => calculatedSheet({ ...sheet, calculations: { armor: { base: 14, dex: 'medium', shield: true, bonus: 0, ...armor } } }).ac
  assert.equal(ac({}), 18)
  assert.equal(ac({ armorMagic: 1, shieldMagic: 2 }), 21)
  assert.equal(ac({ shield: false, shieldMagic: 2 }), 16, 'a shield bonus needs the shield')
})
