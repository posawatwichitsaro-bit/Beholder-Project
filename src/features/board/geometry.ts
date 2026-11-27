import type { Point } from './gestures.ts'

/**
 * Board geometry with no drawing library in it: where a grid cell sits on
 * screen and which cell or piece sits under a screen point. The Pixi renderer
 * and the pointer handlers both use these, so hit tests match what is drawn.
 *
 * Screen = camera + (origin + cell × grid) × zoom, where `camera` is where the
 * map's top-left corner lands on screen and `origin` is the grid's offset on
 * the map in map pixels.
 */
export type View = { camera: Point; zoom: number }
export type Grid = { cell: number; originX: number; originY: number }
export type Piece = { x: number; y: number }

export function boardTransform(view: View, grid: Grid) {
  const size = grid.cell * view.zoom
  const origin = { x: view.camera.x + grid.originX * view.zoom, y: view.camera.y + grid.originY * view.zoom }
  return {
    /** Screen pixels of one grid square. */
    size,
    origin,
    /** Top-left of a cell (fractional cells allowed) on screen. */
    pixel: (point: Point): Point => ({ x: origin.x + point.x * size, y: origin.y + point.y * size }),
    /** The cell under a screen point, snapped down to `step` (½ for Tiny creatures). */
    cell: (point: Point, step = 1): Point => ({
      x: Math.floor((point.x - origin.x) / size / step) * step,
      y: Math.floor((point.y - origin.y) / size / step) * step
    }),
    /** Area templates snap to half squares. */
    areaPoint: (point: Point): Point => ({
      x: Math.round((point.x - origin.x) / size * 2) / 2,
      y: Math.round((point.y - origin.y) / size * 2) / 2
    }),
    /** The board position (fractional cells) under a screen point. */
    at: (point: Point): Point => ({ x: (point.x - origin.x) / size, y: (point.y - origin.y) / size }),
    /** World (map pixel) position of a cell, for pieces drawn inside the camera container. */
    world: (point: Point): Point => ({ x: grid.originX + point.x * grid.cell, y: grid.originY + point.y * grid.cell })
  }
}
export type BoardTransform = ReturnType<typeof boardTransform>

/** Axis-aligned box between two screen points. */
export const bounds = (from: Point, to: Point) => ({
  x: Math.min(from.x, to.x), y: Math.min(from.y, to.y),
  width: Math.abs(from.x - to.x), height: Math.abs(from.y - to.y)
})

/** Whether a screen point falls inside a piece `width` × `height` squares big. */
export function covers(transform: BoardTransform, piece: Piece, width: number, height: number, point: Point) {
  const at = transform.pixel(piece)
  return point.x >= at.x && point.x < at.x + width * transform.size && point.y >= at.y && point.y < at.y + height * transform.size
}

/** The topmost piece (last drawn) under a screen point. */
export function pieceAt<T extends Piece>(transform: BoardTransform, pieces: readonly T[], point: Point, extent: (piece: T) => { width: number; height: number }) {
  for (let index = pieces.length - 1; index >= 0; index--) {
    const { width, height } = extent(pieces[index])
    if (covers(transform, pieces[index], width, height, point)) return pieces[index]
  }
  return undefined
}

/** Pieces a selection box touches (a box under 3 px is a click, not a box). */
export function piecesIn<T extends Piece>(transform: BoardTransform, pieces: readonly T[], box: ReturnType<typeof bounds>, extent: (piece: T) => { width: number; height: number }) {
  if (box.width <= 3 || box.height <= 3) return []
  return pieces.filter(piece => {
    const at = transform.pixel(piece)
    const { width, height } = extent(piece)
    return at.x < box.x + box.width && at.x + width * transform.size > box.x && at.y < box.y + box.height && at.y + height * transform.size > box.y
  })
}

/** Grid lines that fall on screen: x positions of vertical lines and y positions of horizontal ones. */
export function gridLines(transform: BoardTransform, screen: Point) {
  const size = transform.size
  if (size < 4) return { xs: [], ys: [] }
  const wrap = (value: number) => ((value % size) + size) % size
  const xs: number[] = []
  const ys: number[] = []
  for (let x = wrap(transform.origin.x); x < screen.x; x += size) xs.push(x)
  for (let y = wrap(transform.origin.y); y < screen.y; y += size) ys.push(y)
  return { xs, ys }
}

/** Feet between two cells on the ruler: the larger of the two axis distances, five feet a square. */
export const rulerFeet = (from: Point, to: Point) => 5 * Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y))
