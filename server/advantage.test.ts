import assert from 'node:assert/strict'
import { test } from 'node:test'
import { attackOdds, chooseMode, chosenMode, oddsMode, rollOdds } from '../shared/advantage.ts'

const creature = (conditions = '', effects: { id: string; condition: string }[] = []) => ({ conditions, effects })

test('attack odds follow the attacker and target conditions; Prone depends on distance', () => {
  assert.equal(oddsMode(attackOdds(creature('Poisoned'), creature(), true)), 'disadvantage')
  assert.equal(oddsMode(attackOdds(creature(), creature('Stunned'), false)), 'advantage')
  assert.equal(oddsMode(attackOdds(creature(), creature('', [{ id: 'e', condition: 'Paralyzed' }]), true)), 'advantage', 'effects count too')
  assert.equal(oddsMode(attackOdds(creature(), creature('Prone'), true)), 'advantage')
  assert.equal(oddsMode(attackOdds(creature(), creature('Prone'), false)), 'disadvantage')
  assert.equal(oddsMode(attackOdds(creature('Invisible'), creature(), false)), 'advantage')
  const both = attackOdds(creature('Blinded'), creature('Restrained'), true)
  assert.equal(oddsMode(both), 'normal', 'one of each cancels')
  assert.match(chooseMode(both).note, /หักล้างกัน/)
  assert.deepEqual(chooseMode(attackOdds(creature(), creature('Prone'), true)), { mode: 'advantage', note: 'Advantage · เป้าหมาย Prone' })
})

test('checks, saves and Initiative; STR and DEX saves fail outright when Paralyzed, Stunned, Unconscious or Petrified', () => {
  assert.equal(oddsMode(rollOdds(creature('Poisoned'), 'check')), 'disadvantage')
  assert.equal(oddsMode(rollOdds(creature('Poisoned'), 'save', 'CON')), 'normal')
  assert.equal(oddsMode(rollOdds(creature('Restrained'), 'save', 'DEX')), 'disadvantage')
  assert.equal(oddsMode(rollOdds(creature('Invisible'), 'initiative')), 'advantage')
  assert.equal(rollOdds(creature('Stunned'), 'save', 'DEX').autoFail, 'Stunned')
  assert.equal(rollOdds(creature('Stunned'), 'save', 'WIS').autoFail, undefined)
})

test('the roller\'s own choice wins over the rules; old Advantage flags still count as a choice', () => {
  const odds = attackOdds(creature('Poisoned'), creature(), true)
  assert.deepEqual(chooseMode(odds, 'advantage'), { mode: 'advantage', note: 'Advantage (เลือกเอง)' })
  assert.equal(chosenMode({ rollMode: 'normal' }), 'normal')
  assert.equal(chosenMode({ advantage: true }), 'advantage')
  assert.equal(chosenMode({}), undefined)
})

test('sheet rolls pick Advantage from conditions on their own, and an explicit choice overrides them', async () => {
  const { applyCommand } = await import('./commands.ts')
  const { blankSheet } = await import('../shared/model.ts')
  const dm = { id: 'dm', name: 'DM', role: 'dm' as const }
  const hero = { ...blankSheet(), id: 'hero', ownerId: 'dm', name: 'Hero', attacks: [{ name: 'Sword', bonus: 5, damage: '1d8+3' }] }
  const orc = { ...blankSheet('monster'), id: 'orc', ownerId: 'dm', name: 'Orc', ac: 1, conditions: 'Prone' }
  const room = { id: 'r', name: 'R', invite: 'i', revision: 0, activeSceneId: 's', members: [dm], templates: [], rolls: [] as { label: string; faces: number[]; outcome?: string }[],
    actors: [hero, orc], scenes: [{ id: 's', name: 'S', cell: 48, originX: 0, originY: 0, tokens: [
      { id: 't1', actorId: 'hero', x: 0, y: 0 }, { id: 't2', actorId: 'orc', x: 1, y: 0 }] }] }
  const attack = (extra = {}) => applyCommand(room as never, dm, { type: 'sheetRoll', sceneId: 's', actorId: 'hero', targetId: 'orc', rollType: 'attack', weaponIndex: 0, ...extra })
  attack()
  const auto = room.rolls.find(roll => roll.label.startsWith('Sword'))!
  assert.equal(auto.faces.length, 2)
  assert.match(auto.label, /Advantage · เป้าหมาย Prone/)
  room.rolls.length = 0
  attack({ rollMode: 'normal' })
  assert.equal(room.rolls.find(roll => roll.label.startsWith('Sword'))!.faces.length, 1)
  orc.conditions = 'Stunned'
  applyCommand(room as never, dm, { type: 'sheetRoll', sceneId: 's', actorId: 'orc', rollType: 'save', ability: 'DEX' })
  assert.match(room.rolls.at(-1)!.outcome ?? '', /ล้มเหลวอัตโนมัติ \(Stunned\)/)
})

