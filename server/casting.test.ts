import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blankSheet } from '../shared/model.ts'
import type { Actor, Member, Room } from '../shared/model.ts'
import { actionCount } from '../shared/economy.ts'
import { applyCommand } from './commands.ts'

const spell = (slug: string) => 'srd-5.2.1:spell:' + slug
const dm: Member = { id: 'dm', name: 'DM', role: 'dm' }
const mira: Member = { id: 'm', name: 'Mira', role: 'player' }

/** A cleric and a wizard (Mira's), a fighter friend, and two goblins side by side. */
function table(fight = false) {
  const wizard: Actor = { ...blankSheet(), id: 'wiz', ownerId: 'm', name: 'Wizard', classLevel: 'Wizard 11', proficiency: 4, spellAttack: 99, spellDC: 40,
    slots: 'L1 4/4, L2 3/3, L3 3/3, L4 3/3, L5 2/2, L6 1/1', hp: 40, maxHp: 40,
    spellbook: [{ id: spell('fire-bolt') }, { id: spell('fireball'), prepared: true }, { id: spell('hold-person'), prepared: true },
      { id: spell('cure-wounds'), prepared: true }, { id: spell('detect-magic'), prepared: true }, { id: spell('healing-word'), prepared: true }] }
  const friend: Actor = { ...blankSheet(), id: 'fri', ownerId: 'other', name: 'Friend', hp: 3, maxHp: 50 }
  const goblin = (id: string): Actor => ({ ...blankSheet('monster'), id, ownerId: 'dm', name: id, hp: 200, maxHp: 200, ac: 1, abilities: { ...blankSheet().abilities, DEX: 1, WIS: 1 } })
  const room: Room = { id: 'r', name: 'R', invite: 'i', revision: 0, activeSceneId: 's', members: [dm, mira], templates: [], rolls: [],
    actors: [wizard, friend, goblin('g1'), goblin('g2')],
    scenes: [{ id: 's', name: 'S', cell: 48, originX: 0, originY: 0, tokens: [
      { id: 't1', actorId: 'wiz', x: 0, y: 0 }, { id: 't2', actorId: 'fri', x: 1, y: 0 }, { id: 't3', actorId: 'g1', x: 8, y: 8 }, { id: 't4', actorId: 'g2', x: 9, y: 8 }],
    ...(fight ? { combat: { round: 1, turn: 0, order: [{ actorId: 'wiz', initiative: 20 }, { actorId: 'g1', initiative: 5 }] } } : {}) }] }
  const run = (who: Member, body: Record<string, unknown>) => applyCommand(room, who, { sceneId: 's', ...body })
  return { room, wizard, friend, run }
}

test('the spellbook holds SRD spells only, each once', () => {
  const { wizard, run } = table()
  run(mira, { type: 'spellbook', actorId: 'wiz', spellbook: [{ id: spell('shield'), prepared: true }, { id: spell('light') }] })
  assert.deepEqual(wizard.spellbook, [{ id: spell('shield'), prepared: true }, { id: spell('light') }])
  assert.throws(() => run(mira, { type: 'spellbook', actorId: 'wiz', spellbook: [{ id: 'homebrew' }] }), /ไม่พบเวท/)
  assert.throws(() => run(mira, { type: 'spellbook', actorId: 'wiz', spellbook: [{ id: spell('light') }, { id: spell('light') }] }), /อยู่ในชีตแล้ว/)
  assert.throws(() => run(mira, { type: 'cast', actorId: 'wiz', spellId: spell('fireball'), targetIds: ['g1'] }), /ไม่อยู่ในชีต/)
})

test('Fireball upcast: one slot, one Action, a DEX save for everyone in the sphere with 10d6, the area shown', () => {
  const { room, wizard, run } = table(true)
  run(mira, { type: 'cast', actorId: 'wiz', spellId: spell('fireball'), slotLevel: 5, area: { kind: 'circle', from: { x: 9, y: 8.5 }, to: { x: 13, y: 8.5 } } })
  assert.match(wizard.slots, /L5 1\/2/)
  const requests = room.rolls.filter(roll => roll.cast)
  assert.deepEqual(requests.map(roll => roll.targetId).sort(), ['g1', 'g2'])
  assert.deepEqual(requests.map(roll => [roll.cast!.ability, roll.cast!.dc, roll.cast!.damage, roll.cast!.half, roll.cast!.damageKind]),
    [['DEX', 40, '10d6', true, 'fire'], ['DEX', 40, '10d6', true, 'fire']])
  assert.deepEqual(actionCount(room.scenes[0].combat!.uses!.wiz, 1), { used: 1, allowed: 1 })
  assert.equal(room.scenes[0].areaEffect?.kind, 'fire')
  // The DM rolls the goblin's save: it fails, takes the full damage roll (not yet applied).
  run(dm, { type: 'spellSave', rollId: requests[0].id })
  const damage = room.rolls[room.rolls.length - 1]
  assert.match(damage.label, /Spell Damage/)
  assert.equal(damage.formula, '10d6')
  assert.equal(damage.damageKind, 'fire')
  assert.throws(() => run(mira, { type: 'cast', actorId: 'wiz', spellId: spell('fireball'), slotLevel: 2, area: { kind: 'circle', from: { x: 9, y: 8 }, to: { x: 13, y: 8 } } }), /ไม่ถูกต้อง|ระดับ/)
})

