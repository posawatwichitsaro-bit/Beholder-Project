/**
 * `pnpm load` (0.17): how long the server takes per command in a big room.
 *
 * Runs the real app in this process on PGlite (no Docker needed):
 * 6 players with a hero each, 50 monsters, 200 walls, vision on, a
 * 4000 × 4000 map. Then rounds of moves (each player and the DM), and each
 * player fetching their fogged map the way the board does after moving.
 * Prints p50 / p95 / max per kind and the longest main-thread stall while maps render.
 * Report only: there is no pass mark. Real tables run on PostgreSQL, which is
 * usually faster than PGlite, so treat these as an upper bound.
 *
 *   pnpm load                 # 40 rounds
 *   BEHOLDER_LOAD_ROUNDS=100 pnpm load
 */
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import sharp from 'sharp'
import { PGlite } from '@electric-sql/pglite'
import { createApp } from '../server/app.ts'
import { migrate } from '../server/store.ts'
import { blankSheet } from '../shared/model.ts'
import type { Snapshot } from '../shared/model.ts'

const rounds = Number(process.env.BEHOLDER_LOAD_ROUNDS ?? 40)
const db = new PGlite()
const database = {
  query: db.query.bind(db),
  transaction: <T>(work: (query: typeof db.query) => Promise<T>) => db.transaction(transaction => work(transaction.query.bind(transaction)))
}
await migrate(database)
const assets = await mkdtemp(join(tmpdir(), 'beholder-load-'))
const server = await createApp(database, assets)
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
if (!address || typeof address !== 'object') throw new Error('no address')
const base = 'http://127.0.0.1:' + address.port

const timings: Record<string, number[]> = {}
const time = async <T>(kind: string, work: () => Promise<T>) => {
  const start = performance.now()
  const result = await work()
  ;(timings[kind] ??= []).push(performance.now() - start)
  return result
}
const post = (body: object, cookie?: string) => ({
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body)
})
let revision = 0
async function command(body: object, cookie: string, kind?: string) {
  const run = async () => {
    const response = await fetch(path + '/commands', post({ revision, commandId: randomUUID(), ...body }, cookie))
    const json = await response.json()
    if (!response.ok) throw new Error(JSON.stringify(json))
    revision = json.revision
    return json
  }
  return kind ? time(kind, run) : run()
}

console.log('setting up: 6 players, 50 monsters, 200 walls, a 4000 × 4000 map…')
const opened = await fetch(base + '/api/rooms', post({ member: 'DM', name: 'Load' }))
const dm = opened.headers.get('set-cookie')!.split(';')[0]
const initial: Snapshot = await opened.json()
const path = base + '/api/rooms/' + initial.id
revision = initial.revision
const state = async (cookie: string): Promise<Snapshot> => (await fetch(path, { headers: { Cookie: cookie } })).json()

await command({ type: 'scene', name: 'Big hall', cell: 50, originX: 0, originY: 0 }, dm)
const sceneId = (await state(dm)).scenes[0].id
await command({ type: 'activate', sceneId }, dm)
// 200 walls: short pillars on a lattice, so sight lines get cut but rooms stay open.
const walls = Array.from({ length: 200 }, (_, index) => {
  const x = 4 + (index % 20) * 4, y = 4 + Math.floor(index / 20) * 7
  return { a: { x, y }, b: { x: x + 1, y: y + 1 } }
})
await command({ type: 'walls', sceneId, add: walls }, dm)
await command({ type: 'visionSettings', sceneId, enabled: true }, dm)
const picture = await sharp({ create: { width: 4000, height: 4000, channels: 3, background: '#6a5a3a', noise: { type: 'gaussian', mean: 120, sigma: 30 } } })
  .jpeg({ quality: 60 }).toBuffer()
