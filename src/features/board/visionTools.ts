import type { Point } from './gestures.ts'
import type { LightSource, Wall } from '../../../shared/vision.ts'
import { key } from '../../../shared/vision.ts'

/**
 * Pointer maths for the DM's vision tools and for opening doors, in cell units.
 * Walls snap to cell corners (or half-corners with `half`), so they line up with the grid.
 */
export type VisionTool = 'wall' | 'door' | 'light' | 'dark' | 'magic' | 'clear' | 'erase'

export const snapCorner = (point: Point, half = false): Point => {
  const step = half ? .5 : 1
  return { x: Math.round(point.x / step) * step, y: Math.round(point.y / step) * step }
}

export function distanceToSegment(p: Point, a: Point, b: Point) {
  const ex = b.x - a.x
  const ey = b.y - a.y
  const length = ex * ex + ey * ey || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / length))
  return Math.hypot(p.x - (a.x + t * ex), p.y - (a.y + t * ey))
}

/** The wall (or door) nearest a point, if within `reach` cells. */
export function wallAt(walls: Wall[], point: Point, reach = .35) {
  let best: Wall | undefined
  let distance = reach
  for (const wall of walls) {
    const d = distanceToSegment(point, wall.a, wall.b)
    if (d <= distance) { best = wall; distance = d }
  }
  return best
}

/** A door whose middle is within `reach` cells of the point (doors are clicked on their handle). */
export function doorAt(walls: Wall[], point: Point, reach = .45) {
  return walls.find(wall => wall.door && Math.hypot(point.x - (wall.a.x + wall.b.x) / 2, point.y - (wall.a.y + wall.b.y) / 2) <= reach)
}

export function lightAt(lights: LightSource[], point: Point, reach = .5) {
  return lights.find(light => Math.hypot(point.x - light.x, point.y - light.y) <= reach)
}

/** Cells a paint stroke from `from` to `to` passes through (one sample every quarter cell), as "x,y" keys. */
export function strokeCells(from: Point, to: Point) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) * 4))
  const cells = new Set<string>()
  for (let step = 0; step <= steps; step++) {
    const t = step / steps
    cells.add(key(Math.floor(from.x + (to.x - from.x) * t), Math.floor(from.y + (to.y - from.y) * t)))
  }
  return cells
}

/** A door the player knows of: its middle cell is seen now or was explored. Secret doors never reach players. */
export function knownDoor(wall: Wall, known: Set<string>) {
  const middle = { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 }
  // A door on a cell edge borders two cells; either side counts.
  const horizontal = wall.a.y === wall.b.y
  const sides = horizontal
    ? [key(Math.floor(middle.x), Math.round(middle.y) - 1), key(Math.floor(middle.x), Math.round(middle.y))]
    : [key(Math.round(middle.x) - 1, Math.floor(middle.y)), key(Math.round(middle.x), Math.floor(middle.y))]
  return sides.some(cell => known.has(cell)) || known.has(key(Math.floor(middle.x), Math.floor(middle.y)))
}
