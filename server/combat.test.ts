import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blankSheet } from '../shared/model.ts'
import type { Actor, Member, Room, Scene } from '../shared/model.ts'
import { formatSlots, parseConditions, parseSlots, tickConditions } from '../shared/conditions.ts'
import { applyCommand, snapshot } from './commands.ts'

function table() {
  const dm: Member = { id: 'dm', name: 'DM', role: 'dm' }
  const mira: Member = { id: 'p1', name: 'Mira', role: 'player' }
  const hawk: Member = { id: 'p2', name: 'Hawk', role: 'player' }
  const wizard: Actor = { ...blankSheet(), id: 'wizard', ownerId: mira.id, name: 'Lyra', attack: 50, damage: '1d4' }
  const ranger: Actor = { ...blankSheet(), id: 'ranger', ownerId: hawk.id, name: 'Kael' }
  const goblin: Actor = { ...blankSheet('monster'), id: 'goblin', ownerId: dm.id, name: 'Goblin', hp: 50, maxHp: 50 }
  const scene: Scene = { id: 'gate', name: 'Gate', cell: 48, originX: 0, originY: 0, tokens: [
    { id: 't1', actorId: wizard.id, x: 0, y: 0 }, { id: 't2', actorId: ranger.id, x: 1, y: 0 }, { id: 't3', actorId: goblin.id, x: 2, y: 0 }
  ] }
  const room: Room = {
    id: 'test', name: 'Test', invite: 'invite', revision: 0, activeSceneId: scene.id,
    members: [dm, mira, hawk], scenes: [scene], actors: [wizard, ranger, goblin], templates: [], rolls: []
  }
  scene.combat = { round: 1, turn: 0, order: [
    { actorId: wizard.id, initiative: 18 }, { actorId: ranger.id, initiative: 12 }, { actorId: goblin.id, initiative: 6 }
  ] }
  return { dm, mira, hawk, room, scene, goblin, wizard }
}

test('players end their own turn, never someone else\'s; the DM can step back', () => {
  const { dm, mira, hawk, room, scene } = table()
  assert.throws(() => applyCommand(room, hawk, { type: 'endTurn', sceneId: 'gate', actorId: 'ranger' }), /เทิร์นของคุณ/)
  assert.throws(() => applyCommand(room, mira, { type: 'endTurn', sceneId: 'gate', actorId: 'ranger' }), /เทิร์นของคุณ/)
  applyCommand(room, mira, { type: 'endTurn', sceneId: 'gate', actorId: 'wizard' })
  assert.equal(scene.combat!.turn, 1)
  applyCommand(room, hawk, { type: 'endTurn', sceneId: 'gate', actorId: 'ranger' })
  applyCommand(room, dm, { type: 'endTurn', sceneId: 'gate' })
  assert.deepEqual([scene.combat!.round, scene.combat!.turn], [2, 0])
  applyCommand(room, dm, { type: 'previousTurn', sceneId: 'gate' })
  assert.deepEqual([scene.combat!.round, scene.combat!.turn], [1, 2], 'stepping back crosses into the previous round')
  assert.throws(() => applyCommand(room, mira, { type: 'previousTurn', sceneId: 'gate' }), /DM/)
})

test('timed conditions count down each round and are logged when they end', () => {
  const { dm, mira, room, wizard } = table()
  applyCommand(room, mira, { type: 'conditions', actorId: 'wizard', conditions: [{ name: 'Concentration' }, { name: 'Frightened', rounds: 1 }] })
  assert.equal(wizard.conditions, 'Concentration, Frightened:1')
  assert.throws(() => applyCommand(room, mira, { type: 'conditions', actorId: 'goblin', conditions: [] }), /ควบคุม/)
  assert.throws(() => applyCommand(room, dm, { type: 'conditions', actorId: 'goblin', conditions: [{ name: 'A, B' }] }))
  for (let step = 0; step < 3; step++) applyCommand(room, dm, { type: 'next', sceneId: 'gate' })
  assert.equal(wizard.conditions, 'Concentration')
  assert.ok(room.log!.some(entry => entry.text === 'Lyra พ้นจาก Frightened'))
})

test('with automatic damage on, a hit lowers HP at once and leaves nothing for the DM to confirm', () => {
  const { dm, mira, room, goblin } = table()
  applyCommand(room, dm, { type: 'settings', settings: { autoDamage: true } })
  assert.equal(snapshot(room, mira).settings?.autoDamage, true)
  let hits = 0
  for (let attempt = 0; attempt < 12 && !hits; attempt++) {
    applyCommand(room, mira, { type: 'sheetRoll', rollType: 'attack', actorId: 'wizard', targetId: 'goblin', sceneId: 'gate' })
    hits = room.rolls.filter(roll => roll.label.startsWith('Damage')).length
  }
  assert.equal(hits, 1, 'attack bonus +50 hits unless a natural 1 comes up every time')
  const damage = room.rolls.find(roll => roll.label.startsWith('Damage'))!
  assert.equal(damage.applied, true)
  assert.equal(goblin.hp, 50 - damage.total)
  assert.deepEqual(snapshot(room, dm).combatQueue, [])
})

test('combat remembers who fought in the scene', () => {
  const { dm, room, scene } = table()
  delete scene.combat
  applyCommand(room, dm, { type: 'combat', sceneId: 'gate', participants: ['wizard', 'goblin'] })
  assert.deepEqual(scene.lastParticipants, ['wizard', 'goblin'])
})

test('condition and slot text round-trips; free text stays usable', () => {
  assert.deepEqual(parseConditions('Prone, Poisoned:3, ถูกสาป'), [{ name: 'Prone' }, { name: 'Poisoned', rounds: 3 }, { name: 'ถูกสาป' }])
  assert.deepEqual(tickConditions('Prone, Poisoned:1, Stunned:2'), { value: 'Prone, Stunned:1', expired: ['Poisoned'] })
  const slots = parseSlots('L2 1/3, L1 4/4')!
  assert.deepEqual(slots, [{ level: 1, left: 4, max: 4 }, { level: 2, left: 1, max: 3 }])
  assert.equal(formatSlots(slots), 'L1 4/4, L2 1/3')
  assert.deepEqual(parseSlots(''), [])
  assert.equal(parseSlots('สองช่องระดับ 1'), undefined)
})
