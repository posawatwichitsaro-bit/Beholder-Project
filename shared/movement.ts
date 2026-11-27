import type { Actor, Scene } from './model.ts'
import { carryingLoad } from './encumbrance.ts'

/** Feet between two squares on the grid, 2024 rules: every square, diagonal or not, is 5 ft. */
export const gridFeet = (from: { x: number; y: number }, to: { x: number; y: number }) =>
  5 * Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))

/** A creature's Speed right now: 5 ft when it carries too much (room rule on), else its sheet Speed. */
export function speedNow(actor: Pick<Actor, 'speed' | 'abilities' | 'size' | 'inventory' | 'kind'>, encumbrance = true) {
  return encumbrance && actor.kind === 'pc' && carryingLoad(actor).over ? Math.min(5, actor.speed) : actor.speed
}

/** Feet the creature whose turn it is has moved this turn (0 when it is someone else's turn or no fight). */
export function feetMoved(scene: Pick<Scene, 'combat'>, actorId: string) {
  const combat = scene.combat
  if (!combat || combat.order[combat.turn]?.actorId !== actorId) return 0
  const moved = combat.moved
  return moved?.actorId === actorId && moved.turnKey === combat.round + ':' + combat.turn ? moved.feet : 0
}
