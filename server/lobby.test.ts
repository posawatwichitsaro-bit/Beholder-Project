import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { createApp } from './app.ts'
import { migrate } from './store.ts'
import type { Snapshot, TableSummary } from '../shared/model.ts'

test('the lobby lists only the tables an account is seated at, newest activity first', { timeout: 60000 }, async t => {
  const db = new PGlite()
  const database = {
    query: db.query.bind(db),
    transaction: <T>(work: (query: typeof db.query) => Promise<T>) => db.transaction(transaction => work(transaction.query.bind(transaction)))
  }
  const assets = await mkdtemp(join(tmpdir(), 'beholder-lobby-'))
  await migrate(database)
  await migrate(database)
  const server = await createApp(database, assets)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    await new Promise<void>(done => server.close(() => done()))
    await db.close()
    await rm(assets, { recursive: true, force: true })
  })
  const address = server.address()
  assert(address && typeof address === 'object')
  const base = 'http://127.0.0.1:' + address.port
  const request = (path: string, body?: object, cookie = '', method = body ? 'POST' : 'GET') => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body && JSON.stringify(body)
  })
  const cookieOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  async function register(name: string) {
    const response = await request('/api/account/session', { mode: 'register', email: randomUUID() + '@example.com', password: 'lobby-test-password', name })
    assert.equal(response.status, 201)
    return cookieOf(response)
  }
  const tables = async (cookie: string) => {
    const response = await request('/api/account/rooms', undefined, cookie)
    assert.equal(response.status, 200)
    return await response.json() as TableSummary[]
  }

  assert.equal((await request('/api/account/rooms')).status, 403, 'guests have no table list')

  const mira = await register('Mira')
  const hawk = await register('Hawk')
  assert.deepEqual(await tables(mira), [])

  const fort: Snapshot = await (await request('/api/rooms', { name: 'Old Fort' }, mira)).json()
  const vale: Snapshot = await (await request('/api/rooms', { name: 'Silver Vale' }, hawk)).json()
  const joined = await request('/api/join', { invite: vale.invite, role: 'player' }, mira)
  assert.equal(joined.status, 200)

  const list = await tables(mira)
  assert.deepEqual(list.map(table => [table.name, table.role]), [['Silver Vale', 'player'], ['Old Fort', 'dm']])
  assert.deepEqual(list[0].members.map(member => member.name).sort(), ['Hawk', 'Mira'])
  assert.equal(list[1].sceneName, undefined)

  const scene = await request('/api/rooms/' + fort.id + '/commands', {
    type: 'scene', name: 'Gate', cell: 48, originX: 0, originY: 0, commandId: randomUUID(), revision: fort.revision
  }, mira)
  assert.equal(scene.status, 200)
  const after = await tables(mira)
  assert.equal(after[0].name, 'Old Fort', 'a change moves the table to the top')
  assert.equal(after[0].sceneName, 'Gate')
  assert.ok(!Number.isNaN(Date.parse(after[0].updatedAt)))

  assert.deepEqual((await tables(hawk)).map(table => table.name), ['Silver Vale'], 'other accounts never see Mira\'s DM table')
})
