import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { createApp } from './app.ts'
import { migrate } from './store.ts'
import { blankSheet } from '../shared/model.ts'
import type { Snapshot } from '../shared/model.ts'
import { coinItem, coinTotal, collectCoins, formatCopper, pay } from '../shared/shop.ts'
import { difficultyOf, partyBudget, spreadAround } from '../shared/encounters.ts'

test('a purse pays with small coins first and gets change in big ones', () => {
  assert.deepEqual(pay({ gp: 1 }, 50), { sp: 5 }, '1 gp for 5 sp: 5 sp back')
  assert.deepEqual(pay({ gp: 2, sp: 3, cp: 4 }, 34), { gp: 2 }, 'exact change from the small coins')
  assert.deepEqual(pay({ pp: 1 }, 1), { gp: 9, sp: 9, cp: 9 })
  assert.equal(pay({ gp: 1 }, 101), undefined, 'too little')
  // Whatever the purse, paying leaves exactly the total minus the price.
  for (let round = 0; round < 500; round++) {
    const purse = { cp: Math.floor(Math.random() * 30), sp: Math.floor(Math.random() * 30), ep: Math.floor(Math.random() * 3), gp: Math.floor(Math.random() * 30), pp: Math.floor(Math.random() * 3) }
    const price = Math.floor(Math.random() * (coinTotal(purse) + 1))
    const left = pay(purse, price)
    assert.ok(left, JSON.stringify([purse, price]))
    assert.equal(coinTotal(left), coinTotal(purse) - price)
  }
  assert.equal(formatCopper(150), '1 gp 5 sp')
  assert.equal(formatCopper(1), '1 cp')
})

test('coin items in a bag are recognised and moved into the purse', () => {
  assert.deepEqual(coinItem({ name: '50 gp' }), { kind: 'gp', amount: 50 })
  assert.deepEqual(coinItem({ name: 'Gold Pieces', quantity: 12 }), { kind: 'gp', amount: 12 })
  assert.deepEqual(coinItem({ name: 'sp', quantity: 3 }), { kind: 'sp', amount: 3 })
  assert.equal(coinItem({ name: 'Gold Ring' }), undefined)
  const moved = collectCoins([{ id: '1', name: '10 gp', description: '' }, { id: '2', name: 'Rope', description: '' }, { id: '3', name: 'Copper', description: '', quantity: 7 }], { gp: 2 })
  assert.deepEqual(moved.coins, { cp: 7, gp: 12 })
  assert.deepEqual(moved.inventory.map(item => item.name), ['Rope'])
})

test('the XP budget follows the SRD table and a group spreads onto free squares', () => {
  assert.deepEqual(partyBudget([1, 1, 1, 1]), { low: 200, moderate: 300, high: 400 }, 'SRD example: four level 1 characters')
  assert.deepEqual(partyBudget([5, 3]), { low: 650, moderate: 975, high: 1500 }, 'mixed levels add up per character')
  const budget = partyBudget([1, 1, 1, 1])
  assert.equal(difficultyOf(100, budget), undefined)
  assert.equal(difficultyOf(200, budget), 'low')
  assert.equal(difficultyOf(350, budget), 'moderate')
  assert.equal(difficultyOf(401, budget), 'over')
  const spots = spreadAround({ x: 5, y: 5 }, [1, 1, 2], new Set(['5,5']))
  const squares = spots.flatMap((spot, index) => {
    const size = [1, 1, 2][index]
    return Array.from({ length: size * size }, (_, at) => (spot.x + at % size) + ',' + (spot.y + Math.floor(at / size)))
  })
  assert.equal(new Set(squares).size, squares.length, 'no two monsters share a square')
  assert.ok(!squares.includes('5,5'), 'the taken square stays free')
  assert.ok(spots.every(spot => Math.abs(spot.x - 5) <= 2 && Math.abs(spot.y - 5) <= 2), 'they stay close')
})

