import assert from 'node:assert/strict'
import { randomUUID, scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { WebSocket } from 'ws'
import { createApp } from './app.ts'
import { migrate } from './store.ts'

test('account auth upgrades legacy hashes, rotates credentials and enforces session boundaries', { timeout: 30000 }, async t => {
  const db = new PGlite()
  const database = {
    query: db.query.bind(db),
    transaction: <T>(work: (query: typeof db.query) => Promise<T>) => db.transaction(transaction => work(transaction.query.bind(transaction)))
  }
  const assets = await mkdtemp(join(tmpdir(), 'beholder-auth-'))
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
  const account = base + '/api/account'
  const post = (body: object, headers?: Record<string, string>) => ({
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
  })
  const credentials = { email: 'hero@example.com', name: 'Hero', password: 'old-pass' }
  assert.equal((await fetch(account + '/session', post({ ...credentials, mode: 'register' }))).status, 400)

  const id = randomUUID()
  const salt = 'fce234a454d63c576458dce79d32ef54'
  await db.query('INSERT INTO profiles (id,name,name_key,email,salt,password_hash) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, credentials.name, 'email:' + id, credentials.email, salt, scryptSync(credentials.password, salt, 64).toString('hex')])
  const login = (headers?: Record<string, string>) =>
    fetch(account + '/session', post({ ...credentials, mode: 'login' }, headers))
  assert.equal((await login({ Origin: 'https://127.0.0.1:' + address.port })).status, 403)
  const signedIn = await login({ Origin: base })
  assert.equal(signedIn.status, 200)
  const cookie = signedIn.headers.get('set-cookie')!
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Strict/)
  assert.match(signedIn.headers.get('cache-control')!, /no-store/)
  const first = { Cookie: cookie.split(';')[0] }
  assert.match((await db.query<{ salt: string }>('SELECT salt FROM profiles WHERE id=$1', [id])).rows[0].salt, /^scrypt-v2:/)

  const rotated = await login(first)
  assert.equal(rotated.status, 200)
  const session = { Cookie: rotated.headers.get('set-cookie')!.split(';')[0] }
  assert.notEqual(first.Cookie, session.Cookie)
  assert.equal(await (await fetch(account, { headers: first })).json(), null)
  const room = await fetch(base + '/api/rooms', post({ name: 'Test table' }, session))
  assert.equal(room.status, 201)
  const path = base + '/api/rooms/' + (await room.json()).id

  await db.query("UPDATE profile_sessions SET idle_expires_at=now()-interval '1 second' WHERE profile_id=$1", [id])
  assert.equal(await (await fetch(account, { headers: session })).json(), null)
  assert.equal((await fetch(path, { headers: session })).status, 403)
  const refreshed = await login(session)
  const active = { Cookie: refreshed.headers.get('set-cookie')!.split(';')[0] }
  const socket = new WebSocket(path.replace(/^http/, 'ws') + '/socket', { headers: active })
  t.after(() => socket.terminate())
  await once(socket, 'message')
  const closed = once(socket, 'close')
  assert.equal((await fetch(account + '/session', { method: 'DELETE', headers: active })).status, 204)
  assert.equal((await closed)[0], 1008)
  assert.equal((await fetch(path, { headers: active })).status, 403)

  const finalLogin = await login()
  assert.equal(finalLogin.status, 200)
  const absolute = { Cookie: finalLogin.headers.get('set-cookie')!.split(';')[0] }
  await db.query("UPDATE profile_sessions SET expires_at=now()-interval '1 second' WHERE profile_id=$1", [id])
  assert.equal(await (await fetch(account, { headers: absolute })).json(), null)

  for (let count = 0; count < 6; count++) {
    const failure = await fetch(account + '/session', post({ ...credentials, mode: 'login', password: 'incorrect-pass' }))
    assert.equal(failure.status, 403)
    assert.deepEqual(await failure.json(), { error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' })
  }
  const limited = await login()
  assert.equal(limited.status, 429)
  assert(Number(limited.headers.get('retry-after')) > 0)
})
