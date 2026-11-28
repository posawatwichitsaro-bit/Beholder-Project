import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { PGlite } from '@electric-sql/pglite'
import { createApp } from './app.ts'
import { migrate } from './store.ts'
import type { Snapshot } from '../shared/model.ts'

test('world maps: hidden until shared, DM pins hidden until revealed, players pin and move the party, presenting shares', { timeout: 30000 }, async t => {
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
  const opened = await fetch(base + '/api/rooms', post({ member: 'DM', name: 'Realm' }))
  const dm = opened.headers.get('set-cookie')!.split(';')[0]
  const initial: Snapshot = await opened.json()
  const path = base + '/api/rooms/' + initial.id
  const cookieOf = async (name: string) => (await fetch(base + '/api/join', post({ invite: initial.invite, name }))).headers.get('set-cookie')!.split(';')[0]
  const mira = await cookieOf('Mira')
  const oren = await cookieOf('Oren')
  const state = async (cookie: string): Promise<Snapshot> => (await fetch(path, { headers: { Cookie: cookie } })).json()
  async function send(body: object, cookie = dm) {
    return fetch(path + '/commands', post({ revision: (await state(cookie)).revision, commandId: randomUUID(), ...body }, cookie))
  }
  async function command(body: object, cookie = dm) {
    const response = await send(body, cookie)
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
    return response.json()
  }
  const picture = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#3a6a3a' } }).png().toBuffer()

  await command({ type: 'scene', name: 'Phandalin', cell: 50, originX: 0, originY: 0 })
  const sceneId = (await state(dm)).scenes[0].id
  const { mapId } = await command({ type: 'worldMap', name: 'Sword Coast' })
  const upload = await fetch(path + '/world/' + mapId + '/image', { method: 'PUT', headers: { Cookie: dm, 'Content-Type': 'image/png' }, body: picture })
  assert.equal(upload.status, 204)
  assert.equal((await fetch(path + '/world/' + mapId + '/image', { headers: { Cookie: mira } })).status, 403, 'not shared yet')
  assert.equal((await state(mira)).worldMaps?.length ?? 0, 0)
  assert.equal((await send({ type: 'pin', mapId, x: .5, y: .5, name: 'Here' }, mira)).status, 403)
  assert.equal((await send({ type: 'worldMap', name: 'Mine' }, mira)).status, 403)

  // The DM's pin starts hidden and carries a scene link.
  const { pinId: town } = await command({ type: 'pin', mapId, x: .25, y: .4, name: 'Phandalin', kind: 'town', note: 'เมืองเหมือง', sceneId })
  await command({ type: 'worldMap', mapId, shared: true })
  let seen = (await state(mira)).worldMaps!
  assert.equal(seen.length, 1)
  assert.equal(seen[0].pins.length, 0, 'the hidden pin stays with the DM')
  assert.equal((await fetch(path + '/world/' + mapId + '/image', { headers: { Cookie: mira } })).status, 200)
  await command({ type: 'pin', mapId, pinId: town, hidden: false })
  seen = (await state(mira)).worldMaps!
  assert.deepEqual(seen[0].pins.map(pin => [pin.name, pin.kind, pin.note, pin.sceneId]), [['Phandalin', 'town', 'เมืองเหมือง', undefined]], 'revealed, without the scene link')

  // Mira pins a rumour; Oren sees it but can't change it; the DM can.
  const { pinId: rumour } = await command({ type: 'pin', mapId, x: .8, y: .1, name: 'ถ้ำที่ลือกัน', kind: 'dungeon', hidden: true, sceneId }, mira)
  const rumourPin = (await state(oren)).worldMaps![0].pins.find(pin => pin.id === rumour)!
  assert.equal(rumourPin.hidden, undefined, 'a player cannot hide a pin')
  assert.equal((await state(dm)).worldMaps![0].pins.find(pin => pin.id === rumour)!.sceneId, undefined, 'nor link a scene')
  assert.equal((await send({ type: 'pin', mapId, pinId: rumour, name: 'ของฉัน' }, oren)).status, 403)
  assert.equal((await send({ type: 'pin', mapId, pinId: town, remove: true }, mira)).status, 403)
  await command({ type: 'pin', mapId, pinId: rumour, x: .7, y: .15 }, mira)
  await command({ type: 'pin', mapId, pinId: rumour, note: 'DM ยืนยันว่ามีจริง' })
  assert.equal((await send({ type: 'pin', mapId, x: 1.5, y: .2, name: 'Off' }, mira)).status, 400, 'off the map')

  // Anyone moves the party; the DM's undo puts it back.
  await command({ type: 'partyMarker', mapId, x: .3, y: .45 }, oren)
  assert.deepEqual((await state(mira)).worldMaps![0].party, { x: .3, y: .45 })
  await command({ type: 'partyMarker', mapId, x: .6, y: .2 })
  await command({ type: 'undo' })
  assert.deepEqual((await state(mira)).worldMaps![0].party, { x: .3, y: .45 })

  // A second map: presenting shares it; unsharing stops the presentation.
  const { mapId: city } = await command({ type: 'worldMap', name: 'Neverwinter' })
  assert.equal((await send({ type: 'presentMap', mapId: city })).status, 400, 'no picture yet')
  await fetch(path + '/world/' + city + '/image', { method: 'PUT', headers: { Cookie: dm, 'Content-Type': 'image/png' }, body: picture })
  await command({ type: 'presentMap', mapId: city })
  const watching = await state(oren)
  assert.equal(watching.presentingMap?.mapId, city)
  assert.equal(watching.worldMaps!.length, 2)
  await command({ type: 'worldMap', mapId: city, shared: false })
  assert.equal((await state(oren)).presentingMap, undefined)
  assert.equal((await state(oren)).worldMaps!.length, 1)
  await command({ type: 'worldMap', mapId: city, remove: true })
  assert.equal((await state(dm)).worldMaps!.length, 1)
})
