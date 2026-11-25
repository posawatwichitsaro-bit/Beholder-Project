import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blankSheet } from '../shared/model.ts'
import type { Actor, Member, Room, Scene } from '../shared/model.ts'
import { applyCommand, snapshot } from './commands.ts'

function table() {
  const dm: Member = { id: 'dm', name: 'DM', role: 'dm' }
  const player: Member = { id: 'p1', name: 'Mira', role: 'player' }
  const hero: Actor = { ...blankSheet(), id: 'hero', ownerId: player.id, name: 'Hawk', hp: 10, maxHp: 10 }
  const goblin: Actor = { ...blankSheet('monster'), id: 'goblin', ownerId: dm.id, name: 'Goblin', hp: 7, maxHp: 7 }
  const gate: Scene = { id: 'gate', name: 'Gate', cell: 48, originX: 0, originY: 0, tokens: [
    { id: 't1', actorId: hero.id, x: 0, y: 0 }, { id: 't2', actorId: goblin.id, x: 1, y: 0 }
  ] }
  const vault: Scene = { id: 'vault', name: 'Vault', cell: 48, originX: 0, originY: 0, tokens: [] }
  const room: Room = {
    id: 'test', name: 'Test', invite: 'invite', revision: 0, activeSceneId: gate.id,
    members: [dm, player], scenes: [gate, vault], actors: [hero, goblin], templates: [], rolls: []
  }
  return { dm, player, room }
}

test('the adventure log records chat, HP changes, combat and scene changes in order', () => {
  const { dm, player, room } = table()
  applyCommand(room, player, { type: 'chat', text: '  ผมจะคุ้มกันเอง  ' })
  applyCommand(room, dm, { type: 'adjustHp', sceneId: 'gate', actorId: 'goblin', amount: 4, mode: 'damage', damageKind: 'fire' })
  applyCommand(room, dm, { type: 'adjustHp', sceneId: 'gate', actorId: 'goblin', amount: 9, mode: 'damage' })
  applyCommand(room, dm, { type: 'adjustHp', sceneId: 'gate', actorId: 'hero', amount: 3, mode: 'temp' })
  applyCommand(room, dm, { type: 'combat', sceneId: 'gate', participants: ['hero', 'goblin'] })
  applyCommand(room, dm, { type: 'end', sceneId: 'gate' })
  applyCommand(room, dm, { type: 'activate', sceneId: 'vault' })
  const log = room.log!
  assert.deepEqual(log.map(entry => entry.kind), ['chat', 'hp', 'hp', 'hp', 'combat', 'combat', 'scene'])
  assert.equal(log[0].text, 'ผมจะคุ้มกันเอง')
  assert.equal(log[0].name, 'Mira')
  assert.equal(log[1].text, 'Goblin เสีย 4 HP (ไฟ)')
  assert.equal(log[2].text, 'Goblin เสีย 3 HP · ล้มลง', 'only the HP actually lost is logged')
  assert.match(log[4].text, /^เริ่มการต่อสู้ · /)
  assert.equal(log[6].text, 'เปิดฉาก Vault')
  assert.ok(log.every((entry, index) => index === 0 || entry.at >= log[index - 1].at))
})

test('players only see log lines from the scene they can see; the DM sees all', () => {
  const { dm, player, room } = table()
  applyCommand(room, dm, { type: 'adjustHp', sceneId: 'gate', actorId: 'goblin', amount: 2, mode: 'damage' })
  applyCommand(room, player, { type: 'chat', text: 'hello' })
  room.activeSceneId = 'vault'
  assert.deepEqual(snapshot(room, player).log!.map(entry => entry.kind), ['chat'], 'Gate HP lines leave with the scene')
  assert.deepEqual(snapshot(room, dm).log!.map(entry => entry.kind), ['hp', 'chat'])
  assert.throws(() => applyCommand(room, player, { type: 'chat', text: '   ' }))
  assert.throws(() => applyCommand(room, player, { type: 'chat', text: 'x'.repeat(501) }))
})

test('rolls carry a time so they interleave with log lines', () => {
  const { player, room } = table()
  applyCommand(room, player, { type: 'roll', formula: '1d20' })
  assert.equal(typeof room.rolls[0].at, 'number')
})
