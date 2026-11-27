import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blankSheet } from '../shared/model.ts'
import type { Actor, Member, Room } from '../shared/model.ts'
import { applyCommand, gridFeet, snapshot } from './commands.ts'

function table() {
  const dm: Member = { id: 'dm', name: 'DM', role: 'dm' }
  const mira: Member = { id: 'm', name: 'Mira', role: 'player' }
  const hero: Actor = { ...blankSheet(), id: 'hero', ownerId: 'm', name: 'Hero', hp: 20, maxHp: 20 }
  const goblin: Actor = { ...blankSheet('monster'), id: 'gob', ownerId: 'dm', name: 'Goblin', hp: 7, maxHp: 7 }
  const room: Room = {
    id: 'r', name: 'R', invite: 'i', revision: 0, activeSceneId: 's', members: [dm, mira], templates: [], rolls: [], actors: [hero, goblin],
    scenes: [{ id: 's', name: 'Hall', cell: 48, originX: 0, originY: 0,
      tokens: [{ id: 't1', actorId: 'hero', x: 0, y: 0, role: 'character' }, { id: 't2', actorId: 'gob', x: 6, y: 0 }],
      combat: { round: 1, turn: 0, order: [{ actorId: 'hero', initiative: 15 }, { actorId: 'gob', initiative: 10 }] } }]
  }
  const run = (who: Member, body: Record<string, unknown>) => applyCommand(room, who, { sceneId: 's', ...body })
  return { dm, mira, hero, goblin, room, run }
}

test('moves during your turn count against your Speed; diagonals are 5 ft; the next turn starts fresh', () => {
  const { dm, mira, room, run } = table()
  assert.equal(gridFeet({ x: 0, y: 0 }, { x: 3, y: 2 }), 15)
  run(mira, { type: 'move', tokenId: 't1', x: 3, y: 2 })
  run(mira, { type: 'stepCharacter', tokenId: 't1', dx: 1, dy: 0 })
  assert.equal(room.scenes[0].combat!.moved!.feet, 20)
  assert.equal(room.scenes[0].combat!.moved!.actorId, 'hero')
  run(dm, { type: 'move', tokenId: 't2', x: 7, y: 0 })
  assert.equal(room.scenes[0].combat!.moved!.feet, 20, "moving someone whose turn it isn't is not counted")
  run(mira, { type: 'endTurn', actorId: 'hero' })
  run(dm, { type: 'move', tokenId: 't2', x: 5, y: 0 })
  assert.deepEqual([room.scenes[0].combat!.moved!.actorId, room.scenes[0].combat!.moved!.feet], ['gob', 10])
  assert.equal(snapshot(room, mira).scenes[0].combat!.moved!.feet, 10, 'everyone sees the count')
})

test('undo is per person: each takes back only their own steps, newest first, and players never see the lists', () => {
  const { dm, mira, goblin, room, run } = table()
  run(mira, { type: 'move', tokenId: 't1', x: 2, y: 0 })
  run(dm, { type: 'adjustHp', actorId: 'gob', amount: 5, mode: 'damage' })
  assert.equal(goblin.hp, 2)
  assert.deepEqual(run(dm, { type: 'undo' }), { notice: 'ย้อนการปรับ HPแล้ว' })
  assert.equal(goblin.hp, 7)
  assert.equal(room.scenes[0].tokens[0].x, 2, "the DM's undo leaves Mira's move alone")
  assert.throws(() => run(dm, { type: 'undo' }), /ไม่มีอะไรให้ย้อน/)
  run(mira, { type: 'undo' })
  assert.equal(room.scenes[0].tokens[0].x, 0, 'Mira takes back her own move')
  assert.equal(room.scenes[0].combat!.moved, undefined, 'and the feet it used')
  assert.equal((snapshot(room, mira) as unknown as { undoSteps?: unknown }).undoSteps, undefined)
  run(dm, { type: 'adjustHp', actorId: 'gob', amount: 20, mode: 'damage' })
  assert.equal(goblin.life, 'dead')
  run(dm, { type: 'undo' })
  assert.deepEqual([goblin.hp, goblin.life], [7, 'active'], 'a kill comes back to life')
})
