import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import type { Snapshot } from '../../shared/model.ts'
import { useRoomStore } from './roomStore.ts'
import { sendCommand } from './useCommand.ts'
import { hpPercent, hpTone } from '../ui/hp.ts'

const room = (revision: number, overrides: Partial<Snapshot> = {}) =>
  ({ id: 'room-1', revision, me: { id: 'm1', name: 'Mira', role: 'player' }, ...overrides }) as unknown as Snapshot

type Call = { url: string; body?: Record<string, unknown> }
let calls: Call[] = []
const realFetch = globalThis.fetch

function respond(handler: (call: Call) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    return handler(call)
  }) as typeof fetch
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  calls = []
  useRoomStore.getState().enterRoom(room(5))
})
afterEach(() => { globalThis.fetch = realFetch })

test('the store ignores snapshots older than the one it holds', () => {
  const store = useRoomStore.getState()
  store.accept(room(4))
  assert.equal(useRoomStore.getState().room?.revision, 5)
  store.accept(room(7))
  assert.equal(useRoomStore.getState().room?.revision, 7)
  store.accept(room(1, { id: 'room-2' }))
  assert.equal(useRoomStore.getState().room?.id, 'room-2', 'a different room always replaces the held one')
})

test('a command carries the current revision, refreshes the room and clears pending', async () => {
  respond(call => call.url.endsWith('/commands') ? ok({ sceneId: 'scene-9' }) : ok(room(6)))
  let created = ''
  assert.equal(await sendCommand({ type: 'roll', formula: '1d20' }, id => { created = id }), true)
  const command = calls.find(call => call.url.endsWith('/commands'))!
  assert.equal(command.body?.revision, 5)
  assert.match(String(command.body?.commandId), /^[0-9a-f-]{36}$/)
  assert.equal(command.body?.privateRoll, false)
  assert.equal(useRoomStore.getState().room?.revision, 6)
  assert.equal(useRoomStore.getState().pending, 0)
  assert.equal(created, 'scene-9')
})

test('only one command runs at a time', async () => {
  let release!: () => void
  respond(call => call.url.endsWith('/commands')
    ? new Promise(resolve => { release = () => resolve(ok({})) })
    : ok(room(6)))
  const first = sendCommand({ type: 'roll' })
  assert.equal(useRoomStore.getState().pending, 1)
  assert.equal(await sendCommand({ type: 'roll' }), false)
  release()
  assert.equal(await first, true)
  assert.equal(calls.filter(call => call.url.endsWith('/commands')).length, 1)
})

test('a lost response is retried once with the same command id', async () => {
  let attempts = 0
  respond(call => {
    if (!call.url.endsWith('/commands')) return ok(room(6))
    attempts++
    if (attempts === 1) throw new TypeError('network down')
    return ok({})
  })
  assert.equal(await sendCommand({ type: 'roll' }), true)
  const sent = calls.filter(call => call.url.endsWith('/commands'))
  assert.equal(sent.length, 2)
  assert.equal(sent[0].body?.commandId, sent[1].body?.commandId)
})

test('a rejected command reports the server message and is not retried', async () => {
  respond(call => call.url.endsWith('/commands')
    ? new Response(JSON.stringify({ error: 'ให้ Token เข้าใกล้เป้าหมายก่อน' }), { status: 400 })
    : ok(room(5)))
  assert.equal(await sendCommand({ type: 'roll' }), false)
  assert.equal(useRoomStore.getState().error, 'ให้ Token เข้าใกล้เป้าหมายก่อน')
  assert.equal(calls.filter(call => call.url.endsWith('/commands')).length, 1)
})

test('DM private rolls apply only to roll-type commands', async () => {
  useRoomStore.getState().enterRoom(room(5, { me: { id: 'd', name: 'DM', role: 'dm' } } as Partial<Snapshot>))
  useRoomStore.getState().setPrivateRoll(true)
  respond(call => call.url.endsWith('/commands') ? ok({}) : ok(room(6)))
  await sendCommand({ type: 'sheetRoll' })
  await sendCommand({ type: 'adjustHp' })
  const [roll, adjust] = calls.filter(call => call.url.endsWith('/commands'))
  assert.equal(roll.body?.privateRoll, true)
  assert.equal(adjust.body?.privateRoll, false)
})

test('HP bars change band at half and a quarter, and keep friend and foe apart above half', () => {
  assert.equal(hpTone(24, 24, 'ally'), 'ally')
  assert.equal(hpTone(10, 10, 'foe'), 'foe')
  assert.equal(hpTone(12, 24, 'ally'), 'warn')
  assert.equal(hpTone(6, 24, 'foe'), 'critical')
  assert.equal(hpTone(0, 24, 'ally'), 'down')
  assert.equal(hpPercent(30, 24), 100)
  assert.equal(hpPercent(-3, 24), 0)
  assert.equal(hpPercent(7, 10), 70)
})
