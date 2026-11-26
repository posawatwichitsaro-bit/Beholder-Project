import type { Effect } from './model.ts'
import { conditionBase, exhaustionEffects, parseConditions } from './conditions.ts'
import type { ActiveCondition } from './conditions.ts'

/**
 * Structured conditions (SRD 5.2.1 "Conditions" and "Concentration"):
 * each effect has a source, how it ends and how it can be shaken off.
 * Plain conditions still live in the sheet's `conditions` text; the two
 * are merged for display, one mark per condition name.
 */

/** Conditions that leave a creature Incapacitated, which ends its Concentration. */
export const incapacitating = ['Incapacitated', 'Paralyzed', 'Petrified', 'Stunned', 'Unconscious']

export const effectName = (effect: Pick<Effect, 'condition' | 'level'>) =>
  effect.condition === 'Exhaustion' ? 'Exhaustion ' + Math.max(1, Math.min(6, effect.level ?? 1)) : effect.condition

type WithConditions = { conditions: string; effects?: Effect[] }

/** Text conditions and effects together, one entry per name (Poisoned from two sources shows once). */
export function activeConditions(creature: WithConditions): ActiveCondition[] {
  const list = parseConditions(creature.conditions)
  for (const effect of creature.effects ?? []) {
    const name = effectName(effect)
    const base = conditionBase(name).base
    if (base === 'Exhaustion') {
      // One Exhaustion mark: the higher level wins.
      const existing = list.findIndex(item => conditionBase(item.name).base === 'Exhaustion')
      if (existing < 0) list.push({ name })
      else if ((conditionBase(list[existing].name).level ?? 1) < (effect.level ?? 1)) list[existing] = { name }
    } else if (!list.some(item => item.name === name)) list.push({ name })
  }
  return list
}

export function hasCondition(creature: WithConditions, name: string) {
  return activeConditions(creature).some(item => conditionBase(item.name).base === name)
}

/** The Exhaustion level from text or effects (0 when none). */
export function exhaustionLevel(creature: WithConditions) {
  return Math.max(0, ...activeConditions(creature).map(item => {
    const { base, level } = conditionBase(item.name)
    return base === 'Exhaustion' ? level ?? 1 : 0
  }))
}

/** Exhaustion's penalty to every D20 Test (ability checks, attack rolls, saving throws). */
export const d20Penalty = (creature: WithConditions) => exhaustionEffects(exhaustionLevel(creature)).d20

/** A Concentration check after damage: DC 10 or half the damage taken, whichever is higher, at most 30. */
export const concentrationDc = (damage: number) => Math.min(30, Math.max(10, Math.floor(damage / 2)))

/**
 * One creature's effects as the turn passes from `ended` to `started`
 * (either may be undefined at the start or end of a fight). Effects timed to
 * those turns count down and end; repeat saves due now become pending.
 */
export function advanceEffects(owner: string, effects: Effect[], ended?: string, started?: string) {
  const expired: Effect[] = []
  const prompted: Effect[] = []
  const kept: Effect[] = []
  for (const effect of effects) {
    let next = effect
    for (const [moment, actorId] of [['end', ended], ['start', started]] as const) {
      if (!actorId) continue
      if (next.ends?.at === moment && next.ends.actorId === actorId) next = { ...next, ends: { ...next.ends, turns: next.ends.turns - 1 } }
      if (next.save?.at === moment && actorId === owner && !next.pending) next = { ...next, pending: { ability: next.save.ability, dc: next.save.dc, reason: 'repeat' } }
    }
    if (next.ends && next.ends.turns <= 0) expired.push(next)
    else {
      if (next.pending && !effect.pending) prompted.push(next)
      kept.push(next)
    }
  }
  return { effects: kept, expired, prompted }
}

/** Effects that end when `casterId` loses Concentration (on anyone, including the caster). */
export const tiedTo = (casterId: string, effect: Effect) => Boolean(effect.concentration && effect.sourceId === casterId)
