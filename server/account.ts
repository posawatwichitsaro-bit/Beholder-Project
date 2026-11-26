import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { Conflict, Forbidden, text } from './commands.ts'
import { accountCookie, activeProfile, endProfileSession, passwordRecord, validPassword, verifyPassword, profileSecret, startProfileSession } from './profiles.ts'
import type { AuthThrottle } from './authThrottle.ts'
import { Invalid } from './rules.ts'
import type { Database, Query } from './store.ts'

const cookiePath = '/api'

export function accountRoutes(database: Database, rename: (query: Query, id: string, name: string) => Promise<() => void>, revokeSocket: (secret?: string) => void, allowAttempt: AuthThrottle) {
  const router = Router()

  router.get('/', async (req, res) => {
    const account = await activeProfile(database.query, accountCookie, req.headers.cookie)
    res.json(account ? { email: account.email, name: account.name } : null)
  })

  router.post('/session', async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
    const { password, mode } = req.body ?? {}
    if (email.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email) ||
      (mode !== 'register' && mode !== 'login') || !validPassword(password, mode === 'register')) {
      throw new Invalid(mode === 'register' ? 'กรอกอีเมลและรหัสผ่าน 15–128 ตัวอักษร' : 'กรอกอีเมลและรหัสผ่านให้ถูกต้อง')
    }
    if (!allowAttempt(req, res, 'account', email, mode)) return

    let account: { id: string; name: string }
    if (mode === 'register') {
      const id = randomUUID()
      const name = text(req.body?.name, 40)
      const { salt, passwordHash } = await passwordRecord(password)
      const { rows } = await database.query(
        'INSERT INTO profiles (id,name,name_key,salt,password_hash,email) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (email) DO NOTHING RETURNING id',
        [id, name, 'email:' + id, salt, passwordHash, email]
      )
      if (!rows.length) throw new Conflict('อีเมลนี้มีบัญชีแล้ว')
      account = { id, name }
    } else {
      const { rows } = await database.query<{ id: string; name: string; salt: string; password_hash: string }>(
        'SELECT id,name,salt,password_hash FROM profiles WHERE email=$1', [email]
      )
      account = rows[0]
      if (!await verifyPassword(database.query, password, rows[0])) throw new Forbidden('อีเมลหรือรหัสผ่านไม่ถูกต้อง')
    }
    await startProfileSession(database, req, res, accountCookie, cookiePath, account.id)
    revokeSocket(profileSecret(accountCookie, req.headers.cookie))
    res.status(mode === 'register' ? 201 : 200).json({ email, name: account.name })
  })

  router.patch('/', async (req, res) => {
    const name = text(req.body?.name, 40)
    const { email, publish } = await database.transaction(async query => {
      const account = await activeProfile(query, accountCookie, req.headers.cookie)
      if (!account) throw new Forbidden('กรุณาเข้าสู่ระบบก่อน')
      await query('UPDATE profiles SET name=$2 WHERE id=$1', [account.id, name])
      return { email: account.email, publish: await rename(query, account.id, name) }
    })
    publish()
    res.json({ name, email })
  })

  router.delete('/session', async (req, res) => {
    await endProfileSession(database, req, res, accountCookie, cookiePath)
    revokeSocket(profileSecret(accountCookie, req.headers.cookie))
    res.status(204).end()
  })
  return router
}
