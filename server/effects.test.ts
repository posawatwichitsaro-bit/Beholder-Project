import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blankSheet } from '../shared/model.ts'
import type { Actor, Member, Room, Scene } from '../shared/model.ts'
import { activeConditions, advanceEffects, concentrationDc, d20Penalty, exhaustionLevel } from '../shared/effects.ts'
import { applyCommand, snapshot } from './commands.ts'

function table() {
  const dm: Member = { id: 'dm', name: 'DM', role: 'dm' }
  const mira: Member = { id: 'p1', name: 'Mira', role: 'player' }
  const hawk: Member = { id: 'p2', name: 'Hawk', role: 'player' }
  const cleric: Actor = { ...blankSheet(), id: 'cleric', ownerId: mira.id, name: 'Lyra', hp: 30, maxHp: 30 }
  const ranger: Actor = { ...blankSheet(), id: 'ranger', ownerId: hawk.id, name: 'Kael', hp: 30, maxHp: 30 }
  const ogre: Actor = { ...blankSheet('monster'), id: 'ogre', ownerId: dm.id, name: 'Ogre', hp: 60, maxHp: 60 }
  const scene: Scene = { id: 'gate', name: 'Gate', cell: 48, originX: 0, originY: 0, tokens: [
    { id: 't1', actorId: cleric.id, x: 0, y: 0 }, { id: 't2', actorId: ranger.id, x: 1, y: 0 }, { id: 't3', actorId: ogre.id, x: 2, y: 0 }
  ], combat: { round: 1, turn: 0, order: [{ actorId: 'cleric', initiative: 18 }, { actorId: 'ranger', initiative: 12 }, { actorId: 'ogre', initiative: 6 }] } }
  const room: Room = { id: 'r', name: 'R', invite: 'i', revision: 0, activeSceneId: scene.id, members: [dm, mira, hawk], scenes: [scene], actors: [cleric, ranger, ogre], templates: [], rolls: [] }
  return { dm, mira, hawk, room, scene, cleric, ranger, ogre }
}
const next = (room: Room, dm: Member) => applyCommand(room, dm, { type: 'next', sceneId: 'gate' })

test('Poisoned from two sources shows once; ending one source keeps the other', () => {
  const { dm, room, ranger } = table()
  applyCommand(room, dm, { type: 'addEffect', targetIds: ['ranger'], condition: 'Poisoned', sourceLabel: 'Spider bite' })
  applyCommand(room, dm, { type: 'addEffect', targetIds: ['ranger'], condition: 'Poisoned', sourceLabel: 'Bad stew' })
  assert.deepEqual(activeConditions(ranger).map(item => item.name), ['Poisoned'])
  applyCommand(room, dm, { type: 'removeEffect', actorId: 'ranger', effectId: ranger.effects![0].id })
  assert.deepEqual(activeConditions(ranger).map(item => item.name), ['Poisoned'])
  assert.equal(ranger.effects![0].sourceLabel, 'Bad stew')
})

test('Hold Person: a WIS save comes due at the end of the target\'s turn; passing ends only that effect', () => {
  const { dm, mira, hawk, room, cleric, ranger } = table()
  room.scenes[0].combat!.turn = 1
  applyCommand(room, mira, { type: 'addEffect', sourceId: 'cleric', sourceLabel: 'Hold Person', targetIds: ['ranger'],
    condition: 'Paralyzed', concentration: true, save: { ability: 'WIS', dc: 1, at: 'end' } })
  applyCommand(room, dm, { type: 'addEffect', targetIds: ['ranger'], condition: 'Prone' })
  assert.ok(cleric.effects!.some(effect => effect.condition === 'Concentration' && effect.sourceLabel === 'Hold Person'))
  assert.equal(ranger.effects!.find(effect => effect.condition === 'Paralyzed')!.pending, undefined)
  next(room, dm)
  const held = ranger.effects!.find(effect => effect.condition === 'Paralyzed')!
  assert.deepEqual(held.pending, { ability: 'WIS', dc: 1, reason: 'repeat' })
  assert.match(room.log!.at(-1)!.text, /Kael ต้องทอย WIS save DC 1/)
  assert.throws(() => applyCommand(room, mira, { type: 'effectSave', actorId: 'ranger', effectId: held.id }), /ควบคุม/, 'only the target\'s owner or the DM rolls it')
  applyCommand(room, hawk, { type: 'effectSave', actorId: 'ranger', effectId: held.id })
  assert.deepEqual(activeConditions(ranger).map(item => item.name), ['Prone'], 'Prone from another source stays')
  assert.throws(() => applyCommand(room, hawk, { type: 'effectSave', actorId: 'ranger', effectId: held.id }), /ไม่พบ|ไม่มี/, 'a repeated command cannot roll again')
})

