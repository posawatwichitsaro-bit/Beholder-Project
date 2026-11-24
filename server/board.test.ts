import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blankSheet } from '../shared/model.ts'
import type { Actor, Member, Room, Scene, SceneObject } from '../shared/model.ts'
import { applyCommand, snapshot } from './commands.ts'
import { structureCover } from './cover.ts'
import { areaContains, areaOutline } from '../shared/area.ts'

function table() {
  const dm: Member = { id: 'dm', name: 'DM', role: 'dm' }
  const player: Member = { id: 'p1', name: 'Player', role: 'player' }
  const actor: Actor = { ...blankSheet(), id: 'scout', ownerId: player.id, name: 'Scout' }
  const companion: Actor = { ...blankSheet(), id: 'mage', ownerId: player.id, name: 'Mage' }
  const enemy: Actor = { ...blankSheet('monster'), id: 'goblin', ownerId: dm.id, name: 'Guard' }
  const scene: Scene = { id: 'board', name: 'Board', cell: 48, originX: 0, originY: 0, tokens: [
    { id: 't1', actorId: actor.id, x: 0, y: 0 },
    { id: 't2', actorId: companion.id, x: 0, y: 1 },
    { id: 't3', actorId: enemy.id, x: 2, y: 0 }
  ] }
  const room: Room = {
    id: 'test', name: 'Test', invite: 'invite', revision: 0, activeSceneId: scene.id,
    members: [dm, player], scenes: [scene], actors: [actor, companion, enemy], templates: [], rolls: []
  }
  return { dm, player, actor, scene, room }
}

test('group movement keeps relative positions and authorization is all-or-nothing', () => {
  const { player, scene, room } = table()
  const move = { type: 'moveTokens', sceneId: scene.id, dx: 1, dy: 0 }
  assert.throws(() => applyCommand(room, player, { ...move, tokenIds: ['t1', 't3'] }), /ไม่ได้ควบคุม/)
  assert.deepEqual(scene.tokens.map(token => token.x), [0, 0, 2])
  applyCommand(room, player, { ...move, tokenIds: ['t1', 't2'] })
  assert.deepEqual(scene.tokens.map(token => [token.x, token.y]), [[1, 0], [1, 1], [2, 0]])
})

test('containers conceal closed contents and transfer items without duplication', () => {
  const { dm, player, actor, scene, room } = table()
  const input = { type: 'importObject', sceneId: scene.id, x: 1, y: 0 }
  applyCommand(room, dm, { ...input, kind: 'container', name: 'Chest', items: ['Potion'] })
  const chest = scene.objects![0]
  assert.equal(chest.kind, 'container')
  if (chest.kind !== 'container') throw Error('Expected a container')
  const playerChest = snapshot(room, player).scenes[0].objects![0]
  assert.equal(playerChest.kind === 'container' && playerChest.items.length, 0)
  const interact = { sceneId: scene.id, objectId: chest.id, actorId: actor.id }
  const itemId = chest.items[0].id
  assert.throws(() => applyCommand(room, player, { ...interact, itemId, type: 'takeItem' }))
  applyCommand(room, player, { ...interact, type: 'openObject' })
  applyCommand(room, player, { ...interact, itemId, type: 'takeItem' })
  assert.deepEqual(actor.inventory?.map(item => item.name), ['Potion'])
  assert.equal(chest.items.length, 0)
  applyCommand(room, player, { ...interact, itemId, type: 'storeItem' })
  assert.equal(chest.items.length, 1)
  assert.equal(actor.inventory?.length, 0)
  applyCommand(room, dm, { ...input, kind: 'item', name: 'Key' })
  const key = scene.objects![1]
  applyCommand(room, player, { ...interact, objectId: key.id, type: 'takeItem' })
  assert.equal(actor.inventory?.[0].name, 'Key')
  assert.equal(scene.objects?.some(object => object.id === key.id), false)
})

