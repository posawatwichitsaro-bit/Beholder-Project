import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { Request, Response } from 'express'
import type { Database, Query } from './store.ts'

const derive = promisify(scrypt)
const digest = (secret: string) => createHash('sha256').update(secret).digest('hex')
const duration = 30 * 86400000

export const accountCookie = 'beholder_account'
export const libraryCookie = 'beholder_profile'

export function profileSecret(cookie: string, header = '') {
  return header.split(';').map(value => value.trim())
    .find(value => value.startsWith(cookie + '='))?.slice(cookie.length + 1)
}

export async function passwordRecord(password: string) {
  const salt = randomBytes(16).toString('hex')
  const passwordHash = (await derive(password, salt, 64) as Buffer).toString('hex')
  return { salt, passwordHash }
}

export async function passwordMatches(password: string, record?: { salt: string; password_hash: string }) {
  const actual = await derive(password, record?.salt ?? 'beholder-unknown-profile', 64) as Buffer
  return Boolean(record && timingSafeEqual(Buffer.from(record.password_hash, 'hex'), actual))
}

export async function activeProfile(query: Query, cookie: string, header?: string, lock = false) {
  const secret = profileSecret(cookie, header)
  if (!secret) return undefined
  const { rows } = await query<{ id: string; name: string; email: string | null }>(
    `SELECT p.id,p.name,p.email FROM profiles p JOIN profile_sessions s ON s.profile_id=p.id
     WHERE s.token_hash=$1 AND s.expires_at > now() AND (p.email IS NOT NULL) = $2${lock ? ' FOR SHARE OF p' : ''}`,
    [digest(secret), cookie === accountCookie]
  )
  return rows[0]
}

async function revoke(query: Query, secret?: string) {
  if (secret) await query('DELETE FROM profile_sessions WHERE token_hash=$1', [digest(secret)])
}

export async function startProfileSession(database: Database, req: Request, res: Response, cookie: string, path: string, id: string) {
  const secret = randomBytes(32).toString('hex')
  const previous = profileSecret(cookie, req.headers.cookie)
  await database.transaction(async query => {
    await revoke(query, previous)
    await query('INSERT INTO profile_sessions VALUES ($1,$2,$3)', [digest(secret), id, new Date(Date.now() + duration)])
  })
  res.cookie(cookie, secret, { path, httpOnly: true, sameSite: 'strict', secure: req.secure || process.env.SECURE_COOKIES === '1', maxAge: duration })
}

export async function endProfileSession(database: Database, req: Request, res: Response, cookie: string, path: string) {
  await revoke(database.query, profileSecret(cookie, req.headers.cookie))
  res.clearCookie(cookie, { path })
}