test('damage forces a Concentration check; failing it ends every effect tied to that spell', () => {
  const { dm, mira, room, cleric, ranger, ogre } = table()
  applyCommand(room, mira, { type: 'addEffect', sourceId: 'cleric', sourceLabel: 'Hold Person', targetIds: ['ranger', 'ogre'], condition: 'Paralyzed', concentration: true })
  applyCommand(room, dm, { type: 'adjustHp', sceneId: 'gate', actorId: 'cleric', amount: 30 - 1, mode: 'damage' })
  const focus = cleric.effects!.find(effect => effect.condition === 'Concentration')!
  assert.deepEqual(focus.pending, { ability: 'CON', dc: concentrationDc(29), reason: 'concentration' })
  assert.equal(concentrationDc(29), 14)
  focus.pending!.dc = 40
  applyCommand(room, mira, { type: 'effectSave', actorId: 'cleric', effectId: focus.id })
  assert.equal(cleric.effects!.length, 0)
  assert.equal(ranger.effects!.length + ogre.effects!.length, 0)
  assert.match(room.log!.at(-1)!.text, /Lyra เสีย Concentration \(พลาด CON save\) · Kael พ้นจาก Paralyzed · Ogre พ้นจาก Paralyzed/)
})

test('Stunned ends Concentration at once; 0 HP ends it too; a new Concentration spell replaces the old', () => {
  const { dm, mira, room, cleric, ranger, ogre } = table()
  applyCommand(room, mira, { type: 'addEffect', sourceId: 'cleric', sourceLabel: 'Bless', targetIds: ['ranger'], condition: 'Blessed', concentration: true })
  applyCommand(room, mira, { type: 'addEffect', sourceId: 'cleric', sourceLabel: 'Hold Person', targetIds: ['ogre'], condition: 'Paralyzed', concentration: true })
  assert.equal(ranger.effects!.length, 0, 'casting Hold Person ended Bless')
  assert.equal(cleric.effects!.filter(effect => effect.condition === 'Concentration').length, 1)
  applyCommand(room, dm, { type: 'addEffect', targetIds: ['cleric'], condition: 'Stunned' })
  assert.equal(ogre.effects!.length, 0)

  applyCommand(room, mira, { type: 'addEffect', sourceId: 'cleric', sourceLabel: 'Hold Person', targetIds: ['ogre'], condition: 'Paralyzed', concentration: true })
  applyCommand(room, dm, { type: 'adjustHp', sceneId: 'gate', actorId: 'cleric', amount: 99, mode: 'damage' })
  assert.equal(ogre.effects!.length, 0, 'dropping to 0 HP ends Concentration without a save')
})

test('effects can end at the start or end of a given creature\'s turn', () => {
  const effects = [
    { id: 'a', condition: 'Frightened', ends: { at: 'end' as const, actorId: 'ogre', turns: 1 } },
    { id: 'b', condition: 'Prone', ends: { at: 'start' as const, actorId: 'ranger', turns: 2 } }
  ]
  const first = advanceEffects('ranger', effects, 'cleric', 'ranger')
  assert.deepEqual(first.effects.map(effect => [effect.id, effect.ends?.turns]), [['a', 1], ['b', 1]])
  const second = advanceEffects('ranger', first.effects, 'ogre', 'cleric')
  assert.deepEqual(second.expired.map(effect => effect.id), ['a'])
})

test('Exhaustion 2 takes 4 off D20 Tests from text or effects', () => {
  const { dm, hawk, room, ranger } = table()
  applyCommand(room, dm, { type: 'addEffect', targetIds: ['ranger'], condition: 'Exhaustion', level: 2 })
  assert.equal(exhaustionLevel(ranger), 2)
  assert.equal(d20Penalty({ conditions: 'Exhaustion 3', effects: ranger.effects }), -6, 'the higher level wins')
  applyCommand(room, hawk, { type: 'sheetRoll', actorId: 'ranger', rollType: 'check', ability: 'STR' })
  assert.equal(room.rolls.at(-1)!.modifier, -4)
})

test('DM-only effects never reach players: not in snapshots, not in the log', () => {
  const { dm, mira, hawk, room } = table()
  applyCommand(room, dm, { type: 'addEffect', targetIds: ['ranger', 'ogre'], condition: 'Charmed', hidden: true, sourceLabel: 'Secret' })
  const view = snapshot(room, hawk)
  assert.equal(view.actors.find(actor => actor.id === 'ranger')!.effects!.length, 0)
  assert.ok(view.publicActors.every(actor => !actor.effects?.length))
  assert.ok(!(room.log ?? []).some(entry => entry.text.includes('Charmed')))
  assert.equal(snapshot(room, dm).actors.find(actor => actor.id === 'ranger')!.effects!.length, 1)
  assert.throws(() => applyCommand(room, mira, { type: 'addEffect', targetIds: ['cleric'], condition: 'Prone', hidden: true }), /DM/)
  assert.throws(() => applyCommand(room, mira, { type: 'addEffect', targetIds: ['ranger'], condition: 'Prone' }), /ควบคุม/, 'players affect others only through a creature they control')
})
