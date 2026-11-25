import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultPrefs, readPrefs } from './prefs.ts'

test('missing or broken storage gives the defaults', () => {
  assert.deepEqual(readPrefs(null), defaultPrefs)
  assert.deepEqual(readPrefs('{not json'), defaultPrefs)
  assert.deepEqual(readPrefs('null'), defaultPrefs)
})

test('stored settings are kept, and out-of-range or wrong-typed values fall back', () => {
  assert.deepEqual(readPrefs(JSON.stringify({ sound: false, uiScale: 1.1, reduceMotion: true, showGrid: false, tourSeen: { dm: true } })),
    { sound: false, uiScale: 1.1, reduceMotion: true, showGrid: false, tourSeen: { dm: true, player: false } })
  const odd = readPrefs(JSON.stringify({ sound: 'no', uiScale: 3, showGrid: 1, tourSeen: 'yes' }))
  assert.equal(odd.sound, true)
  assert.equal(odd.uiScale, 1.25)
  assert.equal(odd.showGrid, true)
  assert.deepEqual(odd.tourSeen, { dm: false, player: false })
  assert.equal(readPrefs(JSON.stringify({ uiScale: 0.5 })).uiScale, 0.9)
})

test('settings saved before step 9 (sound only) still load', () => {
  assert.deepEqual(readPrefs(JSON.stringify({ sound: false })), { ...defaultPrefs, sound: false })
})
