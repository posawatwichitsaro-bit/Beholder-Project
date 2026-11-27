import type { Actor, Scene } from './model.ts'
import { carryingLoad } from './encumbrance.ts'
import { exhaustionLevel, hasCondition } from './effects.ts'

/**
 * Movement on the grid (2024 rules), as a counter beside the Speed — it never
 * stops a token (0.12 decision). Every square is 5 ft, diagonals too; Difficult
 * Terrain and crawling while Prone each add 5 ft per square entered.
 */
type Point = { x: number; y: number }

/** Feet between two squares on the grid, 2024 rules: every square, diagonal or not, is 5 ft. */
export const gridFeet = (from: Point, to: Point) =>
  5 * Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))

/** The squares entered going from one square to another in grid steps (diagonal first), start excluded. */
export function pathCells(from: Point, to: Point) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const steps = Math.max(Math.abs(dx), Math.abs(dy))
  const cells: Point[] = []
  for (let step = 1; step <= steps; step++) {
    cells.push({ x: Math.floor(from.x + Math.round(dx * step / steps)), y: Math.floor(from.y + Math.round(dy * step / steps)) })
  }
  return cells
}

type Mover = Pick<Actor, 'conditions' | 'effects'>
/**
 * Feet a move costs: 5 per square, +5 per Difficult Terrain square entered,
 * +5 per square while crawling (Prone); both together make 15.
 */
export function moveCost(scene: Pick<Scene, 'terrain'>, mover: Mover | undefined, from: Point, to: Point) {
  const difficult = new Set(scene.terrain ?? [])
  const crawling = mover ? hasCondition(mover, 'Prone') : false
  return pathCells(from, to).reduce((sum, cell) => sum + 5 * (1 + (difficult.has(cell.x + ',' + cell.y) ? 1 : 0) + (crawling ? 1 : 0)), 0)
}

/** Conditions that leave a creature's Speed at 0. */
export const stopped = ['Grappled', 'Restrained', 'Paralyzed', 'Petrified', 'Stunned', 'Unconscious']

/**
 * A creature's Speed right now: 0 when a condition holds it, 5 ft lower for
 * each level of Exhaustion (2024), and 5 ft when it carries too much (room rule on).
 */
export function speedNow(actor: Pick<Actor, 'speed' | 'abilities' | 'size' | 'inventory' | 'kind' | 'conditions' | 'effects'>, encumbrance = true) {
  if (stopped.some(name => hasCondition(actor, name))) return 0
  const tired = Math.max(0, actor.speed - 5 * exhaustionLevel(actor))
  return encumbrance && actor.kind === 'pc' && carryingLoad(actor).over ? Math.min(5, tired) : tired
}

/** Why Speed is lower than the sheet says, for the token bar ("Grappled", "Exhaustion 2", "แบกเกินพิกัด"). */
export function speedReasons(actor: Pick<Actor, 'speed' | 'abilities' | 'size' | 'inventory' | 'kind' | 'conditions' | 'effects'>, encumbrance = true) {
  const reasons = stopped.filter(name => hasCondition(actor, name))
  const level = exhaustionLevel(actor)
  if (level) reasons.push('Exhaustion ' + level)
  if (encumbrance && actor.kind === 'pc' && carryingLoad(actor).over) reasons.push('แบกเกินพิกัด')
  if (hasCondition(actor, 'Prone')) reasons.push('Prone: คลานใช้ระยะสองเท่า')
  return reasons
}

/** Feet the creature whose turn it is has moved this turn (0 when it is someone else's turn or no fight). */
export function feetMoved(scene: Pick<Scene, 'combat'>, actorId: string) {
  const combat = scene.combat
  if (!combat || combat.order[combat.turn]?.actorId !== actorId) return 0
  const moved = combat.moved
  return moved?.actorId === actorId && moved.turnKey === combat.round + ':' + combat.turn ? moved.feet : 0
}
