import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Roll, Token } from '../../../shared/model.ts'
import { newStrikes } from './strikes.ts'

const tokens: Token[] = [
  { id: 'a', actorId: 'fighter', x: 0, y: 0 }, { id: 'b', actorId: 'goblin', x: 1, y: 1 }, { id: 'c', actorId: 'archer', x: 5, y: 0 }
]
const roll = (id: string, sourceId: string, outcome: string, at = 1000): Roll =>
  ({ id, name: 'p', label: 'attack', formula: '1d20', faces: [10], modifier: 0, total: 10, at, sceneId: 's', sourceId, targetId: 'goblin', outcome }) as Roll

test('adjacent attackers swing in melee, distant ones shoot; old and seen rolls are skipped', () => {
  const seen = new Set<string>()
  const strikes = newStrikes([roll('1', 'fighter', 'โดน'), roll('2', 'archer', 'พลาด'), roll('3', 'archer', 'คริติคัล', 0)], tokens, 's', seen, 4500, () => 1)
  assert.deepEqual(strikes.map(strike => [strike.id, strike.ranged, strike.outcome]), [['1', false, 'hit'], ['2', true, 'miss']])
  assert.equal(newStrikes([roll('1', 'fighter', 'โดน')], tokens, 's', seen, 4500, () => 1).length, 0, 'each roll animates once')
  assert.equal(newStrikes([{ ...roll('4', 'fighter', 'โดน'), sceneId: 'other' }], tokens, 's', seen, 4500, () => 1).length, 0)
})