test('structures block attacks across their footprint until destroyed', () => {
  const { player, dm, scene, room } = table()
  applyCommand(room, dm, {
    type: 'importObject', sceneId: scene.id, kind: 'structure', name: 'Wall',
    x: 1, y: 0, hp: 8, ac: 10, cover: 99
  })
  const wall = scene.objects![0] as Extract<SceneObject, { kind: 'structure' }>
  const attack = { type: 'sheetRoll', rollType: 'attack', sceneId: scene.id, actorId: 'scout', targetId: 'goblin' }
  assert.throws(() => applyCommand(room, player, attack), /ที่กำบังเต็ม/)
  assert.equal(structureCover([{ ...wall, cover: 5 }], { x: .5, y: .5 }, { x: 2.5, y: .5 }), 5)
  assert.equal(structureCover([wall], { x: .5, y: 2.5 }, { x: 2.5, y: 2.5 }), 0)
  applyCommand(room, dm, { type: 'damageObject', sceneId: scene.id, objectId: wall.id, amount: 8 })
  assert.equal(wall.hp, 0)
  applyCommand(room, player, attack)
  assert.ok(room.rolls.length)
})

test('demo creates three separate monsters, and private DM rolls stay with their author', () => {
  const { dm, player, room } = table()
  applyCommand(room, dm, { type: 'demoEncounter' })
  assert.equal(room.scenes[1].tokens.length, 3)
  assert.equal(new Set(room.scenes[1].tokens.map(token => token.actorId)).size, 3)
  applyCommand(room, dm, { type: 'roll', formula: '1d4', privateRoll: true })
  applyCommand(room, player, { type: 'roll', formula: '1d4', privateRoll: true })
  assert.equal(snapshot(room, player).rolls.length, 1)
  assert.equal(snapshot(room, dm).rolls.length, 2)
})

test('DM advances past dead combatants while dying characters still get a turn', () => {
  const { dm, scene, room } = table()
  room.actors[2].life = 'dead'
  room.actors[1].life = 'dying'
  scene.combat = { turn: 0, round: 1, order: [
    { actorId: 'scout', initiative: 15 },
    { actorId: 'goblin', initiative: 12 },
    { actorId: 'mage', initiative: 9 }
  ] }
  applyCommand(room, dm, { type: 'next', sceneId: scene.id })
  assert.equal(scene.combat.turn, 2)
  applyCommand(room, dm, { type: 'next', sceneId: scene.id })
  assert.deepEqual([scene.combat.turn, scene.combat.round], [0, 2])
})

test('pending damage persists outside the recent roll window and stays in its scene', () => {
  const { dm, player, scene, room } = table()
  const roll = { id: 'pending', sceneId: scene.id, sourceId: 'goblin', targetId: 'scout',
    name: dm.name, label: 'Damage', formula: '1d6', faces: [4], modifier: 0, total: 4, applied: false }
  room.rolls.push(roll)
  for (let i = 0; i < 41; i++) applyCommand(room, player, { type: 'roll', formula: '1d4' })
  assert.equal(snapshot(room, dm).rolls.some(entry => entry.id === roll.id), false)
  assert.deepEqual(snapshot(room, dm).combatQueue?.map(entry => entry.id), [roll.id])
  applyCommand(room, dm, { type: 'scene', name: 'Other', cell: 48, originX: 0, originY: 0 })
  const other = room.scenes[1]
  other.tokens.push({ ...scene.tokens[0], id: 'other' })
  const useDamage = { type: 'damage', actorId: 'scout', rollId: roll.id, amount: 4 }
  applyCommand(room, dm, { type: 'activate', sceneId: other.id })
  assert.deepEqual(snapshot(room, dm).combatQueue, [])
  assert.throws(() => applyCommand(room, dm, { ...useDamage, sceneId: other.id }))
  applyCommand(room, dm, { type: 'activate', sceneId: scene.id })
  applyCommand(room, dm, { ...useDamage, sceneId: scene.id })
  assert.equal(room.actors[0].hp, 6)
  assert.deepEqual(snapshot(room, dm).combatQueue, [])
})

