import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dockReducer, emptyDock } from './dock.ts'
import type { DockState } from './dock.ts'
import { panelForShortcut, panels, panelsFor } from './panelRegistry.ts'
import { filterCommands } from './commands.ts'

const run = (...actions: Parameters<typeof dockReducer>[1][]) => actions.reduce<DockState>(dockReducer, emptyDock)

test('opening a panel replaces the previous one, like the old drawer', () => {
  assert.deepEqual(run({ type: 'open', id: 'scenes' }, { type: 'open', id: 'sheets' }).open, ['sheets'])
})

test('toggling the open panel closes it', () => {
  assert.deepEqual(run({ type: 'toggle', id: 'dice' }, { type: 'toggle', id: 'dice' }).open, [])
})

test('a pinned panel stays on top when another opens, and unpinning releases it', () => {
  const pinned = run({ type: 'open', id: 'actor' }, { type: 'pin', id: 'actor' }, { type: 'open', id: 'dice' })
  assert.deepEqual(pinned.open, ['actor', 'dice'])
  assert.deepEqual(dockReducer(pinned, { type: 'open', id: 'library' }).open, ['actor', 'library'])
  assert.deepEqual(dockReducer(pinned, { type: 'closeAll' }).open, ['actor'], 'Escape keeps the pinned panel')
  const released = dockReducer(pinned, { type: 'pin', id: 'actor' })
  assert.deepEqual(dockReducer(released, { type: 'open', id: 'scenes' }).open, ['scenes'])
})

test('stacking keeps the current panel and adds the new one under it, at most two', () => {
  const stacked = run({ type: 'open', id: 'actor' }, { type: 'open', id: 'dice', stack: true })
  assert.deepEqual(stacked.open, ['actor', 'dice'])
  assert.deepEqual(dockReducer(stacked, { type: 'open', id: 'objects', stack: true }).open, ['actor', 'objects'])
})

test('closing a pinned panel clears the pin', () => {
  const state = run({ type: 'open', id: 'scenes' }, { type: 'pin', id: 'scenes' }, { type: 'close', id: 'scenes' })
  assert.deepEqual(state, { open: [], pinned: null })
})

test('players never get DM-only panels, and shortcuts follow the role', () => {
  assert.ok(panelsFor('dm').some(panel => panel.id === 'manual'))
  assert.ok(!panelsFor('player').some(panel => panel.id === 'manual'))
  assert.equal(panelForShortcut('n', 'dm')?.id, 'manual')
  assert.equal(panelForShortcut('n', 'player'), undefined)
  assert.equal(panelForShortcut('t', 'player')?.id, 'sheets')
})

test('shortcuts are unique and never take the board keys R, V and G or the DM storeroom key M', () => {
  const keys = panels.flatMap(panel => panel.shortcut ? [panel.shortcut] : [])
  assert.equal(new Set(keys).size, keys.length)
  for (const reserved of ['R', 'V', 'G', 'M']) assert.ok(!keys.includes(reserved), reserved + ' is taken elsewhere')
})

test('the command palette matches labels and keywords, ignoring case and order', () => {
  const items = [
    { id: 'a', label: 'เปิดให้ผู้เล่น', group: 'DM', keywords: 'publish scene', run: () => {} },
    { id: 'b', label: 'ทอย d20', group: 'ลูกเต๋า', keywords: 'roll dice', run: () => {} },
    { id: 'c', label: 'Monster Manual', group: 'แผง', run: () => {} }
  ]
  assert.deepEqual(filterCommands(items, 'D20').map(item => item.id), ['b'])
  assert.deepEqual(filterCommands(items, 'scene publish').map(item => item.id), ['a'])
  assert.deepEqual(filterCommands(items, 'manual mon').map(item => item.id), ['c'])
  assert.equal(filterCommands(items, '').length, 3)
  assert.deepEqual(filterCommands(items, 'zzz'), [])
})
