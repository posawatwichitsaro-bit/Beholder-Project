import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { blankSheet } from '../shared/model.ts'
import type { Actor, Member, Room } from '../shared/model.ts'
import { actionCount, attacksPerAction, extraAttacks, multiattack } from '../shared/economy.ts'
import { applyCommand, snapshot } from './commands.ts'

test('Multiattack from stat blocks and Extra Attack from class levels; the sheet number wins', () => {
  assert.equal(multiattack('Multiattack. The goblin boss makes two attacks, using Scimitar or Shortbow in any combination.'), 2)
  assert.equal(multiattack('Multiattack. The bear makes one Bite attack and one Claw\nattack.'.replace('\n', '\n')), 2)
  assert.equal(multiattack('Multiattack. The dragon makes three Rend attacks. It can replace one attack with a use of Spellcasting.'), 3)
  assert.equal(multiattack('Bite. Melee Attack Roll'), undefined)
  assert.equal(extraAttacks('Fighter 11 / Wizard 2'), 3)
  assert.equal(extraAttacks('Paladin 5'), 2)
  assert.equal(extraAttacks('Rogue 9'), 1)
  assert.equal(attacksPerAction({ classLevel: 'Fighter 5', attacksPerAction: 4 }), 4)
  const catalog = JSON.parse(readFileSync(new URL('../public/data/srd-monsters.json', import.meta.url), 'utf8'))
  const monsters = (catalog.monsters ?? catalog) as { statBlock: string }[]
  const withMulti = monsters.filter(monster => /Multiattack\./.test(monster.statBlock))
  const read = withMulti.filter(monster => multiattack(monster.statBlock))
  assert.ok(read.length >= withMulti.length - 2, read.length + ' of ' + withMulti.length + ' Multiattacks read')
  assert.deepEqual(actionCount({ weaponAttacks: 3, spellActions: 0, manualActions: 0, extraActions: 0, bonus: 0, reaction: false, disengaged: false }, 2), { used: 2, allowed: 1 })
})

test('in a fight: weapon attacks share an Action, a spell takes one, Action Surge adds one, Reaction comes back on your turn', () => {
  const dm: Member = { id: 'dm', name: 'DM', role: 'dm' }
  const mira: Member = { id: 'm', name: 'Mira', role: 'player' }
  const hero: Actor = { ...blankSheet(), id: 'hero', ownerId: 'm', name: 'Hero', classLevel: 'Fighter 5', attack: 99,
    resources: [{ name: 'Action Surge', max: 1, used: 0, short: 'all' }] }
  const goblin: Actor = { ...blankSheet('monster'), id: 'gob', ownerId: 'dm', name: 'Goblin', ac: 1, hp: 99, maxHp: 99, attack: 99 }
  const room: Room = { id: 'r', name: 'R', invite: 'i', revision: 0, activeSceneId: 's', members: [dm, mira], templates: [], rolls: [], actors: [hero, goblin],
    scenes: [{ id: 's', name: 'S', cell: 48, originX: 0, originY: 0, tokens: [{ id: 't1', actorId: 'hero', x: 0, y: 0 }, { id: 't2', actorId: 'gob', x: 1, y: 0 }],
      combat: { round: 1, turn: 0, order: [{ actorId: 'hero', initiative: 20 }, { actorId: 'gob', initiative: 5 }] } }] }
  const run = (who: Member, body: Record<string, unknown>) => applyCommand(room, who, { sceneId: 's', ...body })
  const use = (id: string) => room.scenes[0].combat!.uses![id]
  run(mira, { type: 'sheetRoll', rollType: 'attack', actorId: 'hero', targetId: 'gob' })
  run(mira, { type: 'sheetRoll', rollType: 'attack', actorId: 'hero', targetId: 'gob' })
  assert.deepEqual(actionCount(use('hero'), attacksPerAction(hero)), { used: 1, allowed: 1 }, 'Extra Attack: two swings, one Action')
  run(mira, { type: 'sheetRoll', rollType: 'attack', actorId: 'hero', targetId: 'gob' })
  assert.deepEqual(actionCount(use('hero'), 2), { used: 2, allowed: 1 }, 'a third swing goes over: counted, not stopped')
  run(mira, { type: 'turnAction', actorId: 'hero', kind: 'surge' })
  assert.deepEqual(actionCount(use('hero'), 2), { used: 2, allowed: 2 })
  assert.equal(hero.resources![0].used, 1)
  run(mira, { type: 'turnAction', actorId: 'hero', kind: 'bonus', value: 1 })
  assert.equal(use('hero').bonus, 1)
  // On the goblin's turn, Hero attacking is a Reaction; when Hero's turn comes round again it is fresh.
  run(dm, { type: 'next' })
  run(mira, { type: 'sheetRoll', rollType: 'attack', actorId: 'hero', targetId: 'gob' })
  assert.equal(use('hero').reaction, true)
  run(dm, { type: 'next' })
  assert.deepEqual(use('hero'), { weaponAttacks: 0, spellActions: 0, manualActions: 0, extraActions: 0, bonus: 0, reaction: false, disengaged: false })
  assert.throws(() => run(dm, { type: 'turnAction', actorId: 'hero', kind: 'surge' }), /Action Surge/)
})

