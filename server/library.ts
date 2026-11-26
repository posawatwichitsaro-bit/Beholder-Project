import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import type { Request } from 'express'
import type { SavedObject, Template } from '../shared/model.ts'
import { Conflict, Forbidden, parseObjectDefinition, parseSheet, text } from './commands.ts'
import type { AuthThrottle } from './authThrottle.ts'
import { Invalid } from './rules.ts'
import type { Database, Query } from './store.ts'
import { accountCookie, activeProfile, endProfileSession, libraryCookie, passwordRecord, validPassword, verifyPassword, startProfileSession } from './profiles.ts'

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const cookiePath = '/api/library'

async function libraryOwner(query: Query, cookie?: string) {
  const owner = await activeProfile(query, accountCookie, cookie, false, true) ?? await activeProfile(query, libraryCookie, cookie, false, true)
  if (!owner) throw new Forbidden('กรุณาเข้าคลังส่วนตัวก่อน')
  return owner
}

export function libraryRoutes(database: Database, allowAttempt: AuthThrottle) {
  const router = Router()
  const profile = (req: Request) => libraryOwner(database.query, req.headers.cookie)
  router.post('/session', async (req, res) => {
    const name = text(req.body?.name, 40).normalize('NFKC').trim()
    const key = name.toLowerCase()
    const password = req.body?.password
    const mode = req.body?.mode
    if (!key || key.length > 40 || (mode !== 'register' && mode !== 'login') || !validPassword(password, mode === 'register')) {
      throw new Invalid(mode === 'register' ? 'กรอกชื่อโปรไฟล์และรหัสผ่าน 15–128 ตัวอักษร' : 'กรอกชื่อโปรไฟล์และรหัสผ่านให้ถูกต้อง')
    }
    if (!allowAttempt(req, res, 'library', key, mode)) return
    let id: string
    if (mode === 'register') {
      id = randomUUID()
      const { salt, passwordHash } = await passwordRecord(password)
      const result = await database.query(
        'INSERT INTO profiles (id,name,name_key,salt,password_hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (name_key) DO NOTHING RETURNING id',
        [id, name, key, salt, passwordHash]
      )
      if (!result.rows.length) throw new Conflict('ชื่อโปรไฟล์นี้มีผู้ใช้แล้ว')
    } else {
      const { rows } = await database.query<{ id: string; salt: string; password_hash: string }>(
        'SELECT id,salt,password_hash FROM profiles WHERE name_key=$1 AND email IS NULL', [key]
      )
      const entry = rows[0]
      if (!await verifyPassword(database.query, password, entry)) throw new Forbidden('ชื่อโปรไฟล์หรือรหัสผ่านไม่ถูกต้อง')
      id = entry.id
    }
    await startProfileSession(database, req, res, libraryCookie, cookiePath, id)
    res.status(204).end()
  })
  router.delete('/session', async (req, res) => {
    await endProfileSession(database, req, res, libraryCookie, cookiePath)
    res.status(204).end()
  })
  router.get('/', async (req, res) => {
    const { id, name } = await profile(req)
    const [sheets, objects] = await Promise.all([
      database.query<Template>("SELECT id,sheet FROM library_sheets WHERE profile_id=$1 ORDER BY sheet->>'name',id", [id]),
      database.query<SavedObject>("SELECT id,definition FROM library_objects WHERE profile_id=$1 ORDER BY definition->>'name',id", [id])
    ])
    res.json({ name, sheets: sheets.rows, objects: objects.rows })
  })
  router.put('/objects/:id', async (req, res) => {
    const owner = await profile(req)
    const id = req.params.id
    if (!uuid.test(id)) throw new Invalid('รหัส Object ไม่ถูกต้อง')
    const definition = parseObjectDefinition(req.body)
    const { rows } = await database.query(
      'INSERT INTO library_objects VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET definition=EXCLUDED.definition WHERE library_objects.profile_id=$2 RETURNING id',
      [id, owner.id, JSON.stringify(definition)]
    )
    if (!rows.length) throw new Forbidden('Object นี้อยู่ในคลังอื่น')
    res.json({ id, definition })
  })
  router.delete('/objects/:id', async (req, res) => {
    const owner = await profile(req)
    if (!uuid.test(req.params.id)) throw new Invalid('รหัส Object ไม่ถูกต้อง')
    await database.query('DELETE FROM library_objects WHERE id=$1 AND profile_id=$2', [req.params.id, owner.id])
    res.status(204).end()
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
