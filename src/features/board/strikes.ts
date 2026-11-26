import type { Roll, Token } from '../../../shared/model.ts'

export type Strike = { id: string; from: string; to: string; ranged: boolean; outcome: 'hit' | 'miss' | 'critical' }
const outcomes: Record<string, Strike['outcome']> = { 'โดน': 'hit', 'พลาด': 'miss', 'คริติคัล': 'critical' }

/**
 * Attack rolls in this scene that are new since `seen`, as strikes to animate:
 * adjacent tokens (edges within one square) swing in melee, anything farther
 * is a ranged shot. Older rolls (more than `freshMs` ago) are skipped, so a
 * page reload does not replay the fight.
 */
export function newStrikes(rolls: Roll[], tokens: Token[], sceneId: string, seen: Set<string>, now: number, size: (token: Token) => number, freshMs = 4000) {
  const strikes: Strike[] = []
  for (const roll of rolls) {
    if (seen.has(roll.id)) continue
    seen.add(roll.id)
    const outcome = roll.outcome && outcomes[roll.outcome]
    if (!outcome || !roll.sourceId || !roll.targetId || roll.sceneId !== sceneId || now - (roll.at ?? 0) > freshMs) continue
    const from = tokens.find(token => token.actorId === roll.sourceId)
    const to = tokens.find(token => token.actorId === roll.targetId)
    if (!from || !to) continue
    const gapX = Math.max(0, Math.max(from.x, to.x) - Math.min(from.x + size(from), to.x + size(to)))
    const gapY = Math.max(0, Math.max(from.y, to.y) - Math.min(from.y + size(from), to.y + size(to)))
    strikes.push({ id: roll.id, from: from.id, to: to.id, ranged: Math.max(gapX, gapY) >= 1, outcome })
  }
  return strikes
}