test('AoE shape geometry matches the targets validated by the server', () => {
  const { dm, player, scene, room } = table()
  for (const kind of ['circle', 'rectangle', 'cone', 'line'] as const) {
    const outline = areaOutline({ kind, from: { x: 0, y: 0 }, to: { x: 4, y: 4 } })
    assert.equal(areaContains(outline, { x: 1, y: 1 }), true, kind)
    assert.equal(areaContains(outline, { x: -8, y: 0 }), false, kind)
  }
  scene.combat = { turn: 0, round: 1, order: [{ actorId: 'scout', initiative: 19 }] }
  const command = { type: 'areaDamage', sceneId: scene.id, area: { kind: 'rectangle', from: { x: 0, y: 0 }, to: { x: 1, y: 2 } },
    formula: '1d4+5', damageKind: 'fire' }
  assert.throws(() => applyCommand(room, player, { ...command, targets: [{ actorId: 'scout', effect: 'full' }] }))
  assert.throws(() => applyCommand(room, dm, { ...command, targets: [{ actorId: 'goblin', effect: 'full' }] }))
  assert.deepEqual(room.actors.map(actor => actor.hp), [10, 10, 10])
  applyCommand(room, dm, { ...command, targets: [{ actorId: 'scout', effect: 'full' }, { actorId: 'mage', effect: 'half' }] })
  const amount = room.rolls.at(-1)!.total
  assert.deepEqual(room.actors.map(actor => actor.hp), [10 - amount, 10 - Math.floor(amount / 2), 10])
  assert.deepEqual(scene.damageEvents?.map(entry => [entry.kind, entry.amount]), [['fire', amount], ['fire', Math.floor(amount / 2)]])
  assert.equal(snapshot(room, player).scenes[0].areaEffect?.kind, 'fire')
})

test('locked chests require the tool, honor DC, and allow DM override', () => {
  const { dm, player, actor, scene, room } = table()
  applyCommand(room, dm, { type: 'importObject', sceneId: scene.id, kind: 'container', name: 'Locked chest',
    x: 1, y: 0, items: ['Potion'], locked: true, lockDc: 30 })
  const chest = scene.objects![0]
  if (chest.kind !== 'container') throw Error('Expected a container')
  const command = { sceneId: scene.id, actorId: actor.id, objectId: chest.id }
  assert.throws(() => applyCommand(room, player, { ...command, type: 'openObject' }))
  assert.throws(() => applyCommand(room, player, { ...command, type: 'pickLock' }), /Thieves/)
  applyCommand(room, player, { type: 'inventoryAdd', actorId: actor.id, item: { name: 'Tools', tool: 'thievesTools' } })
  applyCommand(room, player, { ...command, type: 'pickLock' })
  assert.equal(chest.lock?.locked, true)
  assert.equal(chest.lock?.last?.passed, false)
  assert.throws(() => applyCommand(room, player, { ...command, type: 'pickLock' }), /ลองสะเดาะ/)
  assert.deepEqual(snapshot(room, player).scenes[0].objects?.map(item => item.kind === 'container' && item.items), [[]])
  applyCommand(room, dm, { sceneId: scene.id, objectId: chest.id, type: 'openObject' })
  assert.equal(chest.open, true)
  assert.equal(chest.lock?.locked, false)
  applyCommand(room, dm, { sceneId: scene.id, objectId: chest.id, type: 'setLock', dc: 1 })
  applyCommand(room, player, { ...command, type: 'pickLock' })
  assert.equal(chest.lock?.last?.passed, true)
  assert.equal(chest.open, true)
})

test('a monster search transfers either the base items or all loot to one character', () => {
  for (const dc of [1, 30]) {
    const { dm, player, actor, scene, room } = table()
    const monster = room.actors[2]
    for (const [name, lootTier, quantity] of [['Coins', 'basic', 5], ['Gem', 'bonus', 1]] as const) {
      applyCommand(room, dm, { type: 'inventoryAdd', actorId: monster.id, item: { name, lootTier, quantity } })
    }
    applyCommand(room, dm, { type: 'lootSettings', actorId: monster.id, dc, skill: 'investigation' })
    const search = { type: 'searchLoot', sceneId: scene.id, actorId: monster.id, searcherId: actor.id }
    assert.throws(() => applyCommand(room, player, search), /ถูกสังหาร/)
    applyCommand(room, dm, { type: 'adjustHp', sceneId: scene.id, actorId: monster.id, mode: 'damage', amount: 20 })
    assert.throws(() => applyCommand(room, player, search), /เข้าใกล้/)
    assert.equal(snapshot(room, player).actors.some(item => item.id === monster.id), false)
    applyCommand(room, player, { type: 'moveTokens', sceneId: scene.id, tokenIds: ['t1'], dx: 1, dy: 0 })
    applyCommand(room, player, search)
    assert.deepEqual(actor.inventory?.map(item => [item.name, item.quantity]), dc === 1 ? [['Coins', 5], ['Gem', 1]] : [['Coins', 5]])
    assert.equal(room.actors[1].inventory?.length ?? 0, 0)
    assert.equal(monster.lootResult?.passed, dc === 1)
    assert.deepEqual(monster.inventory, [])
    assert.throws(() => applyCommand(room, player, search), /ค้นศพนี้แล้ว/)
  }
})