const upload = await fetch(path + '/scenes/' + sceneId + '/map', { method: 'PUT', headers: { Cookie: dm, 'Content-Type': 'image/jpeg' }, body: picture })
if (upload.status !== 204) throw new Error('map upload ' + upload.status + ' (' + (picture.length / 1e6).toFixed(1) + ' MB)')
revision = (await state(dm)).revision
for (let index = 0; index < 50; index++) {
  await command({ type: 'place', sceneId, kind: 'monster', sheet: { ...blankSheet('monster'), name: 'Goblin' }, x: 40 + (index % 10) * 2, y: 40 + Math.floor(index / 10) * 2 }, dm)
}
revision = (await state(dm)).revision
const players: { cookie: string; tokenId: string; x: number; y: number }[] = []
for (let index = 0; index < 6; index++) {
  const joined = await fetch(base + '/api/join', post({ invite: initial.invite, name: 'Player ' + (index + 1) }))
  const cookie = joined.headers.get('set-cookie')!.split(';')[0]
  revision = (await state(cookie)).revision
  const x = 10 + index * 3, y = 10
  await command({ type: 'place', sceneId, sheet: { ...blankSheet(), name: 'Hero ' + (index + 1) }, x, y }, cookie)
  const room = await state(cookie)
  const token = room.scenes[0].tokens.find(item => room.actors.some(actor => actor.id === item.actorId))!
  players.push({ cookie, tokenId: token.id, x, y })
}
const monsterTokens = (await state(dm)).scenes[0].tokens.filter(token => !players.some(player => player.tokenId === token.id))
const mapId = (await state(dm)).scenes[0].map!.id

console.log('running ' + rounds + ' rounds…')
/** The longest the main thread went without running a 5 ms ticker while `work` runs. */
async function longestStall(work: () => Promise<unknown>) {
  let last = performance.now(), worst = 0
  const ticker = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last); last = now }, 5)
  try { await work() } finally { clearInterval(ticker) }
  return Math.max(worst, performance.now() - last)
}
const stalls: number[] = []
for (let round = 0; round < rounds; round++) {
  for (const player of players) {
    player.x += round % 2 ? -1 : 1
    await command({ type: 'move', sceneId, tokenId: player.tokenId, x: player.x, y: player.y }, player.cookie, 'player move')
  }
  const monster = monsterTokens[round % monsterTokens.length]
  await command({ type: 'moveTokens', sceneId, tokenIds: [monster.id], dx: round % 2 ? -1 : 1, dy: 0 }, dm, 'DM moves a monster')
  await time('player snapshot (GET room)', () => state(players[round % players.length].cookie))
  // Every player's board refetches the fogged map after exploring; all at once, while a command goes through.
  stalls.push(await longestStall(() => Promise.all([
    ...players.map(player => time('fogged map (6 at once)', async () => {
      const response = await fetch(path + '/maps/' + mapId + '?seen=' + round, { headers: { Cookie: player.cookie } })
      await response.arrayBuffer()
    })),
    command({ type: 'chat', text: 'round ' + round }, dm, 'command while maps render')
  ])))
}

const ms = (value: number) => value.toFixed(1).padStart(7) + ' ms'
const pick = (list: number[], share: number) => [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * share))]
console.log('\n' + 'kind'.padEnd(30) + '     n' + '      p50' + '        p95' + '        max')
for (const [kind, list] of Object.entries(timings)) {
  console.log(kind.padEnd(30) + String(list.length).padStart(6) + ms(pick(list, .5)) + ms(pick(list, .95)) + ms(Math.max(...list)))
}
console.log('\nlongest main-thread stall per map round: p50 ' + pick(stalls, .5).toFixed(0) + ' ms · p95 ' + pick(stalls, .95).toFixed(0) +
  ' ms · max ' + Math.max(...stalls).toFixed(0) + ' ms (PGlite runs on the main thread here; PostgreSQL would not)')
const final = await state(dm)
console.log('room: ' + final.actors.length + ' creatures, ' + final.scenes[0].vision!.walls!.length + ' walls, revision ' + final.revision +
  ', JSON ' + (JSON.stringify(final).length / 1024).toFixed(0) + ' KB')

await new Promise<void>(done => server.close(() => done()))
await db.close()
await rm(assets, { recursive: true, force: true })
process.exit(0)
