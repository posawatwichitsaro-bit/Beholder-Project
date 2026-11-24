import { test } from 'node:test'
import assert from 'node:assert/strict'
import { armorPresets, bonusForCheck, fixedMaxHp } from '../shared/characterStats.ts'
import { parseBeyondFields } from '../shared/dndBeyond.ts'
import { blankSheet } from '../shared/model.ts'
import { parseSheet } from './commands.ts'
import { rollDice } from './rules.ts'

test('PC formulas calculate multiclass HP, armor, proficiency and spells on the server', () => {
  assert.equal(fixedMaxHp({ classes: [{ die: 10, levels: 1 }, { die: 6, levels: 2 }], bonus: 1 }, 2), 25)
  const base = blankSheet()
  base.abilities = { ...base.abilities, DEX: 8, CON: 15, WIS: 18 }
  const saved = parseSheet({ ...base, name: 'Test character', maxHp: 17, ac: 40, hp: 8, calculations: {
    hp: { classes: [{ die: 8, levels: 11 }], bonus: 0 },
    armor: { ...armorPresets.Plate, shield: true, bonus: 0 }, initiativeBonus: 4, spellAbility: 'WIS'
  } }, 'pc')
  assert.deepEqual([saved.maxHp, saved.hp, saved.ac, saved.proficiency, saved.initiative, saved.spellDC, saved.spellAttack],
    [80, 8, 20, 4, 3, 16, 8])
  const medium = parseSheet({ ...saved, calculations: { armor: { ...armorPresets.Breastplate, shield: false, bonus: 0 } } }, 'pc')
  assert.equal(medium.ac, 13)
  const highDex = parseSheet({ ...medium, abilities: { ...medium.abilities, DEX: 20 } }, 'pc')
  assert.equal(highDex.ac, 16)
  assert.throws(() => parseSheet({ ...saved, calculations: {
    hp: { classes: [{ die: 8, levels: 15 }, { die: 8, levels: 6 }], bonus: 0 }
  } }, 'pc'), /20/)
})

test('D&D Beyond widgets preserve explicit HP zero and import usable attacks, bonuses and equipment', () => {
  const { sheet, warnings } = parseBeyondFields([{
    CharacterName: 'Synthetic PDF character', 'CLASS  LEVEL': 'Cleric 5', STR: '16', DEX: '8', CON: '14', INT: '10', WIS: '18', CHA: '10',
    AC: '18', MaxHP: '38', CurrentHP: '0', TempHP: '--', ProfBonus: '+3', Init: '+2', Speed: '30 ft. (Walking)',
    Investigation: '+6', InvestigationProf: 'E', 'ST Wisdom': '+7', WisProf: '•',
    'Wpn Name': 'Hammer', 'Wpn1 AtkBonus': '+6', 'Wpn1 Damage': '1d6+3 Bludgeoning', 'Wpn Notes 1': '+2d6 Radiant',
    'Wpn Name 2': 'Unarmed Strike', 'Wpn2 AtkBonus ': '+6', 'Wpn2 Damage ': '4 Bludgeoning',
    'Eq Name0': 'Thieves’ Tools', 'Eq Qty0': '1', 'Eq Name1': 'Oil', 'Eq Qty1': '0'
  }, {
    spellSaveDC0: '15', spellAtkBonus0: '+7', spellName0: 'Light', spellSlotHeader1: '4 Slots OOOO', spellHeader1: '=== 1st LEVEL ==='
  }])
  assert.deepEqual(warnings, [])
  assert.equal(sheet.hp, 0)
  assert.equal(sheet.ac, 18)
  assert.equal(sheet.spellDC, 15)
  assert.equal(sheet.slots, 'Lv1: 4')
  assert.equal(sheet.inventory?.[0].tool, 'thievesTools')
  assert.equal(sheet.inventory?.length, 1)
  assert.equal(bonusForCheck(sheet, sheet.skillChecks!.Investigation!), 6)
  assert.equal(bonusForCheck(sheet, sheet.savingThrows!.WIS!), 7)
  assert.equal(sheet.attacks?.[0].notes, 'Bludgeoning · +2d6 Radiant')
  assert.equal(rollDice(sheet.attacks![1].damage, () => 1, true).total, 4)
  assert.throws(() => parseBeyondFields([]), /Character Name/)
  assert.equal(parseSheet(sheet, 'pc').attacks?.length, 2)
})
