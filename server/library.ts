import { Router } from 'express'
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { Request } from 'express'
import type { Template } from '../shared/model.ts'
import { Conflict, Forbidden, parseSheet, text } from './commands.ts'
import { Invalid } from './rules.ts'
import type { Database } from './store.ts'

const derive = promisify(scrypt)
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const cookie = 'beholder_profile'
const cookiePath = '/api/library'
const duration = 30 * 86400000
const digest = (secret: string) => createHash('sha256').update(secret).digest('hex')

export function libraryRoutes(database: Database) {
  const router = Router()
  const secretFrom = (req: Request) => req.headers.cookie?.split(';').map(value => value.trim())
    .find(value => value.startsWith(cookie + '='))?.slice(cookie.length + 1)
  async function profile(req: Request) {
    const secret = secretFrom(req)
    if (!secret) throw new Forbidden('กรุณาเข้าคลังส่วนตัวก่อน')
    const { rows } = await database.query<{ id: string; name: string }>(
      'SELECT p.id,p.name FROM profiles p JOIN profile_sessions s ON s.profile_id=p.id WHERE s.token_hash=$1 AND s.expires_at > now()',
      [digest(secret)]
    )
    if (!rows[0]) throw new Forbidden('กรุณาเข้าคลังส่วนตัวก่อน')
    return rows[0]
  }
  router.post('/session', async (req, res) => {
    const name = text(req.body?.name, 40).normalize('NFKC').trim()
    const key = name.toLowerCase()
    const password = req.body?.password
    const mode = req.body?.mode
    if (!key || key.length > 40 || typeof password !== 'string' || password.length < 8 || password.length > 128 ||
      (mode !== 'register' && mode !== 'login')) throw new Invalid('กรอกชื่อโปรไฟล์และรหัสผ่าน 8–128 ตัวอักษร')
    let id: string
    if (mode === 'register') {
      id = randomUUID()
      const salt = randomBytes(16).toString('hex')
      const passwordHash = (await derive(password, salt, 64) as Buffer).toString('hex')
      const result = await database.query(
        'INSERT INTO profiles VALUES ($1,$2,$3,$4,$5) ON CONFLICT (name_key) DO NOTHING RETURNING id',
        [id, name, key, salt, passwordHash]
      )
      if (!result.rows.length) throw new Conflict('ชื่อโปรไฟล์นี้มีผู้ใช้แล้ว')
    } else {
      const { rows } = await database.query<{ id: string; salt: string; password_hash: string }>(
        'SELECT id,salt,password_hash FROM profiles WHERE name_key=$1', [key]
      )
      const entry = rows[0]
      const actual = await derive(password, entry?.salt ?? 'beholder-unknown-profile', 64) as Buffer
      if (!entry || !timingSafeEqual(Buffer.from(entry.password_hash, 'hex'), actual)) throw new Forbidden('ชื่อโปรไฟล์หรือรหัสผ่านไม่ถูกต้อง')
      id = entry.id
    }
    const secret = randomBytes(32).toString('hex')
    const previous = secretFrom(req)
    await database.transaction(async query => {
      if (previous) await query('DELETE FROM profile_sessions WHERE token_hash=$1', [digest(previous)])
      await query('INSERT INTO profile_sessions VALUES ($1,$2,$3)', [digest(secret), id, new Date(Date.now() + duration)])
    })
    res.cookie(cookie, secret, { path: cookiePath, httpOnly: true, sameSite: 'strict', secure: req.secure || process.env.SECURE_COOKIES === '1', maxAge: duration })
    res.status(204).end()
  })
  router.delete('/session', async (req, res) => {
    const secret = secretFrom(req)
    if (secret) await database.query('DELETE FROM profile_sessions WHERE token_hash=$1', [digest(secret)])
    res.clearCookie(cookie, { path: cookiePath })
    res.status(204).end()
  })
  router.get('/', async (req, res) => {
    const { id, name } = await profile(req)
    const { rows } = await database.query<Template>('SELECT id,sheet FROM library_sheets WHERE profile_id=$1 ORDER BY sheet->>\'name\',id', [id])
    res.json({ name, sheets: rows })
  })
  router.put('/sheets/:id', async (req, res) => {
    const owner = await profile(req)
    const id = req.params.id
    if (!uuid.test(id)) throw new Invalid('รหัสชีตไม่ถูกต้อง')
    const kind = req.body?.kind
    if (kind !== 'pc' && kind !== 'monster') throw new Invalid('ประเภทชีตไม่ถูกต้อง')
    const sheet = parseSheet(req.body, kind)
    const { rows } = await database.query(
      'INSERT INTO library_sheets VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET sheet=EXCLUDED.sheet WHERE library_sheets.profile_id=$2 RETURNING id',
      [id, owner.id, JSON.stringify(sheet)]
    )
    if (!rows.length) throw new Forbidden('ชีตนี้อยู่ในคลังอื่น')
    res.json({ id, sheet })
  })
  router.delete('/sheets/:id', async (req, res) => {
    const owner = await profile(req)
    if (!uuid.test(req.params.id)) throw new Invalid('รหัสชีตไม่ถูกต้อง')
    await database.query('DELETE FROM library_sheets WHERE id=$1 AND profile_id=$2', [req.params.id, owner.id])
    res.status(204).end()
  })
  return router
}
