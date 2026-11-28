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
import type { Snapshot } from '../shared/model.ts'
import { canvaEmbed } from '../shared/handouts.ts'

test('Canva links: view links become embeds; edit links and other sites are refused', () => {
  assert.deepEqual(canvaEmbed('https://www.canva.com/design/DAF1abc/Xy-9z/view?utm_content=DAF1abc&utm_source=link'),
    { url: 'https://www.canva.com/design/DAF1abc/Xy-9z/view?embed' })
  assert.deepEqual(canvaEmbed('https://canva.com/design/DAF1abc/watch'), { url: 'https://www.canva.com/design/DAF1abc/view?embed' })
  assert.match((canvaEmbed('https://www.canva.com/design/DAF1abc/Xy/edit') as { error: string }).error, /view/)
  assert.ok('error' in canvaEmbed('https://evil.example/design/DAF1abc/view'))
  assert.ok('error' in canvaEmbed('http://www.canva.com/design/DAF1abc/view'))
  assert.ok('error' in canvaEmbed('https://www.canva.com.evil.example/design/DAF1abc/view'))
  assert.ok('error' in canvaEmbed('not a link'))
})

test('handouts reach only their recipients, pictures included, and the DM can present one', { timeout: 30000 }, async t => {
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
  const opened = await fetch(base + '/api/rooms', post({ member: 'DM', name: 'Handouts' }))
  const dm = opened.headers.get('set-cookie')!.split(';')[0]
  const initial: Snapshot = await opened.json()
  const path = base + '/api/rooms/' + initial.id
  const seat = async (name: string) => {
    const response = await fetch(base + '/api/join', post({ invite: initial.invite, name }))
    return { cookie: response.headers.get('set-cookie')!.split(';')[0], id: ((await response.json()) as Snapshot).me.id }
  }
  const mira = await seat('Mira')
  const oren = await seat('Oren')
  const state = async (cookie: string): Promise<Snapshot> => (await fetch(path, { headers: { Cookie: cookie } })).json()
  async function command(body: object, cookie = dm, status = 200) {
    const response = await fetch(path + '/commands', post({ revision: (await state(cookie)).revision, commandId: randomUUID(), ...body }, cookie))
    const result = await response.json()
    assert.equal(response.status, status, JSON.stringify(result))
    return result
  }

  await command({ type: 'handout', title: 'Letter', text: 'Meet me at dawn' }, mira.cookie, 403)
  await command({ type: 'handout', title: 'Deck', canva: 'https://www.canva.com/design/DAF1/x/edit' }, dm, 400)
  const secret = await command({ type: 'handout', title: 'Secret map', text: 'For Mira only', recipients: [mira.id] })
  const all = await command({ type: 'handout', title: 'Town notice', canva: 'https://www.canva.com/design/DAF1abc/Xy/view' })
  assert.equal((await state(mira.cookie)).handouts!.length, 2)
  assert.deepEqual((await state(oren.cookie)).handouts!.map(item => item.title), ['Town notice'], 'Oren never receives the secret one')
  assert.equal((await state(oren.cookie)).handouts![0].canva, 'https://www.canva.com/design/DAF1abc/Xy/view?embed')
  assert.deepEqual((await state(mira.cookie)).handouts!.find(item => item.id === secret.handoutId)!.recipients, [mira.id])

  // The picture: only the DM uploads it; only the DM and Mira can open it.
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=', 'base64')
  const upload = (cookie: string) => fetch(path + '/handouts/' + secret.handoutId + '/image', { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'image/png' }, body: image })
  assert.equal((await upload(mira.cookie)).status, 403)
  assert.equal((await upload(dm)).status, 204)
  const picture = (cookie: string) => fetch(path + '/handouts/' + secret.handoutId + '/image', { headers: { Cookie: cookie } })
  assert.equal((await picture(mira.cookie)).status, 200)
  assert.equal((await picture(dm)).status, 200)
  assert.equal((await picture(oren.cookie)).status, 403)

  // Sharing with Oren later lets him in; presenting reaches only those who have it.
  await command({ type: 'present', handoutId: secret.handoutId })
  assert.equal((await state(mira.cookie)).presenting?.handoutId, secret.handoutId)
  assert.equal((await state(oren.cookie)).presenting, undefined)
  await command({ type: 'handout', handoutId: secret.handoutId, recipients: [mira.id, oren.id] })
  assert.equal((await picture(oren.cookie)).status, 200)
  assert.equal((await state(oren.cookie)).presenting?.handoutId, secret.handoutId)
  await command({ type: 'present', handoutId: null })
  assert.equal((await state(mira.cookie)).presenting, undefined)

  // Removing one stops presenting it; the DM's undo brings it back.
  await command({ type: 'present', handoutId: all.handoutId })
  await command({ type: 'handout', handoutId: all.handoutId, remove: true })
  assert.equal((await state(oren.cookie)).presenting, undefined)
  assert.deepEqual((await state(oren.cookie)).handouts!.map(item => item.title), ['Secret map'])
  await command({ type: 'undo' })
  assert.deepEqual((await state(oren.cookie)).handouts!.map(item => item.title).sort(), ['Secret map', 'Town notice'])
})
