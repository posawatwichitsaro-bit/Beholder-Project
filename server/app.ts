import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import { createServer } from 'node:http'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import type { Member, Room } from '../shared/model.ts'
import { applyCommand, Conflict, Forbidden, snapshot, text, visibleRolls } from './commands.ts'
import type { Command } from './commands.ts'
import { Invalid } from './rules.ts'
import type { Database, Query } from './store.ts'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const hash = (secret: string) => createHash('sha256').update(secret).digest('hex')
const cookieName = 'beholder_seat'
const secretFrom = (cookie = '') => cookie.split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1)

export async function createApp(database: Database, assetDirectory: string) {
  const assets = resolve(assetDirectory)
  await mkdir(assets, { recursive: true })
  const app = express()
  app.disable('x-powered-by')
  const server = createServer(app)
  const sockets = new WebSocketServer({ noServer: true })
  const subscribers = new Map<WebSocket, { roomId: string; memberId: string }>()

  async function roomBy(query: Query, id: string, lock = false) {
    if (!uuid.test(id)) throw new Invalid('รหัสห้องไม่ถูกต้อง')
    const { rows } = await query<{ state: Room }>('SELECT state FROM rooms WHERE id = $1' + (lock ? ' FOR UPDATE' : ''), [id])
    if (!rows[0]) throw new Invalid('ไม่พบห้อง')
    return rows[0].state
  }
  async function memberId(query: Query, roomId: string, cookie?: string) {
    const secret = secretFrom(cookie)
    if (!secret || !uuid.test(roomId)) throw new Forbidden('กรุณาเข้าห้องก่อน')
    const { rows } = await query<{ member_id: string }>('SELECT member_id FROM sessions WHERE room_id = $1 AND token_hash = $2', [roomId, hash(secret)])
    if (!rows[0]) throw new Forbidden('กรุณาเข้าห้องก่อน')
    return rows[0].member_id
  }
  function memberOf(room: Room, memberId: string) {
    const member = room.members.find(entry => entry.id === memberId)
    if (!member) throw new Forbidden('สิทธิ์เข้าห้องหมดอายุ')
    return member
  }
  async function issue(query: Query, room: Room, member: Member) {
    const secret = randomBytes(32).toString('hex')
    await query('INSERT INTO sessions VALUES ($1,$2,$3)', [hash(secret), room.id, member.id])
    return secret
  }
  function setSeat(req: Request, res: Response, room: Room, secret: string) {
    res.cookie(cookieName, secret, { httpOnly: true, sameSite: 'strict', secure: req.secure || process.env.SECURE_COOKIES === '1', path: '/api/rooms/' + room.id, maxAge: 90 * 86400000 })
  }
  function send(socket: WebSocket, room: Room, id: string) {
    if (socket.readyState !== WebSocket.OPEN) return
    if (socket.bufferedAmount > 2_000_000) return socket.close(1013)
    socket.send(JSON.stringify(snapshot(room, memberOf(room, id))))
  }
  function publish(room: Room) {
    for (const [socket, seat] of subscribers) {
      if (seat.roomId === room.id) send(socket, room, seat.memberId)
    }
  }
  async function save(query: Query, room: Room) {
    room.revision++
    await query('UPDATE rooms SET state = $2 WHERE id = $1', [room.id, JSON.stringify(room)])
  }
  const sameOrigin = (origin: string | undefined, host: string | undefined) =>
    !origin || origin === 'https://' + host || origin === 'http://' + host

  app.use('/api', (req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
    if (!sameOrigin(req.headers.origin, req.headers.host)) return next(new Forbidden('Origin ไม่ถูกต้อง'))
    next()
  })
  app.use(express.json({ limit: '64kb' }))
  app.get('/api/health', async (_req, res) => {
    await database.query('SELECT 1')
    res.json({ status: 'ok' })
  })
  app.post('/api/rooms', async (req, res) => {
    const member: Member = { id: randomUUID(), name: text(req.body?.member), role: 'dm' }
    const room: Room = {
      id: randomUUID(), invite: randomUUID(), name: text(req.body?.name), revision: 0,
      members: [member], scenes: [], actors: [], templates: [], rolls: []
    }
    const secret = await database.transaction(async query => {
      await query('INSERT INTO rooms VALUES ($1,$2,$3)', [room.id, room.invite, JSON.stringify(room)])
      return issue(query, room, member)
    })
    setSeat(req, res, room, secret)
    res.status(201).json(snapshot(room, member))
  })
  app.post('/api/join', async (req, res) => {
    const invite = text(req.body?.invite)
    if (!uuid.test(invite)) throw new Invalid('ลิงก์เชิญไม่ถูกต้อง')
    const member: Member = { id: randomUUID(), name: text(req.body?.name), role: 'player' }
    const { room, secret } = await database.transaction(async query => {
      const { rows } = await query<{ state: Room }>('SELECT state FROM rooms WHERE invite = $1 FOR UPDATE', [invite])
      if (!rows[0]) throw new Invalid('ลิงก์เชิญไม่ถูกต้อง')
      const room = rows[0].state
      room.members.push(member)
      const secret = await issue(query, room, member)
      await save(query, room)
      return { room, secret }
    })
    setSeat(req, res, room, secret)
    publish(room)
    res.json(snapshot(room, member))
  })
  app.get('/api/rooms/:id', async (req, res) => {
    const id = await memberId(database.query, req.params.id, req.headers.cookie)
    const room = await roomBy(database.query, req.params.id)
    res.json(snapshot(room, memberOf(room, id)))
  })
  app.get('/api/rooms/:id/rolls', async (req, res) => {
    const id = await memberId(database.query, req.params.id, req.headers.cookie)
    const room = await roomBy(database.query, req.params.id)
    const rolls = visibleRolls(room, memberOf(room, id))
    const end = req.query.before ? rolls.findIndex(roll => roll.id === req.query.before) : rolls.length
    res.json(end < 0 ? [] : rolls.slice(Math.max(0, end - 40), end))
  })
  app.post('/api/rooms/:id/commands', async (req, res) => {
    const command = req.body as Command
    if (!command || typeof command.commandId !== 'string' || !uuid.test(command.commandId)) throw new Invalid('รหัสคำสั่งไม่ถูกต้อง')
    const roomId = req.params.id
    const result = await database.transaction(async query => {
      const id = await memberId(query, roomId, req.headers.cookie)
      const room = await roomBy(query, roomId, true)
      const member = memberOf(room, id)
      const key = [roomId, id, command.commandId, JSON.stringify(command)]
      const { rows } = await query<{ matches: boolean; result: object }>(
        'SELECT payload = $4::jsonb AS matches, result FROM command_receipts WHERE room_id=$1 AND member_id=$2 AND command_id=$3', key
      )
      if (rows[0]) {
        if (!rows[0].matches) throw new Conflict('รหัสคำสั่งนี้ถูกใช้แล้ว')
        return { receipt: rows[0].result }
      }
      if (command.revision !== room.revision) throw new Conflict('ข้อมูลเปลี่ยนแล้ว กรุณาลองอีกครั้ง')
      const output = applyCommand(room, member, command)
      await save(query, room)
      const receipt = { revision: room.revision, ...output }
      await query('INSERT INTO command_receipts VALUES ($1,$2,$3,$4,$5)', [...key, JSON.stringify(receipt)])
      return { room, receipt }
    })
    if (result.room) publish(result.room)
    res.json(result.receipt)
  })
  app.put('/api/rooms/:id/scenes/:sceneId/map', express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '15mb' }), async (req, res) => {
    const id = await memberId(database.query, req.params.id, req.headers.cookie)
    const initial = await roomBy(database.query, req.params.id)
    if (memberOf(initial, id).role !== 'dm') throw new Forbidden('สงวนให้ DM')
    if (!Buffer.isBuffer(req.body)) throw new Invalid('ใช้ไฟล์ PNG, JPEG หรือ WebP')
    const bytes = req.body
    const mime = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'image/png'
      : bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) ? 'image/jpeg'
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : ''
    if (mime !== req.headers['content-type']) throw new Invalid('ชนิดไฟล์ไม่ตรงกับข้อมูลภาพ')
    const map = { id: randomUUID(), mime }
    const path = resolve(assets, map.id)
    await writeFile(path, bytes, { flag: 'wx' })
    let room: Room
    try {
      room = await database.transaction(async query => {
        const room = await roomBy(query, req.params.id, true)
        const scene = room.scenes.find(item => item.id === req.params.sceneId)
        if (!scene) throw new Invalid('ไม่พบฉาก')
        scene.map = map
        await save(query, room)
        return room
      })
    } catch (error) {
      await unlink(path).catch(() => {})
      throw error
    }
    publish(room)
    res.status(204).end()
  })
  app.get('/api/rooms/:id/maps/:assetId', async (req, res) => {
    const id = await memberId(database.query, req.params.id, req.headers.cookie)
    const room = await roomBy(database.query, req.params.id)
    const member = memberOf(room, id)
    const map = room.scenes.find(scene => scene.map?.id === req.params.assetId && (member.role === 'dm' || scene.id === room.activeSceneId))?.map
    if (!map) throw new Forbidden('ไม่สามารถเปิดภาพนี้ได้')
    res.type(map.mime).sendFile(map.id, { root: assets })
  })
  server.on('upgrade', (req, socket, head) => {
    const route = /^\/api\/rooms\/([0-9a-f-]+)\/socket$/i.exec(req.url ?? '')
    if (!route || !sameOrigin(req.headers.origin, req.headers.host)) return socket.destroy()
    const roomId = route[1]
    const onSocketError = () => socket.destroy()
    socket.on('error', onSocketError)
    void memberId(database.query, roomId, req.headers.cookie).then(id => {
      socket.off('error', onSocketError)
      sockets.handleUpgrade(req, socket, head, ws => {
        subscribers.set(ws, { roomId, memberId: id })
        ws.on('close', () => subscribers.delete(ws))
        ws.on('error', () => ws.terminate())
        void roomBy(database.query, roomId).then(room => send(ws, room, id)).catch(() => ws.close(1011))
      })
    }).catch(() => socket.destroy())
  })
  app.use(express.static('dist'))
  app.get('/{*path}', (req, res) => {
    if (req.path.startsWith('/api/')) res.sendStatus(404)
    else res.sendFile(resolve('dist/index.html'))
  })
  app.use((error: Error & { status?: number }, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error)
    const status = error instanceof Invalid ? 400 : error instanceof Forbidden ? 403 : error instanceof Conflict ? 409 : error.status ?? 500
    if (status === 500) console.error(error)
    res.status(status).json({ error: status === 500 ? 'เซิร์ฟเวอร์มีปัญหา' : error.message })
  })
  return server
}
