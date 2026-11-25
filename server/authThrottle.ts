import type { Request, Response } from 'express'

export function createAuthThrottle() {
  const attempts = new Map<string, { count: number; expires: number }>()
  let sweepAt = 0
  return (req: Request, res: Response, realm: string, identity: string, mode: string) => {
    const now = Date.now()
    if (now >= sweepAt) {
      for (const [key, value] of attempts) if (value.expires <= now) attempts.delete(key)
      sweepAt = now + 60_000
    }
    const ip = req.ip ?? 'unknown'
    const limits = [[`ip:${ip}`, 30], [`ip:${ip}:${mode}`, mode === 'register' ? 10 : 30],
      [`identity:${realm}:${mode}:${identity}`, 10]] as const
    const window = 60_000
    for (const [key, limit] of limits) {
      const attempt = attempts.get(key)
      if ((attempt && attempt.expires > now && attempt.count >= limit) || (!attempt && attempts.size >= 5000)) {
        res.set('Retry-After', String(Math.ceil(((attempt?.expires ?? sweepAt) - now) / 1000)))
        res.status(429).json({ error: 'ลองหลายครั้งเกินไป กรุณารอสักครู่' })
        return false
      }
    }
    for (const [key] of limits) {
      const attempt = attempts.get(key)
      if (attempt && attempt.expires > now) attempt.count++
      else attempts.set(key, { count: 1, expires: now + window })
    }
    return true
  }
}

export type AuthThrottle = ReturnType<typeof createAuthThrottle>
