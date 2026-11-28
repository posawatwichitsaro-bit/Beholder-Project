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
import { blankSheet } from '../shared/model.ts'
import type { Snapshot } from '../shared/model.ts'
import { maskPixels } from './mapMask.ts'

test('the mask covers exactly the known squares, with the grid origin applied', () => {
  // 10-px squares starting 5 px in: square (0,0) spans x 5–14, y 5–14.
  const mask = maskPixels(30, 20, { cell: 10, originX: 5, originY: 5 }, new Set(['0,0', '1,0']))
  const at = (x: number, y: number) => mask[y * 30 + x]
  assert.equal(at(5, 5), 255)
  assert.equal(at(24, 14), 255)
  assert.equal(at(4, 5), 0, 'left of the grid is square -1')
  assert.equal(at(25, 5), 0, 'square (2,0) is unknown')
  assert.equal(at(10, 15), 0, 'square (0,1) is unknown')
})

/** A plain white 200 × 100 PNG: on a 50-px grid, 4 × 2 squares. */
const white = () => sharp({ create: { width: 200, height: 100, channels: 3, background: '#ffffff' } }).png().toBuffer()
async function pixel(bytes: Buffer, x: number, y: number) {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const at = (y * info.width + x) * info.channels
  return [data[at], data[at + 1], data[at + 2]]
}

test('players get the map with unseen squares painted black; the DM and plain scenes get it whole', { timeout: 30000 }, async t => {
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
  const opened = await fetch(base + '/api/rooms', post({ member: 'DM', name: 'Fog' }))
  const dm = opened.headers.get('set-cookie')!.split(';')[0]
  const initial: Snapshot = await opened.json()
  const path = base + '/api/rooms/' + initial.id
  const joined = await fetch(base + '/api/join', post({ invite: initial.invite, name: 'Mira' }))
  const mira = joined.headers.get('set-cookie')!.split(';')[0]
  const state = async (cookie: string): Promise<Snapshot> => (await fetch(path, { headers: { Cookie: cookie } })).json()
  async function command(body: object, cookie = dm) {
    const response = await fetch(path + '/commands', post({ revision: (await state(cookie)).revision, commandId: randomUUID(), ...body }, cookie))
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
    return response.json()
  }

  await command({ type: 'scene', name: 'Hall', cell: 50, originX: 0, originY: 0 })
  const sceneId = (await state(dm)).scenes[0].id
  await command({ type: 'activate', sceneId })
  const upload = await fetch(path + '/scenes/' + sceneId + '/map', { method: 'PUT', headers: { Cookie: dm, 'Content-Type': 'image/png' }, body: await white() })
  assert.equal(upload.status, 204)
  const mapId = (await state(dm)).scenes[0].map!.id
  const map = async (cookie: string) => {
    const response = await fetch(path + '/maps/' + mapId, { headers: { Cookie: cookie } })
    assert.equal(response.status, 200)
    return { type: response.headers.get('content-type'), bytes: Buffer.from(await response.arrayBuffer()) }
  }
  assert.equal((await map(mira)).type, 'image/png', 'vision off: the whole map')

  // Mira's hero stands in the top-left square, with a wall boxing that square in. Vision on: she sees only it.
  await command({ type: 'walls', sceneId, add: [{ a: { x: 1, y: 0 }, b: { x: 1, y: 1 } }, { a: { x: 0, y: 1 }, b: { x: 1, y: 1 } }] })
  await command({ type: 'visionSettings', sceneId, enabled: true })
  await command({ type: 'place', sceneId, sheet: { ...blankSheet(), name: 'Hero' }, x: 0, y: 0 }, mira)
  const masked = await map(mira)
  assert.equal(masked.type, 'image/webp')
  const meta = await sharp(masked.bytes).metadata()
  assert.deepEqual([meta.width, meta.height], [200, 100], 'same size as the original, so the board lines up')
  assert.ok((await pixel(masked.bytes, 25, 25)).every(value => value > 240), 'her own square is the map')
  assert.ok((await pixel(masked.bytes, 175, 75)).every(value => value < 20), 'the far square is black')
  assert.ok((await pixel(masked.bytes, 75, 25)).every(value => value < 20), 'behind the wall is black')
  assert.equal((await map(dm)).type, 'image/png', 'the DM always gets the whole map')

  // Knock the wall down: she sees the next square, and it stays on her map after the wall goes back up.
  const walls = (await state(dm)).scenes[0].vision!.walls!
  await command({ type: 'walls', sceneId, remove: walls.map(wall => wall.id) })
  await command({ type: 'walls', sceneId, add: [{ a: { x: 1, y: 0 }, b: { x: 1, y: 1 } }] })
  assert.ok((await pixel((await map(mira)).bytes, 75, 25)).every(value => value > 240), 'explored squares stay on her map')
})