test('encounters stay with the DM, place as a group and can start the fight; shops sell from the purse', { timeout: 30000 }, async t => {
  const db = new PGlite()
  const database = {
    query: db.query.bind(db),
    transaction: <T>(work: (query: typeof db.query) => Promise<T>) => db.transaction(transaction => work(transaction.query.bind(transaction)))
  }
  await migrate(database)
  const assets = await mkdtemp(join(tmpdir(), 'beholder-'))
  const server = await createApp(database, assets)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address === 'object')
  const base = 'http://127.0.0.1:' + address.port
  t.after(async () => {
    await new Promise<void>(done => server.close(() => done()))
    await db.close()
    await rm(assets, { recursive: true, force: true })
  })
  const post = (body: object, cookie?: string) => ({
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body)
  })
  const opened = await fetch(base + '/api/rooms', post({ member: 'DM', name: 'Market' }))
  const dm = opened.headers.get('set-cookie')!.split(';')[0]
  const initial: Snapshot = await opened.json()
  const path = base + '/api/rooms/' + initial.id
  const joined = await fetch(base + '/api/join', post({ invite: initial.invite, name: 'Mira' }))
  const mira = joined.headers.get('set-cookie')!.split(';')[0]
  const state = async (cookie: string): Promise<Snapshot> => (await fetch(path, { headers: { Cookie: cookie } })).json()
  async function send(body: object, cookie = dm) {
    return fetch(path + '/commands', post({ revision: (await state(cookie)).revision, commandId: randomUUID(), ...body }, cookie))
  }
  async function command(body: object, cookie = dm) {
    const response = await send(body, cookie)
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
    return response.json()
  }

  await command({ type: 'scene', name: 'Road', cell: 50, originX: 0, originY: 0 })
  const sceneId = (await state(dm)).scenes[0].id
  await command({ type: 'activate', sceneId })
  await command({ type: 'place', sceneId, sheet: { ...blankSheet(), name: 'Mira Hero', classLevel: 'Fighter 3',
    inventory: [{ name: '12 gp', description: '' }, { name: 'sp', description: '', quantity: 4 }] }, x: 0, y: 0 }, mira)

  // Encounters: the DM prepares one; Mira never sees it and can't make one.
  const goblins = [{ monsterId: 'srd-5.2.1:goblin-warrior', count: 4 }, { monsterId: 'srd-5.2.1:ogre', count: 1 }]
  const { encounterId } = await command({ type: 'encounter', name: 'Ambush', sceneId, groups: goblins })
  const saved = (await state(dm)).encounters!
  assert.deepEqual(saved[0].groups.map(group => [group.name, group.cr, group.count]), [['Goblin Warrior', '1/4', 4], ['Ogre', '2', 1]])
  assert.equal((await state(mira)).encounters, undefined, 'players never get encounters')
  assert.equal((await send({ type: 'encounter', name: 'Mine', groups: goblins }, mira)).status, 403)
  assert.equal((await send({ type: 'encounter', name: 'Fake', groups: [{ monsterId: 'srd-5.2.1:tarrasque-of-doom', count: 1 }] })).status, 400)

  // Placing it puts five tokens on free squares near (6, 6) and starts the fight with Mira's hero.
  await command({ type: 'placeEncounter', sceneId, encounterId, x: 6, y: 6, start: true })
  const fought = await state(dm)
  const scene = fought.scenes[0]
  const monsters = fought.actors.filter(actor => actor.kind === 'monster')
  assert.deepEqual(monsters.map(actor => actor.name).sort(), ['Goblin Warrior 1', 'Goblin Warrior 2', 'Goblin Warrior 3', 'Goblin Warrior 4', 'Ogre'])
  const squares = scene.tokens.flatMap(token => {
    const size = fought.actors.find(actor => actor.id === token.actorId)!.size === 'Large' ? 2 : 1
    return Array.from({ length: size * size }, (_, at) => (token.x + at % size) + ',' + (token.y + Math.floor(at / size)))
  })
  assert.equal(new Set(squares).size, squares.length, 'no one stands on anyone')
  assert.equal(scene.combat!.order.length, 6, 'the four goblins, the ogre and the hero roll initiative')
  assert.match(fought.log!.at(-2)!.text, /Goblin Warrior ×4, Ogre ×1 \(650 XP\)/)
  await command({ type: 'end', sceneId })

  // Shops: the DM puts up a shop; a closed one shows no wares.
  await command({ type: 'importObject', sceneId, x: 3, y: 0, definition: { kind: 'shop', name: 'Ironmonger', description: '', markup: 150, items: [
    { name: 'Rope', description: '', ref: 'srd-5.2.1:equipment:rope', price: 100 },
    { name: 'Mystery Box', description: '' }] } })
  const shop = (await state(dm)).scenes[0].objects!.find(item => item.kind === 'shop')!
  assert.ok(shop.kind === 'shop' && shop.open)
  const [rope, box] = shop.kind === 'shop' ? shop.items : []
  const hero = (await state(mira)).actors[0]

  // Buying two ropes at 150%: 3 gp, paid from the coins that were items in her bag.
  await command({ type: 'buy', sceneId, objectId: shop.id, actorId: hero.id, itemId: rope.id, quantity: 2 }, mira)
  let mine = (await state(mira)).actors[0]
  assert.deepEqual(mine.coins, { sp: 4, gp: 9 })
  assert.deepEqual(mine.inventory!.map(item => [item.name, item.quantity, item.ref]), [['Rope', 2, 'srd-5.2.1:equipment:rope']])
  assert.match((await state(mira)).log!.at(-1)!.text, /Mira Hero ซื้อ Rope ×2 จาก Ironmonger · 3 gp/)
  // No price: agree it with the DM. Too poor: refused.
  assert.equal((await send({ type: 'buy', sceneId, objectId: shop.id, actorId: hero.id, itemId: box.id }, mira)).status, 400)
  assert.equal((await send({ type: 'buy', sceneId, objectId: shop.id, actorId: hero.id, itemId: rope.id, quantity: 7 }, mira)).status, 400)
  // The DM prices the box; then closes the shop, and Mira sees an empty, closed shop.
  await command({ type: 'shop', sceneId, objectId: shop.id, itemId: box.id, price: 20 })
  await command({ type: 'shop', sceneId, objectId: shop.id, open: false })
  const closed = (await state(mira)).scenes[0].objects!.find(item => item.id === shop.id)!
  assert.ok(closed.kind === 'shop' && !closed.open && closed.items.length === 0)
  assert.equal((await send({ type: 'buy', sceneId, objectId: shop.id, actorId: hero.id, itemId: box.id }, mira)).status, 400)
  assert.equal((await send({ type: 'shop', sceneId, objectId: shop.id, open: true }, mira)).status, 403)

  // Selling or a reward is done by hand: Mira sets her own purse; she can't touch someone else's.
  await command({ type: 'coins', actorId: hero.id, coins: { gp: 20, sp: 4 } }, mira)
  mine = (await state(mira)).actors[0]
  assert.deepEqual(mine.coins, { sp: 4, gp: 20 })
  const ogre = (await state(dm)).actors.find(actor => actor.name === 'Ogre')!
  assert.equal((await send({ type: 'coins', actorId: ogre.id, coins: { gp: 1 } }, mira)).status, 403)
  // Editing the sheet keeps the purse.
  const { id: _id, ownerId: _owner, ...sheet } = mine
  await command({ type: 'sheet', actorId: hero.id, sheet: { ...sheet, name: 'Mira the Bold' } }, mira)
  assert.deepEqual((await state(mira)).actors[0].coins, { sp: 4, gp: 20 })
  // The DM undoes the purse change.
  await command({ type: 'coins', actorId: hero.id, coins: { gp: 1 } })
  await command({ type: 'undo' })
  assert.deepEqual((await state(mira)).actors[0].coins, { sp: 4, gp: 20 })
})
