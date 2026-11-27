import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blankSheet } from '../shared/model.ts'
import type { Actor, Member, Room } from '../shared/model.ts'
import { moveCost, pathCells, speedNow } from '../shared/movement.ts'
import { applyCommand } from './commands.ts'

test('moves cost 5 ft a square, +5 in Difficult Terrain, +5 while crawling; Speed drops with conditions', () => {
  assert.equal(pathCells({ x: 0, y: 0 }, { x: 3, y: 2 }).length, 3, 'diagonal steps: 3 squares')
  const open = { terrain: [] as string[] }
  const rough = { terrain: ['1,0', '2,0'] }
  const walker = { conditions: '', effects: [] }
  assert.equal(moveCost(open, walker, { x: 0, y: 0 }, { x: 3, y: 0 }), 15)
  assert.equal(moveCost(rough, walker, { x: 0, y: 0 }, { x: 3, y: 0 }), 25)
  assert.equal(moveCost(rough, { conditions: 'Prone' }, { x: 0, y: 0 }, { x: 3, y: 0 }), 40, 'Prone in rough ground: 15 a square')
  const hero = { ...blankSheet(), speed: 30 }
  assert.equal(speedNow({ ...hero, conditions: 'Exhaustion 2' }), 20)
  assert.equal(speedNow({ ...hero, conditions: 'Grappled' }), 0)
  assert.equal(speedNow({ ...hero, effects: [{ id: 'e', condition: 'Restrained' }] }), 0)
  assert.equal(speedNow(hero), 30)
})

test('the DM paints Difficult Terrain; standing up from Prone uses half the Speed', () => {
  const dm: Member = { id: 'dm', name: 'DM', role: 'dm' }
  const mira: Member = { id: 'm', name: 'Mira', role: 'player' }
  const hero: Actor = { ...blankSheet(), id: 'hero', ownerId: 'm', name: 'Hero', speed: 30, conditions: 'Prone' }
  const room: Room = { id: 'r', name: 'R', invite: 'i', revision: 0, activeSceneId: 's', members: [dm, mira], templates: [], rolls: [], actors: [hero],
    scenes: [{ id: 's', name: 'S', cell: 48, originX: 0, originY: 0, tokens: [{ id: 't1', actorId: 'hero', x: 0, y: 0 }],
      combat: { round: 1, turn: 0, order: [{ actorId: 'hero', initiative: 20 }] } }] }
  const run = (who: Member, body: Record<string, unknown>) => applyCommand(room, who, { sceneId: 's', ...body })
  run(dm, { type: 'terrain', cells: ['1,0', '2,0'], mode: 'difficult' })
  assert.throws(() => run(mira, { type: 'terrain', cells: ['3,0'], mode: 'difficult' }), /DM/)
  run(mira, { type: 'standUp', actorId: 'hero' })
  assert.equal(hero.conditions, '')
  assert.equal(room.scenes[0].combat!.moved!.feet, 15)
  run(mira, { type: 'move', tokenId: 't1', x: 3, y: 0 })
  assert.equal(room.scenes[0].combat!.moved!.feet, 15 + 25, 'two rough squares and one clear')
  run(dm, { type: 'terrain', cells: ['1,0'], mode: 'clear' })
  assert.deepEqual(room.scenes[0].terrain, ['2,0'])
})
