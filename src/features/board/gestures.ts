export type Point = { x: number; y: number }

/**
 * Trackpads send small, often fractional or sideways wheel deltas; mouse
 * wheels send whole notches (about 100 px, or 3 lines in Firefox).
 * Pinch-to-zoom arrives as a wheel event with ctrlKey set.
 */
export type WheelIntent = { kind: 'zoom'; factor: number } | { kind: 'pan'; dx: number; dy: number }

export function wheelIntent(event: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; metaKey?: boolean }): WheelIntent {
  if (event.ctrlKey || event.metaKey) return { kind: 'zoom', factor: Math.exp(-event.deltaY * 0.01) }
  const pixels = event.deltaMode === 0
  if (pixels && (event.deltaX !== 0 || Math.abs(event.deltaY) < 40)) return { kind: 'pan', dx: -event.deltaX, dy: -event.deltaY }
  return { kind: 'zoom', factor: event.deltaY < 0 ? 1.12 : 1 / 1.12 }
}

/** Keep the board point under `anchor` fixed while the zoom changes. */
export function zoomAround(camera: Point, zoom: number, nextZoom: number, anchor: Point): Point {
  const scale = nextZoom / zoom
  return { x: anchor.x - (anchor.x - camera.x) * scale, y: anchor.y - (anchor.y - camera.y) * scale }
}

export const clampZoom = (value: number) => Math.max(.08, Math.min(4, value))

/** Two-finger pinch: zoom by the change in finger distance and follow the midpoint. */
export function pinchView(start: { a: Point; b: Point; camera: Point; zoom: number }, a: Point, b: Point) {
  const distance = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) || 1
  const mid = (p: Point, q: Point) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })
  const zoom = clampZoom(start.zoom * distance(a, b) / distance(start.a, start.b))
  const from = mid(start.a, start.b)
  const to = mid(a, b)
  const world = { x: (from.x - start.camera.x) / start.zoom, y: (from.y - start.camera.y) / start.zoom }
  return { zoom, camera: { x: to.x - world.x * zoom, y: to.y - world.y * zoom } }
}

/** Pointer travel below this counts as a click / tap, not a drag. */
export const dragThreshold = 5
/** Mouse: hold still this long on empty map before dragging to draw a selection box instead of panning. */
export const holdToSelectMs = 280
export const longPressMs = 550
