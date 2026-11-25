export type MapRect = { x: number; y: number; width: number; height: number }
export type GridFit = { cell: number; originX: number; originY: number }

/**
 * Grid from a box the DM drew over the map (map pixels) that covers
 * `across` × `down` cells: the cell size is the box size divided by the cell
 * count, and the origin is the box corner wrapped into the first cell, so the
 * grid lines pass through the box edges.
 */
export function fitGrid(rect: MapRect, across = 1, down = across): GridFit {
  const width = rect.width / Math.max(1, across)
  const height = rect.height / Math.max(1, down)
  const cell = Math.max(12, Math.min(300, Math.round((width + height) / 2)))
  const wrap = (value: number) => Math.round(((value % cell) + cell) % cell)
  return { cell, originX: wrap(rect.x), originY: wrap(rect.y) }
}
