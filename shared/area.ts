export const areaLabels = { circle: 'วงกลม', rectangle: 'สี่เหลี่ยม', cone: 'กรวย', line: 'เส้น' }
export type AreaKind = keyof typeof areaLabels
export type GridPoint = { x: number; y: number }
export type Area = { kind: AreaKind; from: GridPoint; to: GridPoint }
export type AreaOutline = { center: GridPoint; radius: number } | { points: GridPoint[] }

export function areaOutline({ kind, from: a, to: b }: Area): AreaOutline {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (kind === 'circle') return { center: a, radius: length }
  if (kind === 'rectangle') return { points: [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }] }
  if (!length) return { points: [] }
  const width = kind === 'cone' ? length / 2 : .5
  const side = { x: -dy / length * width, y: dx / length * width }
  const plus = (point: GridPoint, sign: number) => ({ x: point.x + side.x * sign, y: point.y + side.y * sign })
  return { points: kind === 'cone' ? [a, plus(b, 1), plus(b, -1)] : [plus(a, 1), plus(b, 1), plus(b, -1), plus(a, -1)] }
}

export function areaContains(outline: AreaOutline, point: GridPoint) {
  if ('radius' in outline) {
    return outline.radius > 0 && Math.hypot(point.x - outline.center.x, point.y - outline.center.y) <= outline.radius + 1e-8
  }
  const { points } = outline
  if (!points.length) return false
  let positive = false
  let negative = false
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
    positive ||= cross > 1e-8
    negative ||= cross < -1e-8
  }
  return !(positive && negative) && (positive || negative)
}

export function validArea({ kind, from, to }: Area) {
  return kind === 'rectangle' ? from.x !== to.x && from.y !== to.y : from.x !== to.x || from.y !== to.y
}

/**
 * A spell's template at its own size (0.13): the drag only aims it. Circles get the radius, cones and
 * lines the length (pointing at the drag, else to the right), cubes a square of that side toward the drag.
 */
export function sizedArea(area: Area, squares: number): Area {
  const dx = area.to.x - area.from.x
  const dy = area.to.y - area.from.y
  if (area.kind === 'rectangle') {
    return { ...area, to: { x: area.from.x + (dx < 0 ? -squares : squares), y: area.from.y + (dy < 0 ? -squares : squares) } }
  }
  const length = Math.hypot(dx, dy)
  const [ux, uy] = length ? [dx / length, dy / length] : [1, 0]
  return { ...area, to: { x: area.from.x + ux * squares, y: area.from.y + uy * squares } }
}
