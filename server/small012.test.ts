import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blankSheet } from '../shared/model.ts'
import type { Actor, Member, Room } from '../shared/model.ts'
import { visionOf } from '../shared/vision.ts'
import { applyCommand, snapshot } from './commands.ts'

function table() {
  const dm: Member = { id: 'dm', name: 'DM', role: 'dm' }
  const mira: Member = { id: 'm', name: 'Mira', role: 'player' }
  const bram: Member = { id: 'b', name: 'Bram', role: 'player' }
  const hero: Actor = { ...blankSheet(), id: 'hero', ownerId: 'm', name: 'Hero', inventory: [
    { id: 'torch', name: 'Torch', description: '', ref: 'srd-5.2.1:equipment:torch' },
    { id: 'lantern', name: 'Hooded Lantern', description: '', ref: 'srd-5.2.1:equipment:lantern-hooded' },
    { id: 'rope', name: 'Rope', description: '', ref: 'srd-5.2.1:equipment:rope' }] }
  const room: Room = { id: 'r', name: 'R', invite: 'i', revision: 0, activeSceneId: 's', members: [dm, mira, bram], templates: [], rolls: [], actors: [hero],
    scenes: [{ id: 's', name: 'S', cell: 48, originX: 0, originY: 0, tokens: [{ id: 't1', actorId: 'hero', x: 0, y: 0 }],
      objects: [{ id: 'box', kind: 'container', name: 'Chest', description: '', open: false, items: [{ id: 'gem', name: 'Gem', description: '' }], x: 3, y: 3, width: 1, height: 1 }] }] }
  const run = (who: Member, body: Record<string, unknown>) => applyCommand(room, who, { sceneId: 's', ...body })
  return { dm, mira, bram, hero, room, run }
}

test('whispers reach only the two people and the DM', () => {
  const { dm, mira, bram, room, run } = table()
  run(mira, { type: 'chat', text: 'psst', to: 'b' })
  run(mira, { type: 'chat', text: 'hello all' })
  const texts = (who: Member) => snapshot(room, who).log!.map(entry => entry.text)
  assert.deepEqual(texts(bram), ['psst', 'hello all'])
  assert.deepEqual(texts(dm), ['psst', 'hello all'])
  assert.deepEqual(texts(mira), ['psst', 'hello all'])
  run(dm, { type: 'chat', text: 'secret for Mira', to: 'm' })
  assert.ok(!texts(bram).includes('secret for Mira'))
  assert.throws(() => run(mira, { type: 'chat', text: 'me', to: 'm' }), /ตัวเอง/)
})

test('a player lights a torch from the bag; the brightest burning item is the light; rope will not light', () => {
  const { mira, hero, run } = table()
  run(mira, { type: 'lightItem', actorId: 'hero', itemId: 'torch', lit: true })
  assert.deepEqual(visionOf(hero).light, { bright: 20, dim: 20, on: true })
  run(mira, { type: 'lightItem', actorId: 'hero', itemId: 'lantern', lit: true })
  assert.deepEqual(visionOf(hero).light, { bright: 30, dim: 30, on: true })
  run(mira, { type: 'lightItem', actorId: 'hero', itemId: 'lantern', lit: false })
  run(mira, { type: 'lightItem', actorId: 'hero', itemId: 'torch', lit: false })
  assert.equal(visionOf(hero).light, undefined)
  assert.throws(() => run(mira, { type: 'lightItem', actorId: 'hero', itemId: 'rope', lit: true }), /จุดเป็นแสงไม่ได้/)
})

test('the DM takes things out of a box from the storeroom', () => {
  const { dm, mira, room, run } = table()
  assert.throws(() => run(mira, { type: 'containerRemove', objectId: 'box', itemId: 'gem' }), /DM/)
  run(dm, { type: 'containerRemove', objectId: 'box', itemId: 'gem' })
  const box = room.scenes[0].objects![0]
  assert.ok(box.kind === 'container' && box.items.length === 0)
})