test('Hold Person: Concentration on the caster, ends the old one, and a failed save offers Paralyzed', () => {
  const { room, wizard, run } = table()
  run(mira, { type: 'cast', actorId: 'wiz', spellId: spell('hold-person'), slotLevel: 2, targetIds: ['g1'] })
  assert.deepEqual(wizard.effects?.map(effect => [effect.condition, effect.sourceLabel]), [['Concentration', 'Hold Person']])
  const request = room.rolls.find(roll => roll.cast)!
  assert.equal(request.cast!.condition, 'Paralyzed')
  run(dm, { type: 'spellSave', rollId: request.id })
  const result = room.rolls[room.rolls.length - 1]
  assert.equal(result.outcome, 'พลาด')
  assert.deepEqual(result.offer, { condition: 'Paralyzed', targetId: 'g1', sourceId: 'wiz', label: 'Hold Person', concentration: true })
  // Applying it is the caster's click, through the existing effect command.
  run(mira, { type: 'addEffect', sourceId: 'wiz', targetIds: ['g1'], condition: 'Paralyzed', sourceLabel: 'Hold Person', concentration: true })
  assert.ok(room.actors.find(item => item.id === 'g1')!.effects?.some(effect => effect.condition === 'Paralyzed'))
  // A second Concentration spell (Detect Magic) ends Hold Person and its Paralyzed.
  run(mira, { type: 'cast', actorId: 'wiz', spellId: spell('detect-magic') })
  assert.deepEqual(wizard.effects?.map(effect => effect.sourceLabel), ['Detect Magic'])
  assert.ok(!room.actors.find(item => item.id === 'g1')!.effects?.length)
})

test('Cure Wounds heals a friend at once, scaled by the slot; the caster may undo it; Healing Word is a Bonus Action', () => {
  const { room, wizard, friend, run } = table(true)
  run(mira, { type: 'cast', actorId: 'wiz', spellId: spell('cure-wounds'), slotLevel: 2, targetIds: ['fri'] })
  const roll = room.rolls[room.rolls.length - 1]
  assert.equal(roll.formula.split('+')[0], '4d8')
  assert.ok(friend.hp > 3)
  assert.match(wizard.slots, /L2 2\/3/)
  run(mira, { type: 'undo' })
  assert.equal(friend.hp, 3, 'the HP the spell gave comes back off')
  assert.match(wizard.slots, /L2 3\/3/)
  run(mira, { type: 'cast', actorId: 'wiz', spellId: spell('healing-word'), slotLevel: 1, targetIds: ['fri'] })
  assert.equal(room.scenes[0].combat!.uses!.wiz.bonus, 1)
  assert.equal(room.scenes[0].combat!.uses!.wiz.spellActions, 0)
})

test('Fire Bolt grows with the character level; Detect Magic as a Ritual spends no slot and not in a fight', () => {
  const { room, wizard, run } = table()
  // A natural 1 misses even at +99: cast until it hits.
  for (let tries = 0; tries < 20 && !/Damage/.test(room.rolls.at(-1)?.label ?? ''); tries++) run(mira, { type: 'cast', actorId: 'wiz', spellId: spell('fire-bolt'), targetIds: ['g1'] })
  const damage = room.rolls[room.rolls.length - 1]
  assert.match(damage.label, /Damage/)
  assert.match(damage.formula, /^3d10/)
  assert.equal(damage.damageKind, 'fire')
  const slots = wizard.slots
  run(mira, { type: 'cast', actorId: 'wiz', spellId: spell('detect-magic'), ritual: true })
  assert.equal(wizard.slots, slots)
  assert.match(room.log!.at(-1)!.text, /Ritual.*10 นาที/)
  assert.throws(() => run(mira, { type: 'cast', actorId: 'wiz', spellId: spell('fireball'), ritual: true }), /Ritual/)
  const fight = table(true)
  assert.throws(() => fight.run(mira, { type: 'cast', actorId: 'wiz', spellId: spell('detect-magic'), ritual: true }), /ระหว่างต่อสู้/)
})

