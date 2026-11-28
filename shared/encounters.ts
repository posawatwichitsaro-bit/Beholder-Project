/**
 * Encounter builder (0.15). The XP budget is the SRD 5.2.1 "XP Budget per
 * Character" table (p. 202): each character adds the amount for their own
 * level, and the creatures' XP is spent against it. It only guides the DM;
 * nothing stops an encounter going over.
 */
import { crXp } from './progression.ts'

export const difficulties = ['low', 'moderate', 'high'] as const
export type Difficulty = typeof difficulties[number]
export const difficultyLabels: Record<Difficulty, string> = { low: 'Low', moderate: 'Moderate', high: 'High' }

/** Per character, by level 1–20: [Low, Moderate, High]. */
export const xpBudgetPerCharacter: readonly (readonly [number, number, number])[] = [
  [50, 75, 100], [100, 150, 200], [150, 225, 400], [250, 375, 500], [500, 750, 1100],
  [600, 1000, 1400], [750, 1300, 1700], [1000, 1700, 2100], [1300, 2000, 2600], [1600, 2300, 3100],
  [1900, 2900, 4100], [2200, 3700, 4700], [2600, 4200, 5400], [2900, 4900, 6200], [3300, 5400, 7800],
  [3800, 6100, 9800], [4500, 7200, 11700], [5000, 8700, 14200], [5500, 10700, 17200], [6400, 13200, 22000]
]

/** The party's budget: a character of unknown level (0) counts as level 1. */
export function partyBudget(levels: number[]): Record<Difficulty, number> {
  const budget = { low: 0, moderate: 0, high: 0 }
  for (const level of levels) {
    const row = xpBudgetPerCharacter[Math.min(20, Math.max(1, Math.floor(level) || 1)) - 1]
    budget.low += row[0]; budget.moderate += row[1]; budget.high += row[2]
  }
  return budget
}

export const xpForCr = (cr: string) => crXp[cr] ?? 0

/** The highest difficulty the XP reaches; 'over' past High, undefined below Low or with no party. */
export function difficultyOf(xp: number, budget: Record<Difficulty, number>): Difficulty | 'over' | undefined {
  if (!budget.high) return undefined
  if (xp > budget.high) return 'over'
  return [...difficulties].reverse().find(level => xp >= budget[level])
}

/** One kind of monster in an encounter: the Manual entry and how many. */
export type EncounterGroup = { monsterId: string; name: string; cr: string; count: number }
/** A prepared encounter (DM only, never sent to players). */
export type Encounter = { id: string; name: string; sceneId?: string; groups: EncounterGroup[] }

export const encounterLimits = { encounters: 50, groups: 20, count: 50, placed: 50 }

export const encounterXp = (groups: Pick<EncounterGroup, 'cr' | 'count'>[]) =>
  groups.reduce((sum, group) => sum + xpForCr(group.cr) * group.count, 0)

/**
 * Squares for a group around a point, nearest first, skipping squares already
 * taken. `sizes` are footprints in squares (a Large monster is 2); each one
 * gets a free block that size, so monsters never land on each other.
 */
export function spreadAround(center: { x: number; y: number }, sizes: number[], taken: Set<string>) {
  const used = new Set(taken)
  const cx = Math.floor(center.x), cy = Math.floor(center.y)
  const free = (x: number, y: number, size: number) => {
    for (let dx = 0; dx < size; dx++) for (let dy = 0; dy < size; dy++) if (used.has((x + dx) + ',' + (y + dy))) return false
    return true
  }
  return sizes.map(raw => {
    const size = Math.max(1, Math.ceil(raw))
    for (let ring = 0; ring < 60; ring++) {
      const spots: { x: number; y: number }[] = []
      for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) spots.push({ x: cx + dx, y: cy + dy })
      }
      spots.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))
      const spot = spots.find(point => free(point.x, point.y, size))
      if (spot) {
        for (let dx = 0; dx < size; dx++) for (let dy = 0; dy < size; dy++) used.add((spot.x + dx) + ',' + (spot.y + dy))
        return spot
      }
    }
    return { x: cx, y: cy }
  })
}
