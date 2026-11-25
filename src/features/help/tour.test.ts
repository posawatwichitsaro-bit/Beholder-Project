import assert from 'node:assert/strict'
import { test } from 'node:test'
import { placeCard, tours } from './tour.ts'

const view = { width: 1280, height: 800 }
const card = { width: 320, height: 180 }

test('the card sits below a target near the top, centred on it', () => {
  assert.deepEqual(placeCard({ left: 600, top: 10, width: 80, height: 40 }, card, view), { left: 480, top: 62, side: 'below' })
})

test('a target near the bottom gets the card above it', () => {
  assert.deepEqual(placeCard({ left: 600, top: 700, width: 80, height: 40 }, card, view), { left: 480, top: 508, side: 'above' })
})

test('a target as tall as the screen gets the card beside it, and with no target the card is centred', () => {
  assert.deepEqual(placeCard({ left: 1220, top: 0, width: 60, height: 800 }, card, view), { left: 888, top: 310, side: 'left' })
  assert.deepEqual(placeCard({ left: 0, top: 0, width: 1280, height: 800 }, card, view), { left: 480, top: 310, side: 'center' })
  assert.deepEqual(placeCard(undefined, card, view), { left: 480, top: 310, side: 'center' })
})

test('the card never leaves a narrow screen', () => {
  const phone = { width: 390, height: 844 }
  const spot = placeCard({ left: 340, top: 8, width: 40, height: 40 }, { width: 366, height: 200 }, phone)
  assert.equal(spot.left, 12)
  assert.ok(spot.left + 366 <= phone.width - 12 + 0.001)
})

test('both tours start with a welcome and point at different things after it', () => {
  for (const steps of Object.values(tours)) {
    assert.equal(steps[0].target, undefined)
    const targets = steps.slice(1).map(step => step.target)
    assert.ok(targets.every(Boolean))
    assert.equal(new Set(targets).size, targets.length)
  }
})
