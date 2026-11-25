import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clampZoom, pinchView, wheelIntent, zoomAround } from './gestures.ts'

test('a mouse wheel notch zooms, a trackpad scroll pans, a pinch zooms smoothly', () => {
  assert.deepEqual(wheelIntent({ deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: false }), { kind: 'zoom', factor: 1.12 })
  assert.deepEqual(wheelIntent({ deltaX: 0, deltaY: 3, deltaMode: 1, ctrlKey: false }), { kind: 'zoom', factor: 1 / 1.12 }, 'Firefox line mode')
  assert.deepEqual(wheelIntent({ deltaX: 0, deltaY: 12.5, deltaMode: 0, ctrlKey: false }), { kind: 'pan', dx: -0, dy: -12.5 })
  assert.deepEqual(wheelIntent({ deltaX: 30, deltaY: 120, deltaMode: 0, ctrlKey: false }), { kind: 'pan', dx: -30, dy: -120 }, 'sideways motion means a trackpad')
  const pinch = wheelIntent({ deltaX: 0, deltaY: -10, deltaMode: 0, ctrlKey: true })
  assert.equal(pinch.kind, 'zoom')
  assert.ok(pinch.kind === 'zoom' && pinch.factor > 1 && pinch.factor < 1.2)
})

test('zooming keeps the point under the cursor in place', () => {
  const camera = { x: 36, y: 36 }
  const anchor = { x: 200, y: 150 }
  const next = zoomAround(camera, 1, 2, anchor)
  const worldBefore = { x: (anchor.x - camera.x) / 1, y: (anchor.y - camera.y) / 1 }
  const worldAfter = { x: (anchor.x - next.x) / 2, y: (anchor.y - next.y) / 2 }
  assert.deepEqual(worldAfter, worldBefore)
  assert.equal(clampZoom(10), 4)
  assert.equal(clampZoom(0.01), .08)
})

test('pinching apart zooms in around the fingers and dragging both pans', () => {
  const start = { a: { x: 100, y: 100 }, b: { x: 200, y: 100 }, camera: { x: 0, y: 0 }, zoom: 1 }
  const wider = pinchView(start, { x: 50, y: 100 }, { x: 250, y: 100 })
  assert.equal(wider.zoom, 2)
  assert.deepEqual(wider.camera, { x: -150, y: -100 }, 'the midpoint (150,100) stays over the same board point')
  const moved = pinchView(start, { x: 120, y: 140 }, { x: 220, y: 140 })
  assert.equal(moved.zoom, 1)
  assert.deepEqual(moved.camera, { x: 20, y: 40 })
})
