import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Vector3 } from 'three'
import { landing, shapeOf } from './shapes.ts'

test('every die has as many flat faces as sides, each facing outwards', () => {
  for (const sides of [4, 6, 8, 10, 12, 20]) {
    const shape = shapeOf(sides)
    assert.equal(shape.faces.length, sides, 'd' + sides)
    for (const face of shape.faces) assert.ok(face.normal.dot(face.center) > 0, 'd' + sides + ' face points out')
  }
})

test('landing turns any face to the camera with its number upright', () => {
  for (const sides of [4, 6, 8, 10, 12, 20]) {
    shapeOf(sides).faces.forEach((face, index) => {
      const q = landing(face)
      const normal = face.normal.clone().applyQuaternion(q)
      const up = face.up.clone().applyQuaternion(q)
      assert.ok(normal.distanceTo(new Vector3(0, 0, 1)) < 1e-6, 'd' + sides + ' face ' + (index + 1) + ' faces the camera')
      assert.ok(up.distanceTo(new Vector3(0, 1, 0)) < 1e-6, 'd' + sides + ' face ' + (index + 1) + ' reads upright')
    })
  }
  // With a spin the face still points at the camera.
  const tilted = shapeOf(20).faces[7].normal.clone().applyQuaternion(landing(shapeOf(20).faces[7], .3))
  assert.ok(tilted.distanceTo(new Vector3(0, 0, 1)) < 1e-6)
})