test('an Invisible creature leaves the map for other players but not for its owner or the DM', async () => {
  const { snapshot } = await import('./commands.ts')
  const { blankSheet } = await import('../shared/model.ts')
  const dm = { id: 'dm', name: 'DM', role: 'dm' as const }
  const mira = { id: 'm', name: 'Mira', role: 'player' as const }
  const bram = { id: 'b', name: 'Bram', role: 'player' as const }
  const rogue = { ...blankSheet(), id: 'rogue', ownerId: 'm', name: 'Rogue', effects: [{ id: 'e', condition: 'Invisible' }] }
  const room = { id: 'r', name: 'R', invite: 'i', revision: 0, activeSceneId: 's', members: [dm, mira, bram], templates: [], rolls: [], actors: [rogue],
    scenes: [{ id: 's', name: 'S', cell: 48, originX: 0, originY: 0, tokens: [{ id: 't', actorId: 'rogue', x: 4, y: 4 }] }] }
  assert.equal(snapshot(room as never, bram).scenes[0].tokens.length, 0, 'no token, so no position')
  assert.ok(snapshot(room as never, bram).publicActors.some(actor => actor.id === 'rogue'), 'still listed for the turn order')
  assert.equal(snapshot(room as never, mira).scenes[0].tokens.length, 1)
  assert.equal(snapshot(room as never, dm).scenes[0].tokens.length, 1)
  assert.equal(room.scenes[0].tokens.length, 1, 'the stored room is untouched')
})

test('0.07: XP waits after a fight in an XP room; Pact slots, Magical Cunning, Champion crits', async () => {
  const { applyCommand } = await import('./commands.ts')
  const { blankSheet } = await import('../shared/model.ts')
  const { restedSheet } = await import('../shared/rest.ts')
  const dm = { id: 'dm', name: 'DM', role: 'dm' as const }
  const hero = { ...blankSheet(), id: 'hero', ownerId: 'dm', name: 'Hero', classLevel: 'Sorcerer 2 / Warlock 3', slots: 'L1 1/3', pactSlots: 'L2 0/2' }
  const ally = { ...blankSheet(), id: 'ally', ownerId: 'dm', name: 'Ally' }
  const ogre = { ...blankSheet('monster'), id: 'ogre', ownerId: 'dm', name: 'Ogre', classLevel: 'Giant · CR 2', hp: 0, life: 'dead' as const }
  const room = { id: 'r', name: 'R', invite: 'i', revision: 0, activeSceneId: 's', members: [dm], templates: [], rolls: [], actors: [hero, ally, ogre],
    settings: { advancement: 'xp' as const },
    scenes: [{ id: 's', name: 'S', cell: 48, originX: 0, originY: 0, tokens: [{ id: 'a', actorId: 'hero', x: 0, y: 0 }, { id: 'b', actorId: 'ally', x: 1, y: 0 }, { id: 'c', actorId: 'ogre', x: 2, y: 0 }],
      combat: { round: 2, turn: 0, order: [{ actorId: 'hero', initiative: 15 }, { actorId: 'ally', initiative: 12 }, { actorId: 'ogre', initiative: 8 }] } }] }
  const run = (body: Record<string, unknown>) => applyCommand(room as never, dm, { sceneId: 's', ...body })
  run({ type: 'end' })
  const award = (room.scenes[0] as { xpAward?: { total: number; actorIds: string[] } }).xpAward!
  assert.deepEqual(award, { ...award, total: 450, actorIds: ['hero', 'ally'] })
  run({ type: 'awardXp', fromFight: true, actorIds: award.actorIds, amount: 225 })
  assert.equal((hero as { xp?: number }).xp, 225)
  assert.equal((room.scenes[0] as { xpAward?: unknown }).xpAward, undefined)

  // Pact Magic is its own pool: cast from it, regain half with Magical Cunning once, all on a Short Rest.
  assert.throws(() => run({ type: 'magicalCunning', actorId: 'nobody' }))
  run({ type: 'magicalCunning', actorId: 'hero' })
  assert.equal(hero.pactSlots, 'L2 1/2')
  assert.throws(() => run({ type: 'magicalCunning', actorId: 'hero' }), /Magical Cunning/)
  const rested = restedSheet(hero, 'short')
  assert.equal(rested.pactSlots, 'L2 2/2')
  assert.equal(rested.slots, 'L1 1/3', 'ordinary slots wait for a Long Rest')
  assert.equal(restedSheet(hero, 'long').cunningUsed, undefined)
})
