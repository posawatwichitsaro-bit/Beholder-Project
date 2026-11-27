import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Member, Room } from '../shared/model.ts'
import { catalogMonsters, monsterSheet, readSkills } from '../shared/monsterManual.ts'
import { applyCommand } from './commands.ts'

const catalog = catalogMonsters(JSON.parse(readFileSync(new URL('../public/data/srd-monsters.json', import.meta.url), 'utf8')))
const sheetOf = (name: string) => monsterSheet(catalog.find(monster => monster.name === name)!)

test('every SRD catalog monster becomes a sheet with its stated saves, skills and attacks', () => {
  assert.equal(catalog.length, 330)
  for (const monster of catalog) {
    const sheet = monsterSheet(monster)
    for (const [ability, check] of Object.entries(sheet.savingThrows ?? {})) {
      const total = Math.floor((sheet.abilities[ability as 'STR'] - 10) / 2) + Math.floor(sheet.proficiency * check!.training) + check!.adjustment
      assert.equal(total, monster.savingThrows![ability as 'STR'], monster.name + ' ' + ability + ' save')
    }
  }
  const goblin = sheetOf('Goblin Warrior')
  assert.deepEqual(goblin.attacks?.map(attack => [attack.name, attack.bonus, attack.damage, attack.damageKind]),
    [['Scimitar', 4, '1d6+2', 'slashing'], ['Shortbow', 4, '1d6+2', 'piercing']])
  assert.deepEqual(goblin.skillChecks, { Stealth: { ability: 'DEX', training: 2, adjustment: 0 } }, 'Stealth +6 at PB 2 is expertise')
  assert.equal(goblin.savingThrows, undefined, 'no trained saves when every save equals the modifier')
  assert.deepEqual(goblin.monsterReference && { id: goblin.monsterReference.id, page: goblin.monsterReference.page },
    { id: 'srd-5.2.1:goblin-warrior', page: 290 })

  const dragon = sheetOf('Adult Red Dragon')
  assert.equal(dragon.saves, 'DEX +6, WIS +7')
  assert.equal(dragon.characterDetails?.defenses, 'Immunities Fire')
})

test('skill text keeps odd bonuses as an adjustment instead of guessing a proficiency', () => {
  const scores = { STR: 10, DEX: 14, CON: 10, INT: 10, WIS: 12, CHA: 10 }
  assert.deepEqual(readSkills('Perception +3, Stealth +5, Made Up +9', scores, 2), {
    Perception: { ability: 'WIS', training: 1, adjustment: 0 },
    Stealth: { ability: 'DEX', training: 0, adjustment: 3 }
  })
})

test('the older bare-array catalog still loads', () => {
  const old = [{ name: 'Rat', size: 'Tiny', type: 'Beast', cr: '0', ac: 10, hp: 1, speed: 20,
    abilities: { STR: 2, DEX: 11, CON: 9, INT: 2, WIS: 10, CHA: 4 }, statBlock: 'Tiny Beast' }]
  assert.equal(catalogMonsters(old)[0].name, 'Rat')
  assert.throws(() => catalogMonsters({ schemaVersion: 2, monsters: [] }), /รูปแบบ/)
})

test('the server keeps trained saves and the catalog reference on a monster template', () => {
  const dm: Member = { id: 'dm', name: 'DM', role: 'dm' }
  const room: Room = { id: 'r', name: 'R', invite: 'i', revision: 0, members: [dm], scenes: [], actors: [], templates: [], rolls: [] }
  applyCommand(room, dm, { type: 'template', sheet: sheetOf('Adult Red Dragon') })
  const saved = room.templates[0].sheet
  assert.deepEqual(saved.savingThrows?.WIS, { ability: 'WIS', training: 1, adjustment: 0 })
  assert.equal(saved.skillChecks?.Perception?.training, 2)
  assert.equal(saved.monsterReference?.id, 'srd-5.2.1:adult-red-dragon')
  assert.equal(saved.portrait, '/art/srd/monsters/adult-red-dragon.webp')
  assert(readFileSync(new URL('../public' + saved.portrait, import.meta.url)).includes(Buffer.from('WEBP')))
  assert.match(saved.monsterReference?.url ?? '', /^https:\/\/www\.dndbeyond\.com\//)
  const forged = sheetOf('Goblin Warrior')
  forged.monsterReference = { ...forged.monsterReference!, url: 'https://example.com/phish' }
  assert.throws(() => applyCommand(room, dm, { type: 'template', sheet: forged }), /D&D Beyond/)
})
