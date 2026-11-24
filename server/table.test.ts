import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { PGlite } from '@electric-sql/pglite'
import { createApp } from './app.ts'
import { migrate } from './store.ts'
import { blankSheet } from '../shared/model.ts'
import type { Snapshot } from '../shared/model.ts'

test('DM and two players share scenes, dice, combat and reconnect state', { timeout: 30000 }, async t => {
  let base = process.env.BEHOLDER_TEST_URL
  if (!base) {
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
    base = 'http://127.0.0.1:' + address.port
    t.after(async () => {
      await new Promise<void>(done => server.close(() => done()))
      await db.close()
      await rm(assets, { recursive: true, force: true })
    })
  }

  const post = (body: object, cookie?: string) => ({
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body)
  })
  const opened = await fetch(base + '/api/rooms', post({ member: 'DM', name: 'Phase 1 verification' }))
  assert.equal(opened.status, 201)
  const dm = opened.headers.get('set-cookie')!.split(';')[0]
  const initial: Snapshot = await opened.json()
  const path = base + '/api/rooms/' + initial.id
  const library = base + '/api/library'
  const name = 'Test-' + randomUUID().slice(0, 12)
  const credentials = { name, password: 'integration-test-pass' }
  const registered = await fetch(library + '/session', post({ ...credentials, mode: 'register' }))
  assert.equal(registered.status, 204)
  const profile = registered.headers.get('set-cookie')!.split(';')[0]
  const savedSheet = library + '/sheets/' + randomUUID()
  const custom = { ...blankSheet('monster'), name: 'Private rat' }
  const save = (cookie: string) => fetch(savedSheet, { ...post(custom, cookie), method: 'PUT' })
  assert.equal((await save(profile)).status, 200)
  const wrongPassword = await fetch(library + '/session', post({ ...credentials, password: 'wrong-password', mode: 'login' }))
  assert.equal(wrongPassword.status, 403)
  const duplicate = await fetch(library + '/session', post({ ...credentials, name: name.toUpperCase(), mode: 'register' }))
  assert.equal(duplicate.status, 409)
  const another = await fetch(library + '/session', post({ ...credentials, name: name + '-other', mode: 'register' }))
  const anotherProfile = another.headers.get('set-cookie')!.split(';')[0]
  assert.equal((await save(anotherProfile)).status, 403)
  const privateContents = await fetch(library, { headers: { Cookie: anotherProfile } })
  assert.deepEqual((await privateContents.json()).sheets, [])
  assert.equal((await fetch(library, { headers: { Cookie: dm } })).status, 403)
  const signIn = await fetch(library + '/session', post({ ...credentials, name: name.toUpperCase(), mode: 'login' }))
  assert.equal(signIn.status, 204)
  const profileAfterLogin = signIn.headers.get('set-cookie')!.split(';')[0]
  async function checkLibrary() {
    const response = await fetch(library, { headers: { Cookie: profileAfterLogin } })
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).sheets.map((entry: { sheet: { name: string } }) => entry.sheet.name), ['Private rat'])
  }
  await checkLibrary()
  async function joinRoom(name: string) {
    const response = await fetch(base + '/api/join', post({ invite: initial.invite, name }))
    assert.equal(response.status, 200)
    return response.headers.get('set-cookie')!.split(';')[0]
  }
  const player = await joinRoom('Player one')
  const other = await joinRoom('Player two')
  async function state(cookie = dm): Promise<Snapshot> {
    const response = await fetch(path, { headers: { Cookie: cookie } })
    assert.equal(response.status, 200)
    return response.json()
  }
  async function command(body: object, cookie = dm, status = 200) {
    const response = await fetch(path + '/commands', post({ revision: (await state(cookie)).revision, commandId: randomUUID(), ...body }, cookie))
    const result = await response.json()
    assert.equal(response.status, status, JSON.stringify(result))
    return result
  }
  const privileged = (invite: string) => fetch(base + '/api/join', post({ invite, name: 'Co-DM', role: 'dm', roomId: initial.id }))
  assert.equal((await privileged(initial.invite!)).status, 403)
  await command({ type: 'dmInvite' }, player, 403)
  await command({ type: 'dmInvite' })
  const dmInvite = (await state()).dmInvite!
  assert.equal((await state(player)).dmInvite, undefined)
  const coDM = await privileged(dmInvite)
  assert.equal(coDM.status, 200)
  assert.equal((await coDM.json()).me.role, 'dm')
  assert.equal((await privileged(dmInvite)).status, 403)
  for (const name of ['Gate', 'Vault']) await command({ type: 'scene', name, cell: 48, originX: 0, originY: 0 })
  const [gate, vault] = (await state()).scenes
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=', 'base64')
  const uploaded = await fetch(path + '/scenes/' + vault.id + '/map', { method: 'PUT', headers: { Cookie: dm, 'Content-Type': 'image/png' }, body: image })
  assert.equal(uploaded.status, 204)
  const mapId = (await state()).scenes[1].map!.id
  assert.equal((await fetch(path + '/maps/' + mapId, { headers: { Cookie: player } })).status, 403)
  assert.equal((await state(player)).scenes.length, 1)

  await command({ type: 'sheet', sheet: {
    ...blankSheet(), name: 'Scout', hp: 7, tempHp: 3, attacks: [{ name: 'Rapier', bonus: 4, damage: '1d8+2' }]
  } }, player)
  await command({ type: 'sheet', sheet: { ...blankSheet(), name: 'Mage', spellDC: 15 } }, other)
  const [scout, mage] = (await state()).actors
  await command({ type: 'template', sheet: { ...blankSheet('monster'), name: 'Rat', attack: 50, ac: 1 } })
  const template = (await state()).templates[0]
  for (const [index, actor] of [scout, mage].entries()) {
    await command({ type: 'place', sceneId: gate.id, actorId: actor.id, x: index, y: 0 })
    await command({ type: 'place', sceneId: vault.id, actorId: actor.id, x: index, y: 0 })
  }
  for (const x of [2, 3]) await command({ type: 'place', sceneId: vault.id, templateId: template.id, x, y: 0 })
  const [scoutToken, mageToken] = (await state()).scenes[0].tokens
  await command({ type: 'move', sceneId: gate.id, tokenId: mageToken.id, x: 3, y: 2 }, player, 403)
  const socket = new WebSocket(path.replace(/^http/, 'ws') + '/socket', { headers: { Cookie: other } })
  const closed = once(socket, 'close')
  try {
    const [first] = await once(socket, 'message')
    assert.equal((JSON.parse(first.toString()) as Snapshot).members.length, 4)
    const pushed = once(socket, 'message')
    await command({ type: 'move', sceneId: gate.id, tokenId: scoutToken.id, x: 1, y: 1 }, player)
    const [message] = await pushed
    assert.equal((JSON.parse(message.toString()) as Snapshot).scenes[0].tokens[0].x, 1)
  } finally { socket.close(); await closed }

  const roll = { type: 'sheetRoll', rollType: 'check', actorId: scout.id, ability: 'WIS', advantage: true, disadvantage: true, revision: (await state()).revision, commandId: randomUUID() }
  const receipt = await command(roll, player)
  assert.deepEqual(await command(roll, player), receipt)
  assert.equal((await state(other)).rolls.find(item => item.id === receipt.rollId)?.faces.length, 1)
  const weapon = await command({ type: 'sheetRoll', rollType: 'damage', actorId: scout.id, weaponIndex: 0 }, player)
  assert.equal((await state(other)).rolls.find(item => item.id === weapon.rollId)?.formula, '1d8+2')
  await command({ type: 'activate', sceneId: vault.id })
  assert.equal((await fetch(path + '/maps/' + mapId, { headers: { Cookie: player } })).status, 200)
  await command({ type: 'move', sceneId: gate.id, tokenId: scoutToken.id, x: 4, y: 4 }, player, 409)
  const [, , ratA, ratB] = (await state()).actors
  await command({ type: 'combat', sceneId: vault.id, participants: [scout.id, mage.id, ratA.id, ratB.id] })
  const spell = await command({ type: 'castSave', sceneId: vault.id, actorId: mage.id, targetId: ratA.id, label: 'Test spell', ability: 'DEX', formula: '1d8', half: true }, other)
  await command({ type: 'spellSave', sceneId: vault.id, rollId: spell.rollId }, player, 403)
  const spellDamage = await command({ type: 'spellSave', sceneId: vault.id, rollId: spell.rollId })
  await command({ type: 'damage', sceneId: vault.id, actorId: ratA.id, rollId: spellDamage.rollId, amount: 2 })
  assert.equal((await state()).actors.find(actor => actor.id === ratB.id)?.hp, 10)
  const ratAttack = { type: 'sheetRoll', rollType: 'attack', sceneId: vault.id, actorId: ratB.id, targetId: scout.id, advantage: true }
  let result = await command(ratAttack)
  for (let attempt = 0; !result.rollId && attempt < 5; attempt++) result = await command(ratAttack)
  assert.ok(result.rollId)
  const apply = { type: 'damage', sceneId: vault.id, actorId: scout.id, rollId: result.rollId, amount: 8 }
  const revision = (await state()).revision
  const simultaneous = await Promise.all([1, 2].map(() => fetch(path + '/commands', post({ ...apply, revision, commandId: randomUUID() }, dm))))
  assert.deepEqual(simultaneous.map(response => response.status).sort(), [200, 409])
  await command(apply)
  const injured = (await state(player)).actors[0]
  assert.deepEqual([injured.hp, injured.tempHp], [2, 0])
  for (let turn = 0; turn < 4; turn++) await command({ type: 'next', sceneId: vault.id })
  await command({ type: 'activate', sceneId: gate.id })
  const reconnected = await state(player)
  assert.equal(reconnected.actors[0].hp, 2)
  assert.equal(reconnected.scenes[0].tokens[0].x, 1)
  await command({ type: 'activate', sceneId: vault.id })
  assert.equal((await state(player)).scenes[0].combat?.round, 2)
  await command({ type: 'heal', actorId: scout.id, amount: 3 })
  await command({ type: 'slots', actorId: mage.id, slots: 'Lv1: 1/2' }, other)
  assert.equal((await state(player)).actors[0].hp, 5)
  assert.equal((await state(other)).actors[0].slots, 'Lv1: 1/2')
  if (process.env.BEHOLDER_TEST_RESTART === '1' && process.env.BEHOLDER_TEST_URL) {
    execFileSync('docker', ['compose', 'restart'], { timeout: 12000, stdio: 'pipe' })
    for (let attempt = 0; attempt < 20; attempt++) {
      const ready = await fetch(base + '/api/health').then(response => response.ok).catch(() => false)
      if (ready) break
      await new Promise(resolve => setTimeout(resolve, 400))
    }
    const restored = await state(player)
    assert.equal(restored.actors[0].hp, 5)
    assert.equal(restored.scenes[0].id, vault.id)
    assert.equal(restored.scenes[0].combat?.round, 2)
    const savedImage = await fetch(path + '/maps/' + mapId, { headers: { Cookie: player } })
    assert.equal(savedImage.status, 200)
    assert.deepEqual(Buffer.from(await savedImage.arrayBuffer()), image)
    await checkLibrary()
  }
})
