import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { blankSheet } from '../shared/model.ts'
import type { Actor, Member, Room } from '../shared/model.ts'
import { armorFromCatalog, catalogItems, inventoryFromCatalog, itemSummary, weaponAttack } from '../shared/itemCatalog.ts'
import { calculatedSheet } from '../shared/characterStats.ts'
import { applyCommand } from './commands.ts'

const catalog = catalogItems(JSON.parse(readFileSync(new URL('../public/data/srd-items.json', import.meta.url), 'utf8')))
const find = (name: string) => catalog.find(item => item.name === name)!

test('every catalog item becomes an inventory item the server accepts', () => {
  assert.equal(catalog.length, 453)
  const dm: Member = { id: 'dm', name: 'DM', role: 'dm' }
  const hero: Actor = { ...blankSheet(), id: 'hero', ownerId: dm.id, name: 'Hero' }
  const room: Room = { id: 'r', name: 'R', invite: 'i', revision: 0, members: [dm], scenes: [], actors: [hero], templates: [], rolls: [] }
  for (const [index, template] of catalog.entries()) {
    const item = inventoryFromCatalog(template, { variant: template.details.variants?.[0]?.label })
    assert.ok(item.description.length <= 2000, template.name)
    if (index % 100 === 0) hero.inventory = []
    applyCommand(room, dm, { type: 'inventoryAdd', actorId: hero.id, item })
  }
  assert.ok(hero.inventory!.every(item => item.ref?.startsWith('srd-5.2.1:')))
  assert.throws(() => applyCommand(room, dm, { type: 'inventoryAdd', actorId: hero.id, item: { name: 'Fake', ref: 'homebrew:sword' } }), /SRD/)
})

test('variants, long text, tools and magic facts carry over', () => {
  const potion = inventoryFromCatalog(find('Potions of Healing'), { variant: 'Potion of Healing (greater)', quantity: 3 })
  assert.deepEqual([potion.name, potion.rarity, potion.quantity], ['Potion of Healing (greater)', 'Uncommon', 3])
  assert.equal(inventoryFromCatalog(find('Weapon, +1, +2, or +3'), { variant: '+2' }).name, 'Weapon, +1, +2, or +3 (+2)')
  assert.equal(inventoryFromCatalog(find('Thieves’ Tools')).tool, 'thievesTools', 'catalog Thieves’ Tools still unlock locks')
  const long = catalog.find(item => item.description.length > 2000)!
  assert.match(inventoryFromCatalog(long).description, /…\nSRD: https:\/\/media\.dndbeyond\.com\//)
  const ring = catalog.find(item => item.attunement.required)!
  assert.equal(inventoryFromCatalog(ring).attunement, true)
  assert.equal(itemSummary(find('Longsword')), 'martial melee · 1d8 slashing · Versatile (1d10) · Mastery Sap · 3 lb. · 15 gp')
})

test('catalog weapons become attacks with the right ability, and armor sets AC', () => {
  const rogue = { ...blankSheet(), abilities: { STR: 10, DEX: 16, CON: 12, INT: 10, WIS: 10, CHA: 10 }, proficiency: 2 }
  assert.deepEqual(weaponAttack(find('Dagger'), rogue), {
    name: 'Dagger', bonus: 5, damage: '1d4+3', damageKind: 'piercing', notes: 'DEX · Finesse · Light · Thrown (Range 20/60) · Mastery Nick'
  })
  assert.equal(weaponAttack(find('Greataxe'), rogue)?.bonus, 2, 'no Finesse: Strength')
  assert.equal(weaponAttack(find('Shortbow'), rogue)?.damage, '1d6+3', 'ranged: Dexterity')
  assert.equal(weaponAttack(find('Potions of Healing'), rogue), undefined)

  const leather = armorFromCatalog(find('Leather Armor'))!
  const shielded = armorFromCatalog(find('Shield'), leather)!
  assert.equal(calculatedSheet({ ...rogue, calculations: { armor: shielded } }).ac, 11 + 3 + 2)
  assert.equal(calculatedSheet({ ...rogue, calculations: { armor: armorFromCatalog(find('Breastplate'))! } }).ac, 14 + 2, 'medium armor caps Dex at +2')
  assert.equal(calculatedSheet({ ...rogue, calculations: { armor: armorFromCatalog(find('Plate Armor'), shielded)! } }).ac, 18 + 2, 'heavy armor ignores Dex, keeps the shield')
})
