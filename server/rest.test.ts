import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blankSheet } from '../shared/model.ts'
import type { Actor, Member, Room } from '../shared/model.ts'
import { classResources, hitDiceLeft, hitDicePool, readClasses, resourcesFor } from '../shared/rest.ts'
import { applyCommand } from './commands.ts'

const abilities = { STR: 16, DEX: 12, CON: 14, INT: 10, WIS: 10, CHA: 14 }

test('classes and Hit Dice come from the class line, the HP calculator or "3d8" details', () => {
  assert.deepEqual(readClasses('Fighter 3 / Wizard 1'), [{ name: 'Fighter', level: 3 }, { name: 'Wizard', level: 1 }])
  assert.deepEqual(hitDicePool({ classLevel: 'Fighter 3 / Wizard 1' }), { d10: 3, d6: 1 })
  assert.deepEqual(hitDicePool({ classLevel: 'Hero', calculations: { hp: { classes: [{ die: 8, levels: 4 }], bonus: 0 } } }), { d8: 4 })
  assert.deepEqual(hitDicePool({ classLevel: '', characterDetails: { hitDice: '3d8' } }), { d8: 3 })
  assert.deepEqual(hitDiceLeft({ classLevel: 'Rogue 5', hitDiceSpent: { d8: 2 } }), { d8: { total: 5, left: 3 } })
})

test('class resources follow the SRD tables and say what a Short Rest gives back', () => {
  assert.deepEqual(resourcesFor('Barbarian', 6, abilities), [{ name: 'Rage', max: 4, used: 0, short: 'one' }])
  assert.deepEqual(resourcesFor('Fighter', 2, abilities).map(entry => [entry.name, entry.max, entry.short]),
    [['Second Wind', 2, 'one'], ['Action Surge', 1, 'all']])
  assert.equal(resourcesFor('Bard', 4, abilities)[0].short, 'none', 'Font of Inspiration starts at level 5')
  assert.equal(resourcesFor('Bard', 5, abilities)[0].max, 2, 'Bardic Inspiration = CHA modifier')
  assert.deepEqual(resourcesFor('Monk', 1, abilities), [], 'Focus Points start at level 2')
  assert.equal(resourcesFor('Paladin', 4, abilities)[0].max, 20, 'Lay On Hands = 5 × level')
  assert.deepEqual(classResources({ classLevel: 'Cleric 2 / Rogue 3', abilities }).map(entry => entry.name), ['Channel Divinity'])
})

function table() {
  const dm: Member = { id: 'dm', name: 'DM', role: 'dm' }
  const mira: Member = { id: 'p1', name: 'Mira', role: 'player' }
  const fighter: Actor = {
    ...blankSheet(), id: 'f', ownerId: mira.id, name: 'Kael', classLevel: 'Fighter 3 / Warlock 1', abilities,
    hp: 5, maxHp: 30, tempHp: 4, slots: 'L1 0/1', conditions: 'Exhaustion 2, Prone',
    resources: [{ name: 'Second Wind', max: 2, used: 2, short: 'one' }, { name: 'Action Surge', max: 1, used: 1, short: 'all' }, { name: 'Indomitable', max: 1, used: 1, short: 'none' }]
  }
  const other: Actor = { ...blankSheet(), id: 'o', ownerId: 'p2', name: 'Lyra', hp: 0, maxHp: 10, life: 'dying' }
  const room: Room = { id: 'r', name: 'R', invite: 'i', revision: 0, members: [dm, mira], scenes: [], actors: [fighter, other], templates: [], rolls: [] }
  return { dm, mira, fighter, other, room }
}

test('spending a Hit Die heals at least 1, counts against the pool and is logged', () => {
  const { mira, fighter, room } = table()
  applyCommand(room, mira, { type: 'spendHitDie', actorId: 'f', die: 'd10' })
  assert.ok(fighter.hp >= 6 && fighter.hp <= 5 + 12)
  assert.deepEqual(fighter.hitDiceSpent, { d10: 1 })
  assert.match(room.rolls.at(-1)!.label, /Hit Die · Kael/)
  applyCommand(room, mira, { type: 'spendHitDie', actorId: 'f', die: 'd10' })
  applyCommand(room, mira, { type: 'spendHitDie', actorId: 'f', die: 'd10' })
  assert.throws(() => applyCommand(room, mira, { type: 'spendHitDie', actorId: 'f', die: 'd10' }), /ไม่มี Hit Die/)
  assert.throws(() => applyCommand(room, mira, { type: 'spendHitDie', actorId: 'o', die: 'd8' }), /ควบคุม/)
})

test('a Short Rest returns some resources and Pact slots; a Long Rest resets the rest', () => {
  const { dm, mira, fighter, other, room } = table()
  fighter.hitDiceSpent = { d10: 2 }
  applyCommand(room, mira, { type: 'rest', actorId: 'f', kind: 'short' })
  assert.deepEqual(fighter.resources!.map(entry => entry.used), [1, 0, 1])
  assert.equal(fighter.slots, 'L1 1/1', 'Warlock Pact Magic slots come back on a Short Rest')
  assert.equal(fighter.hp, 5, 'a Short Rest alone does not heal')

  const result = applyCommand(room, dm, { type: 'rest', actorIds: ['f', 'o'], kind: 'long' })
  assert.deepEqual(result, { skipped: ['Lyra'] }, 'a creature at 0 HP gets no Long Rest')
  assert.deepEqual([fighter.hp, fighter.tempHp, fighter.hitDiceSpent], [30, 0, {}])
  assert.deepEqual(fighter.resources!.map(entry => entry.used), [0, 0, 0])
  assert.equal(fighter.conditions, 'Exhaustion 1, Prone')
  assert.equal(other.hp, 0)
  assert.match(room.log!.at(-1)!.text, /Kael พักยาว/)
})

test('rests wait until the fight is over; resources save with the sheet and stay within max', () => {
  const { mira, fighter, room } = table()
  room.scenes.push({ id: 's', name: 'S', cell: 48, originX: 0, originY: 0, tokens: [], combat: { round: 1, turn: 0, order: [{ actorId: 'f', initiative: 10 }] } })
  assert.throws(() => applyCommand(room, mira, { type: 'rest', actorId: 'f', kind: 'short' }), /ต่อสู้/)
  applyCommand(room, mira, { type: 'useResource', actorId: 'f', index: 0, used: 1 })
  assert.equal(fighter.resources![0].used, 1)
  assert.throws(() => applyCommand(room, mira, { type: 'useResource', actorId: 'f', index: 0, used: 3 }))
  const { id: _id, ownerId: _owner, ...sheet } = fighter
  room.scenes = []
  applyCommand(room, mira, { type: 'sheet', actorId: 'f', sheet: { ...sheet, resources: [{ name: 'Rage', max: 3, used: 1, short: 'one' }] } })
  assert.deepEqual(fighter.resources, [{ name: 'Rage', max: 3, used: 1, short: 'one' }])
  assert.throws(() => applyCommand(room, mira, { type: 'sheet', actorId: 'f', sheet: { ...sheet, resources: [{ name: 'Rage', max: 3, used: 9, short: 'one' }] } }), /นอกช่วง/)
})
