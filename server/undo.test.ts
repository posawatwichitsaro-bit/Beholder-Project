import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blankSheet } from '../shared/model.ts'
import type { Actor, Member, Room } from '../shared/model.ts'
import { applyCommand } from './commands.ts'

function table() {
  const dm: Member = { id: 'dm', name: 'DM', role: 'dm' }
  const mira: Member = { id: 'm', name: 'Mira', role: 'player' }
  const hero: Actor = { ...blankSheet(), id: 'hero', ownerId: 'm', name: 'Hero', hp: 20, maxHp: 20, slots: 'L1 2/2', spellAttack: 50,
    inventory: [{ id: 'rope', name: 'Rope', description: '' }] }
  const goblin: Actor = { ...blankSheet('monster'), id: 'gob', ownerId: 'dm', name: 'Goblin', hp: 7, maxHp: 7, ac: 1, attack: 50, damage: '1d4' }
  const room: Room = {
    id: 'r', name: 'R', invite: 'i', revision: 0, activeSceneId: 's', members: [dm, mira], templates: [], rolls: [], actors: [hero, goblin],
    settings: { autoDamage: true },
    scenes: [{ id: 's', name: 'Hall', cell: 48, originX: 0, originY: 0,
      tokens: [{ id: 't1', actorId: 'hero', x: 0, y: 0, role: 'character' }, { id: 't2', actorId: 'gob', x: 1, y: 0 }] }]
  }
  const run = (who: Member, body: Record<string, unknown>) => applyCommand(room, who, { sceneId: 's', ...body })
  return { dm, mira, hero, goblin, room, run }
}

test('a step someone else built on is dropped with a message, and the next undo goes one step further back', () => {
  const { dm, mira, room, run } = table()
  run(mira, { type: 'move', tokenId: 't1', x: 0, y: 3 })
  run(mira, { type: 'move', tokenId: 't1', x: 0, y: 5 })
  run(dm, { type: 'move', tokenId: 't1', x: 4, y: 4 })
  const blocked = run(mira, { type: 'undo' }) as { notice: string }
  assert.match(blocked.notice, /ย้อนการเดินไม่ได้ เพราะมีคนแก้ต่อแล้ว/)
  assert.deepEqual([room.scenes[0].tokens[0].x, room.scenes[0].tokens[0].y], [4, 4], "the DM's move is kept")
  assert.match((run(mira, { type: 'undo' }) as { notice: string }).notice, /ไม่ได้/, 'the older move is blocked too (same token)')
  assert.throws(() => run(mira, { type: 'undo' }), /ไม่มีอะไรให้ย้อน/)
})

test("a player's dice stand: undoing a spell attack gives back the slot, not the damage or the roll", () => {
  const { mira, hero, goblin, room, run } = table()
  run(mira, { type: 'sheetRoll', rollType: 'spellAttack', actorId: 'hero', targetId: 'gob', slotLevel: 1, formula: '1d4' })
  assert.equal(hero.slots, 'L1 1/2')
  const hp = goblin.hp
  const rolls = room.rolls.length
  run(mira, { type: 'undo' })
  assert.equal(hero.slots, 'L1 2/2', 'the slot comes back')
  assert.equal(goblin.hp, hp, 'the damage the roll did stays')
  assert.equal(room.rolls.length, rolls)
  assert.ok(!room.rolls.some(roll => roll.undone))
})

test('the DM can take back their own roll: it stays in the log marked undone, and the HP comes back', () => {
  const { dm, hero, room, run } = table()
  run(dm, { type: 'sheetRoll', rollType: 'attack', actorId: 'gob', targetId: 'hero' })
  assert.ok(hero.hp < 20, 'the hit landed (auto damage)')
  run(dm, { type: 'undo' })
  assert.equal(hero.hp, 20)
  assert.ok(room.rolls.every(roll => roll.undone), 'both the attack and its damage roll are struck through')
})

test('undo covers inventory, removed tokens and walls; a new round or another scene clears everyone', () => {
  const { dm, mira, hero, room, run } = table()
  run(mira, { type: 'inventoryRemove', actorId: 'hero', itemId: 'rope' })
  run(mira, { type: 'undo' })
  assert.deepEqual(hero.inventory!.map(item => item.name), ['Rope'])
  run(dm, { type: 'removeToken', tokenId: 't2' })
  assert.equal(room.scenes[0].tokens.length, 1)
  run(dm, { type: 'undo' })
  assert.deepEqual(room.scenes[0].tokens.map(token => token.id).sort(), ['t1', 't2'])
  run(dm, { type: 'walls', add: [{ a: { x: 0, y: 0 }, b: { x: 3, y: 0 } }] })
  run(dm, { type: 'undo' })
  assert.equal(room.scenes[0].vision!.walls!.length, 0)
  run(mira, { type: 'move', tokenId: 't1', x: 2, y: 0 })
  run(dm, { type: 'combat', participants: ['hero', 'gob'] })
  run(dm, { type: 'next' }); run(dm, { type: 'next' })
  assert.equal(room.undoSteps, undefined, 'round 2 started: everyone starts fresh')
  run(mira, { type: 'move', tokenId: 't1', x: 3, y: 0 })
  applyCommand(room, dm, { type: 'scene', name: 'Yard', cell: 48, originX: 0, originY: 0 })
  const yard = room.scenes.find(scene => scene.name === 'Yard')!
  run(dm, { type: 'activate', sceneId: yard.id })
  assert.equal(room.undoSteps, undefined, 'the table moved to another scene')
})