test('leaving an enemy\'s reach offers it an Opportunity Attack; Disengage, a spent Reaction or a DM rearrange do not', () => {
  const dm: Member = { id: 'dm', name: 'DM', role: 'dm' }
  const mira: Member = { id: 'm', name: 'Mira', role: 'player' }
  const hero: Actor = { ...blankSheet(), id: 'hero', ownerId: 'm', name: 'Hero', hp: 30, maxHp: 30, ac: 1 }
  const ogre: Actor = { ...blankSheet('monster'), id: 'ogre', ownerId: 'dm', name: 'Ogre', attack: 99, damage: '1d4',
    monsterReference: { statBlock: 'Greatclub. Melee Attack Roll: +6, reach 5 ft.' } }
  const room: Room = { id: 'r', name: 'R', invite: 'i', revision: 0, activeSceneId: 's', members: [dm, mira], templates: [], rolls: [], actors: [hero, ogre],
    scenes: [{ id: 's', name: 'S', cell: 48, originX: 0, originY: 0, tokens: [{ id: 't1', actorId: 'hero', x: 1, y: 0 }, { id: 't2', actorId: 'ogre', x: 2, y: 0 }],
      combat: { round: 1, turn: 0, order: [{ actorId: 'hero', initiative: 20 }, { actorId: 'ogre', initiative: 5 }] } }] }
  const run = (who: Member, body: Record<string, unknown>) => applyCommand(room, who, { sceneId: 's', ...body })
  const prompts = () => room.scenes[0].combat!.prompts ?? []
  run(dm, { type: 'move', tokenId: 't1', x: 0, y: 3 })
  assert.equal(prompts().length, 0, "the DM rearranging Mira's hero is not her moving")
  run(dm, { type: 'move', tokenId: 't1', x: 1, y: 0 })
  run(mira, { type: 'turnAction', actorId: 'hero', kind: 'disengage', value: true })
  run(mira, { type: 'move', tokenId: 't1', x: 0, y: 3 })
  assert.equal(prompts().length, 0, 'Disengage')
  run(mira, { type: 'turnAction', actorId: 'hero', kind: 'disengage', value: false })
  run(mira, { type: 'move', tokenId: 't1', x: 1, y: 0 })
  assert.equal(prompts().length, 0, 'moving into reach offers nothing')
  run(mira, { type: 'move', tokenId: 't1', x: 0, y: 3 })
  assert.equal(prompts().length, 1)
  assert.equal(snapshot(room, mira).scenes[0].combat!.prompts!.length, 0, "Mira doesn't see the Ogre's card")
  const before = hero.hp
  run(dm, { type: 'opportunity', promptId: prompts()[0].id, attack: true })
  assert.ok(hero.hp < before || room.rolls.some(roll => roll.targetId === 'hero'), 'the Ogre swings')
  assert.equal(room.scenes[0].combat!.uses!.ogre.reaction, true, 'and spends its Reaction')
  run(mira, { type: 'move', tokenId: 't1', x: 1, y: 0 })
  run(mira, { type: 'move', tokenId: 't1', x: 0, y: 3 })
  assert.equal(prompts().length, 0, 'no Reaction left, no card')
})
