import { sizes } from '../shared/model.ts'
import type { Actor, SceneObject, Token } from '../shared/model.ts'

type Point = { x: number; y: number }
export function center(token: Token, actor: Actor) {
  const half = sizes[actor.size] / 2
  return { x: token.x + half, y: token.y + half }
}

export function isNear(token: Token, actor: Actor, object: Pick<SceneObject, 'x' | 'y' | 'width' | 'height'>) {
  const size = sizes[actor.size]
  const horizontal = Math.max(0, token.x - (object.x + object.width), object.x - (token.x + size))
  const vertical = Math.max(0, token.y - (object.y + object.height), object.y - (token.y + size))
  return Math.max(horizontal, vertical) < 1
}

export function structureCover(objects: SceneObject[], from: Point, to: Point) {
  let cover = 0
  for (const item of objects) {
    if (item.kind !== 'structure' || item.hp <= 0 || item.cover <= cover) continue
    let enter = 0
    let leave = 1
    for (const [start, end, min, max] of [
      [from.x, to.x, item.x, item.x + item.width],
      [from.y, to.y, item.y, item.y + item.height]
    ]) {
      if (start === end) {
        if (start <= min || start >= max) { enter = 1; leave = 0; break }
        continue
      }
      const a = (min - start) / (end - start)
      const b = (max - start) / (end - start)
      enter = Math.max(enter, Math.min(a, b))
      leave = Math.min(leave, Math.max(a, b))
    }
    if (enter < leave && leave > 0 && enter < 1) cover = item.cover
  }
  return cover
}
