import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blankSheet } from '../shared/model.ts'
import type { Actor, Member, Room } from '../shared/model.ts'
import { applyCommand } from './commands.ts'

function table() {
  const dm: Member = { id: 'dm', name: 'DM', role: 'dm' }
  const mira: Member = { id: 'p1', name: 'Mira', role: 'player' }
  const cleric: Actor = { ...blankSheet(), id: 'cleric', ownerId: 'p1', name: 'Mira' }
  const fighter: Actor = { ...blankSheet(), id: 'fighter', ownerId: 'p2', name: 'Bram' }
  const pet: Actor = { ...blankSheet(), id: 'pet', ownerId: 'p1', name: 'Owl' }
  const room: Room = {
    id: 'r', name: 'R', invite: 'i', revision: 0, activeSceneId: 'gate', members: [dm, mira], actors: [cleric, fighter, pet], templates: [], rolls: [],
    scenes: [
      { id: 'gate', name: 'Gate', cell: 48, originX: 0, originY: 0, tokens: [
        { id: 'a', actorId: 'cleric', x: 4, y: 4, role: 'character' }, { id: 'b', actorId: 'fighter', x: 5, y: 4, role: 'character' },
        { id: 'c', actorId: 'pet', x: 4, y: 5, role: 'companion' }] },
      { id: 'hall', name: 'Hall', cell: 48, originX: 0, originY: 0, tokens: [{ id: 'x', actorId: 'cleric', x: 9, y: 9, role: 'character' }] },
      { id: 'vault', name: 'Vault', cell: 48, originX: 0, originY: 0, tokens: [] }
    ]
  }
  return { dm, mira, room }
}

test('bringing the party places every missing main character, keeping their formation', () => {
  const { dm, mira, room } = table()
  applyCommand(room, dm, { type: 'bringParty', sceneId: 'vault', x: 2, y: 3 })
  const vault = room.scenes[2]
  assert.deepEqual(vault.tokens.map(token => [token.actorId, token.x, token.y, token.role]), [['cleric', 2, 3, 'character'], ['fighter', 3, 3, 'character']])
  assert.match(room.log!.at(-1)!.text, /พา Mira, Bram มาที่ Vault/)
  applyCommand(room, dm, { type: 'bringParty', sceneId: 'hall' })
  assert.deepEqual(room.scenes[1].tokens.map(token => token.actorId), ['cleric', 'fighter'], 'only the one who was missing comes; companions stay behind')
  assert.throws(() => applyCommand(room, dm, { type: 'bringParty', sceneId: 'hall' }), /ไม่มีตัวละคร/)
  assert.throws(() => applyCommand(room, mira, { type: 'bringParty', sceneId: 'vault' }), /DM/)
})

test('a second monster of the same name from the Monster Manual is numbered, and the first one too', () => {
  const { dm, room } = table()
  const goblin = { ...blankSheet('monster'), name: 'Goblin Warrior' }
  for (const x of [1, 2, 3]) applyCommand(room, dm, { type: 'place', sceneId: 'vault', kind: 'monster', sheet: goblin, x, y: 1 })
  assert.deepEqual(room.actors.filter(actor => actor.kind === 'monster').map(actor => actor.name), ['Goblin Warrior 1', 'Goblin Warrior 2', 'Goblin Warrior 3'])
  applyCommand(room, dm, { type: 'place', sceneId: 'vault', kind: 'monster', sheet: { ...goblin, name: 'Ogre (big)' }, x: 5, y: 1 })
  assert.equal(room.actors.at(-1)!.name, 'Ogre (big)', 'a unique name stays as it is, even with regex characters')
})

test('a save spell or spell attack cast with a slot level spends that slot; cantrips spend nothing', () => {
  const { room } = table()
  const mira: Member = { id: 'p1', name: 'Mira', role: 'player' }
  const cleric = room.actors.find(actor => actor.id === 'cleric')!
  cleric.slots = 'L1 1/2, L2 1/1'
  room.actors.push({ ...blankSheet('monster'), id: 'orc', ownerId: 'dm', name: 'Orc', ac: 1 })
  room.scenes[0].tokens.push({ id: 'o', actorId: 'orc', x: 6, y: 4 })
  applyCommand(room, mira, { type: 'castSave', actorId: 'cleric', targetId: 'orc', sceneId: 'gate', ability: 'DEX', label: 'Sacred Flame' })
  assert.equal(cleric.slots, 'L1 1/2, L2 1/1', 'a cantrip spends no slot')
  applyCommand(room, mira, { type: 'castSave', actorId: 'cleric', targetId: 'orc', sceneId: 'gate', ability: 'WIS', label: 'Command', slotLevel: 1 })
  assert.equal(cleric.slots, 'L1 0/2, L2 1/1')
  assert.match(room.rolls.at(-1)!.label, /Command \(ช่องระดับ 1\)/)
  assert.throws(() => applyCommand(room, mira, { type: 'castSave', actorId: 'cleric', targetId: 'orc', sceneId: 'gate', ability: 'WIS', label: 'Command', slotLevel: 1 }), /ไม่มีช่องเวทระดับ 1/)
  applyCommand(room, mira, { type: 'sheetRoll', rollType: 'spellAttack', actorId: 'cleric', targetId: 'orc', sceneId: 'gate', formula: '2d8', slotLevel: 2 })
  assert.equal(cleric.slots, 'L1 0/2, L2 0/1')
})
