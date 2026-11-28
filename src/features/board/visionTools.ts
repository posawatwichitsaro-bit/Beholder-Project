import type { Point } from './gestures.ts'
import type { LightSource, Wall } from '../../../shared/vision.ts'
import { key } from '../../../shared/vision.ts'

/**
 * Pointer maths for the DM's vision tools and for opening doors, in cell units.
 * Walls snap to cell corners (or half-corners with `half`), so they line up with the grid.
 */
export type VisionTool = 'select' | 'wall' | 'door' | 'light' | 'dark' | 'magic' | 'clear' | 'terrain' | 'terrainClear' | 'erase'

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

/**
 * Editing walls (0.14). A grab is either one end of a wall or the body of the
 * selected walls. Ends that sit on the same corner move together, so a room
 * stays closed, unless `detach` (Alt) is held; moving a body stretches the
 * unselected walls joined to it the same way.
 */
export type WallEnd = { kind: 'end'; wallId: string; end: 'a' | 'b' }
export type WallGrab = WallEnd | { kind: 'body' }
const same = (p: Point, q: Point) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6

/** The wall end nearest the point within `reach` cells, preferring selected walls. */
export function wallEndAt(walls: Wall[], point: Point, selected: string[] = [], reach = .3): WallEnd | undefined {
  let best: WallEnd | undefined
  let distance = reach
  const ordered = [...walls.filter(wall => selected.includes(wall.id)), ...walls.filter(wall => !selected.includes(wall.id))]
  for (const wall of ordered) for (const end of ['a', 'b'] as const) {
    const d = Math.hypot(point.x - wall[end].x, point.y - wall[end].y)
    if (d < distance - 1e-6) { best = { kind: 'end', wallId: wall.id, end }; distance = d }
  }
  return best
}

/** Walls with both ends inside a rectangle of cells. */
export function wallsIn(walls: Wall[], from: Point, to: Point) {
  const [x0, x1] = [Math.min(from.x, to.x), Math.max(from.x, to.x)]
  const [y0, y1] = [Math.min(from.y, to.y), Math.max(from.y, to.y)]
  const inRect = (p: Point) => p.x >= x0 - 1e-6 && p.x <= x1 + 1e-6 && p.y >= y0 - 1e-6 && p.y <= y1 + 1e-6
  return walls.filter(wall => inRect(wall.a) && inRect(wall.b))
}

/**
 * The walls a grab changes when dragged by `delta` cells (or, for an end, dropped on `to`),
 * as { id, a, b }. Walls that would shrink to a point are left out (they stay as they are).
 */
export function wallEdit(walls: Wall[], selected: string[], grab: WallGrab, drop: { delta?: Point; to?: Point }, detach = false) {
  const moved = new Map<string, { id: string; a: Point; b: Point }>()
  const shift = (p: Point, d: Point) => ({ x: p.x + d.x, y: p.y + d.y })
  // Corners that move, and where they go.
  const corners: { from: Point; to: Point }[] = []
  if (grab.kind === 'end') {
    const wall = walls.find(item => item.id === grab.wallId)
    if (!wall) return []
    const from = wall[grab.end]
    const to = drop.to ?? shift(from, drop.delta ?? { x: 0, y: 0 })
    if (detach) moved.set(wall.id, { id: wall.id, a: grab.end === 'a' ? to : wall.a, b: grab.end === 'b' ? to : wall.b })
    else corners.push({ from, to })
  } else {
    const delta = drop.delta ?? { x: 0, y: 0 }
    for (const wall of walls) if (selected.includes(wall.id)) {
      moved.set(wall.id, { id: wall.id, a: shift(wall.a, delta), b: shift(wall.b, delta) })
      if (!detach) for (const end of [wall.a, wall.b]) if (!corners.some(corner => same(corner.from, end))) corners.push({ from: end, to: shift(end, delta) })
    }
  }
  for (const wall of walls) {
    if (moved.has(wall.id)) continue
    const a = corners.find(corner => same(corner.from, wall.a))?.to
    const b = corners.find(corner => same(corner.from, wall.b))?.to
    if (a || b) moved.set(wall.id, { id: wall.id, a: a ?? wall.a, b: b ?? wall.b })
  }
  return [...moved.values()].filter(wall => !same(wall.a, wall.b))
}
