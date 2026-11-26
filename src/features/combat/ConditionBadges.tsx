import { ArrowDown, Ban, BedDouble, CircleDot, EarOff, EyeOff, FlaskConical, Ghost, Hand, Heart, Link, Lock, Moon, Mountain, Sparkles, Tag, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { conditionBase, conditionThai, isSrdCondition, parseConditions, rankConditions } from '../../../shared/conditions.ts'
import type { ConditionName } from '../../../shared/conditions.ts'

/** One shape per condition, so they read without relying on colour. */
export const conditionIcons: Record<ConditionName, LucideIcon> = {
  Blinded: EyeOff, Charmed: Heart, Deafened: EarOff, Exhaustion: Moon, Frightened: Ghost, Grappled: Hand,
  Incapacitated: Ban, Invisible: Sparkles, Paralyzed: Lock, Petrified: Mountain, Poisoned: FlaskConical,
  Prone: ArrowDown, Restrained: Link, Stunned: Zap, Unconscious: BedDouble, Concentration: CircleDot
}

export function ConditionIcon({ name, size = 14 }: { name: string; size?: number }) {
  const { base } = conditionBase(name)
  const Icon = isSrdCondition(base) ? conditionIcons[base] : Tag
  return <Icon size={size} aria-hidden="true" />
}

/** "Paralyzed (อัมพาต)", "Exhaustion 2 (เหนื่อยล้า)" — the full name screen readers read. */
export function conditionLabel(name: string, rounds?: number) {
  const { base } = conditionBase(name)
  const thai = isSrdCondition(base) ? ' (' + conditionThai[base] + ')' : ''
  return name + thai + (rounds ? ' · อีก ' + rounds + ' รอบ' : '')
}

/**
 * Leather-and-brass condition marks: the most limiting `max` first, then "+N".
 * Exhaustion shows its level on the icon.
 */
export function ConditionBadges({ conditions, max = 2, size = 12 }: { conditions: string; max?: number; size?: number }) {
  const list = rankConditions(parseConditions(conditions))
  if (!list.length) return null
  const shown = list.slice(0, max)
  return <span className="condition-badges" role="img" aria-label={'Condition: ' + list.map(item => conditionLabel(item.name, item.rounds)).join(', ')}>
    {shown.map(item => <span key={item.name} className="condition-badge" title={conditionLabel(item.name, item.rounds)}>
      <ConditionIcon name={item.name} size={size} />
      {conditionBase(item.name).level !== undefined && <b>{conditionBase(item.name).level}</b>}
    </span>)}
    {list.length > max && <span className="condition-badge condition-more" title={list.slice(max).map(item => conditionLabel(item.name)).join(', ')}>+{list.length - max}</span>}
  </span>
}
