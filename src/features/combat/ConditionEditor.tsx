import { useState } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import type { Actor, Effect } from '../../../shared/model.ts'
import { activeConditions } from '../../../shared/effects.ts'
import { conditionBase, conditionInfo, conditionThai, exhaustionEffects, isSrdCondition, parseConditions, rankConditions, srdConditions } from '../../../shared/conditions.ts'
import type { ActiveCondition } from '../../../shared/conditions.ts'
import type { Send } from '../../state/useCommand.ts'
import { ConditionIcon, conditionLabel } from './ConditionBadges.tsx'

/**
 * Conditions as chips: pick from the SRD list, optionally for N rounds (they
 * count down each round and drop off by themselves). Exhaustion is one chip
 * with a level you step up and down. Free-text conditions from older sheets
 * stay and can be removed the same way.
 */
export function ConditionEditor({ actor, send }: { actor: Actor; send: Send }) {
  const [open, setOpen] = useState(false)
  const [rounds, setRounds] = useState('')
  const active = rankConditions(parseConditions(actor.conditions))
  const save = (list: ActiveCondition[]) => send({ type: 'conditions', actorId: actor.id, conditions: list })
  const has = (name: string) => active.some(item => conditionBase(item.name).base === name)
  const exhaustion = active.find(item => conditionBase(item.name).base === 'Exhaustion')
  const level = exhaustion ? conditionBase(exhaustion.name).level! : 0
  function setExhaustion(next: number) {
    const rest = active.filter(item => item !== exhaustion)
    void save(next > 0 ? [...rest, { name: 'Exhaustion ' + Math.min(6, next), rounds: exhaustion?.rounds }] : rest)
  }
  return <div className="condition-editor">
    {active.map(item => {
      const { base } = conditionBase(item.name)
      return <span key={item.name} className="condition-chip" title={conditionLabel(item.name, item.rounds)}>
        <ConditionIcon name={item.name} size={13} />
        {item.name}{item.rounds && <small>{item.rounds} รอบ</small>}
        {base === 'Exhaustion' && <>
          <button type="button" aria-label="ลดระดับ Exhaustion" onClick={() => setExhaustion(level - 1)}><Minus size={12} aria-hidden="true" /></button>
          <button type="button" aria-label="เพิ่มระดับ Exhaustion" disabled={level >= 6} onClick={() => setExhaustion(level + 1)}><Plus size={12} aria-hidden="true" /></button>
        </>}
        <button type="button" aria-label={'นำ ' + item.name + ' ออก'} onClick={() => void save(active.filter(entry => entry.name !== item.name))}><X size={12} aria-hidden="true" /></button>
      </span>
    })}
    <button type="button" className="condition-add" aria-expanded={open} onClick={() => setOpen(value => !value)}><Plus size={13} aria-hidden="true" /> Condition</button>
    {open && <div className="condition-picker" role="group" aria-label="เลือก Condition">
      <label className="condition-rounds">นาน (รอบ)<input type="number" min={1} max={99} value={rounds} placeholder="ไม่จำกัด"
        onChange={event => setRounds(event.target.value)} /></label>
      <div className="condition-options">
        {srdConditions.map(name => <button key={name} type="button" aria-pressed={has(name)} title={conditionInfo[name].summary}
          onClick={() => {
            const next = has(name) ? active.filter(entry => conditionBase(entry.name).base !== name)
              : [...active, { name: name === 'Exhaustion' ? 'Exhaustion 1' : name, rounds: rounds ? Math.max(1, Math.min(99, Number(rounds))) : undefined }]
            void save(next)
          }}>{name}<small><ConditionIcon name={name} size={11} /> {conditionThai[name]}</small></button>)}
      </div>
    </div>}
  </div>
}

/** What each active condition does, most limiting first. Read-only; anyone who can see the creature can read it. */
export function ConditionDetails({ creature }: { creature: { conditions: string; effects?: Effect[] } }) {
  const list = rankConditions(activeConditions(creature))
  if (!list.length) return <p className="muted">ไม่มี Condition</p>
  return <ul className="condition-details">{list.map(item => {
    const { base, level } = conditionBase(item.name)
    const effects = base === 'Exhaustion' ? exhaustionEffects(level ?? 1) : undefined
    return <li key={item.name}>
      <span className="condition-details-icon"><ConditionIcon name={item.name} size={16} /></span>
      <span>
        <b>{conditionLabel(item.name, item.rounds)}</b>
        {isSrdCondition(base) && <small>{conditionInfo[base].summary}</small>}
        {effects && <small className="condition-effect">{effects.dead ? 'ระดับ 6: ตาย' : effects.d20 + ' D20 Tests · ' + effects.speed + ' ft. Speed'}</small>}
      </span>
    </li>
  })}</ul>
}