test('Rage, Second Wind and Bardic Inspiration spend a use and the Bonus Action and do what the class table says', () => {
  const barb: Actor = { ...blankSheet(), id: 'barb', ownerId: 'm', name: 'Barb', classLevel: 'Barbarian 9', hp: 40, maxHp: 60, attack: 99, damage: '1d8+3',
    resources: [{ name: 'Rage', max: 3, used: 0, short: 'one' }], effects: [{ id: 'c', condition: 'Concentration', sourceId: 'barb', sourceLabel: 'Bless' }] }
  const fighter: Actor = { ...blankSheet(), id: 'fig', ownerId: 'm', name: 'Fig', classLevel: 'Fighter 4', hp: 10, maxHp: 40, resources: [{ name: 'Second Wind', max: 3, used: 0, short: 'one' }] }
  const bard: Actor = { ...blankSheet(), id: 'bard', ownerId: 'm', name: 'Bard', classLevel: 'Bard 5', resources: [{ name: 'Bardic Inspiration', max: 3, used: 0, short: 'all' }] }
  const ogre: Actor = { ...blankSheet('monster'), id: 'ogre', ownerId: 'dm', name: 'Ogre', hp: 200, maxHp: 200, ac: 1 }
  const room: Room = { id: 'r', name: 'R', invite: 'i', revision: 0, activeSceneId: 's', members: [dm, mira], templates: [], rolls: [], actors: [barb, fighter, bard, ogre],
    scenes: [{ id: 's', name: 'S', cell: 48, originX: 0, originY: 0, tokens: [{ id: 't1', actorId: 'barb', x: 0, y: 0 }, { id: 't2', actorId: 'ogre', x: 1, y: 0 }, { id: 't3', actorId: 'fig', x: 3, y: 3 }, { id: 't4', actorId: 'bard', x: 4, y: 4 }],
      combat: { round: 1, turn: 0, order: [{ actorId: 'barb', initiative: 20 }, { actorId: 'ogre', initiative: 5 }] } }] }
  const run = (who: Member, body: Record<string, unknown>) => applyCommand(room, who, { sceneId: 's', ...body })
  run(mira, { type: 'classFeature', actorId: 'barb', feature: 'rage' })
  assert.equal(barb.resources![0].used, 1)
  assert.equal(room.scenes[0].combat!.uses!.barb.bonus, 1)
  assert.deepEqual(barb.effects!.map(effect => effect.condition), ['Raging'], 'Rage ends Concentration')
  // Rage Damage +3 at Barbarian 9 on weapon hits; B/P/S damage taken is halved.
  for (let tries = 0; tries < 20 && !/Damage/.test(room.rolls.at(-1)?.label ?? ''); tries++) run(mira, { type: 'sheetRoll', rollType: 'attack', actorId: 'barb', targetId: 'ogre' })
  assert.match(room.rolls.at(-1)!.formula, /^1d8\+6$/)
  run(dm, { type: 'adjustHp', actorId: 'barb', mode: 'damage', amount: 11, damageKind: 'slashing' })
  assert.equal(barb.hp, 35)
  run(dm, { type: 'adjustHp', actorId: 'barb', mode: 'damage', amount: 10, damageKind: 'fire' })
  assert.equal(barb.hp, 25)
  run(mira, { type: 'classFeature', actorId: 'fig', feature: 'secondWind' })
  assert.ok(fighter.hp >= 15 && fighter.hp <= 24, 'Second Wind heals 1d10 + 4: ' + fighter.hp)
  run(mira, { type: 'classFeature', actorId: 'bard', feature: 'bardicInspiration', targetId: 'barb' })
  assert.equal(barb.effects!.find(effect => effect.condition === 'Inspired')?.sourceLabel, 'Bardic Inspiration d8')
  assert.throws(() => run(mira, { type: 'classFeature', actorId: 'bard', feature: 'bardicInspiration', targetId: 'bard' }), /คนอื่น/)
  // Spending it on a check adds the d8 once.
  run(mira, { type: 'sheetRoll', rollType: 'check', actorId: 'barb', ability: 'STR', inspiration: true })
  assert.match(room.rolls.at(-1)!.formula, /\+1d8\(\d\)$/)
  assert.ok(!barb.effects!.some(effect => effect.condition === 'Inspired'))
  assert.throws(() => run(mira, { type: 'sheetRoll', rollType: 'check', actorId: 'barb', ability: 'STR', inspiration: true }), /ไม่มี Bardic Inspiration/)
  bard.resources![0].used = 3
  assert.throws(() => run(mira, { type: 'classFeature', actorId: 'bard', feature: 'bardicInspiration', targetId: 'fig' }), /ไม่มี Bardic Inspiration เหลือ/)
})
