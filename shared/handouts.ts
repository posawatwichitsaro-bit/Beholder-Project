import type { MapAsset } from './model.ts'

/**
 * Handouts (0.14): a note, picture or Canva presentation the DM gives to the
 * whole table or to some players. Players are only ever sent the handouts they
 * were given (server/commands.ts snapshot), and only they can open the picture.
 */
export type Handout = {
  id: string; title: string; text?: string
  /** A picture uploaded with the handout (stored like a map). */
  image?: MapAsset
  /** A Canva design shared as a view link, kept as its embed address (see canvaEmbed). */
  canva?: string
  /** Who has it: everyone, or these player member ids. */
  recipients: 'all' | string[]
  at: number
}
/** The handout the DM is presenting now: it opens full screen for everyone who has it. */
export type Presenting = { handoutId: string; at: number }

export const handoutLimits = { title: 120, text: 5000, count: 200 }

export function canSee(handout: Pick<Handout, 'recipients'>, member: { id: string; role: string }) {
  return member.role === 'dm' || handout.recipients === 'all' || handout.recipients.includes(member.id)
}

/**
 * A Canva share link as the address to embed, or an error in Thai. Canva's
 * "view" links look like https://www.canva.com/design/DAF1234/AbCdEf/view?utm_…;
 * the embed address is the same path with `?embed`. Edit links need a Canva
 * login, so they are refused with a hint to share a view link instead.
 */
export function canvaEmbed(input: string): { url: string } | { error: string } {
  let url: URL
  try { url = new URL(input.trim()) } catch { return { error: 'ลิงก์ Canva ไม่ถูกต้อง' } }
  if (url.protocol !== 'https:' || !/^(www\.)?canva\.com$/.test(url.hostname)) return { error: 'ใช้ลิงก์จาก canva.com เท่านั้น' }
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] !== 'design' || !parts[1] || !/^[\w-]+$/.test(parts[1])) return { error: 'ลิงก์นี้ไม่ใช่งานออกแบบของ Canva' }
  const rest = parts.slice(2)
  if (rest.includes('edit')) return { error: 'ลิงก์นี้เป็นลิงก์แก้ไข ใน Canva กด Share แล้วคัดลอกลิงก์แบบ "ดูได้" (view) มาแทน' }
  const token = rest[0] && rest[0] !== 'view' && rest[0] !== 'watch' ? rest[0] : undefined
  if (token && !/^[\w-]+$/.test(token)) return { error: 'ลิงก์ Canva ไม่ถูกต้อง' }
  return { url: 'https://www.canva.com/design/' + parts[1] + (token ? '/' + token : '') + '/view?embed' }
}
