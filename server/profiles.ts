import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { Request, Response } from 'express'
import { passwordMaxLength, passwordMinLength } from '../shared/auth.ts'
import type { Database, Query } from './store.ts'

const digest = (secret: string) => createHash('sha256').update(secret).digest('hex')
const duration = 30 * 86400000
const scheme = 'scrypt-v2:'
const cost = { N: 2 ** 17, r: 8, p: 1, maxmem: 160 * 1024 ** 2 }
let pendingHashes = 0

export const accountCookie = 'beholder_account'
export const libraryCookie = 'beholder_profile'

export function profileSecret(cookie: string, header = '') {
  const secret = header.split(';').map(value => value.trim())
    .find(value => value.startsWith(cookie + '='))?.slice(cookie.length + 1)
  return secret && /^[a-f0-9]{64}$/.test(secret) ? secret : undefined
}

export function validPassword(password: unknown): password is string {
  if (typeof password !== 'string' || password.length > passwordMaxLength * 2) return false
  const length = [...password].length
  return length >= passwordMinLength && length <= passwordMaxLength
}

async function derive(password: string, salt: string, legacy = false) {
  // Keep the memory-heavy work bounded even when callers have different source IPs.
  if (pendingHashes >= 2) throw Object.assign(new Error('ระบบเข้าสู่ระบบกำลังยุ่ง กรุณาลองอีกครั้ง'), { status: 429 })
  pendingHashes++
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, legacy ? {} : cost, (error, key) => error ? reject(error) : resolve(key))
    })
  } finally {
    pendingHashes--
  }
}

export async function passwordRecord(password: string) {
  const salt = randomBytes(16).toString('hex')
  return { salt: scheme + salt, passwordHash: (await derive(password, salt)).toString('hex') }
}

export async function verifyPassword(query: Query, password: string, record?: { id: string; salt: string; password_hash: string }) {
  const salt = record?.salt ?? scheme + 'beholder-unknown-profile'
  const legacy = !salt.startsWith(scheme)
  const actual = await derive(password, legacy ? salt : salt.slice(scheme.length), legacy)
  const expected = Buffer.from(record?.password_hash ?? '', 'hex')
  if (!record || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    if (legacy) await derive(password, 'beholder-unknown-profile')
    return false
  }
  if (legacy) {
    const updated = await passwordRecord(password)
    await query('UPDATE profiles SET salt=$2,password_hash=$3 WHERE id=$1 AND salt=$4 AND password_hash=$5',
      [record.id, updated.salt, updated.passwordHash, record.salt, record.password_hash])
  }
  return true
}

type ActiveProfile = { id: string; name: string; email: string | null; sessionExpires: Date; renew?: boolean }
export async function activeProfile(query: Query, cookie: string, header?: string, lock = false, touch = false) {
  const secret = profileSecret(cookie, header)
  if (!secret) return undefined
  const token = digest(secret)
  const { rows } = await query<ActiveProfile>(
    `SELECT p.id,p.name,p.email,LEAST(s.expires_at,s.idle_expires_at) AS "sessionExpires",
       s.idle_expires_at < now()+interval '11 hours 55 minutes' AND s.idle_expires_at < s.expires_at AS renew
     FROM profiles p JOIN profile_sessions s ON s.profile_id=p.id
     WHERE s.token_hash=$1 AND s.expires_at > now() AND s.idle_expires_at > now()
       AND (p.email IS NOT NULL) = $2${lock ? ' FOR SHARE OF p' : ''}`,
    [token, cookie === accountCookie]
  )
  const profile = rows[0]
  if (touch && profile?.renew) {
    const renewed = await query<{ sessionExpires: Date }>(
      `UPDATE profile_sessions SET idle_expires_at=now()+interval '12 hours'
       WHERE token_hash=$1 AND expires_at > now() AND idle_expires_at > now()
         AND idle_expires_at < now()+interval '11 hours 55 minutes' AND idle_expires_at < expires_at
       RETURNING LEAST(expires_at,idle_expires_at) AS "sessionExpires"`, [token]
    )
    return { ...profile, ...renewed.rows[0] }
  }
  return profile
}

async function revoke(query: Query, secret?: string) {
  if (secret) await query('DELETE FROM profile_sessions WHERE token_hash=$1', [digest(secret)])
}

function cookieOptions(req: Request, path: string) {
  return { path, httpOnly: true, sameSite: 'strict' as const, secure: req.secure || process.env.SECURE_COOKIES === '1' || Boolean(process.env.PUBLIC_ORIGIN) }
}

export async function startProfileSession(database: Database, req: Request, res: Response, cookie: string, path: string, id: string) {
  const secret = randomBytes(32).toString('hex')
  await database.transaction(async query => {
    await revoke(query, profileSecret(cookie, req.headers.cookie))
    await query('DELETE FROM profile_sessions WHERE expires_at <= now() OR idle_expires_at <= now()')
    await query(`INSERT INTO profile_sessions (token_hash,profile_id,expires_at,idle_expires_at)
      VALUES ($1,$2,now()+interval '30 days',now()+interval '12 hours')`, [digest(secret), id])
  })
  res.cookie(cookie, secret, { ...cookieOptions(req, path), maxAge: duration })
}

export async function endProfileSession(database: Database, req: Request, res: Response, cookie: string, path: string) {
  await revoke(database.query, profileSecret(cookie, req.headers.cookie))
  res.clearCookie(cookie, cookieOptions(req, path))
}
