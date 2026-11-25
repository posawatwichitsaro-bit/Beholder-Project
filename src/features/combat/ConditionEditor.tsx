import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { Actor } from '../../../shared/model.ts'
import { conditionThai, parseConditions, srdConditions } from '../../../shared/conditions.ts'
import type { ActiveCondition } from '../../../shared/conditions.ts'
import type { Send } from '../../state/useCommand.ts'

/**
 * Conditions as chips: pick from the SRD list, optionally for N rounds (they
 * count down each round and drop off by themselves). Free-text conditions from
 * older sheets stay and can be removed the same way.
 */
export function ConditionEditor({ actor, send }: { actor: Actor; send: Send }) {
  const [open, setOpen] = useState(false)
  const [rounds, setRounds] = useState('')
  const active = parseConditions(actor.conditions)
  const save = (list: ActiveCondition[]) => send({ type: 'conditions', actorId: actor.id, conditions: list })
  const has = (name: string) => active.some(item => item.name === name)
  return <div className="condition-editor">
    {active.map(item => <span key={item.name} className="condition-chip" title={(conditionThai as Record<string, string>)[item.name] ?? item.name}>
      {item.name}{item.rounds && <small>{item.rounds} รอบ</small>}
      <button type="button" aria-label={'นำ ' + item.name + ' ออก'} onClick={() => void save(active.filter(entry => entry.name !== item.name))}><X size={12} aria-hidden="true" /></button>
    </span>)}
    <button type="button" className="condition-add" aria-expanded={open} onClick={() => setOpen(value => !value)}><Plus size={13} aria-hidden="true" /> Condition</button>
    {open && <div className="condition-picker" role="group" aria-label="เลือก Condition">
      <label className="condition-rounds">นาน (รอบ)<input type="number" min={1} max={99} value={rounds} placeholder="ไม่จำกัด"
        onChange={event => setRounds(event.target.value)} /></label>
      <div className="condition-options">
        {srdConditions.map(name => <button key={name} type="button" aria-pressed={has(name)} title={conditionThai[name]}
          onClick={() => {
            const next = has(name) ? active.filter(entry => entry.name !== name)
              : [...active, { name, rounds: rounds ? Math.max(1, Math.min(99, Number(rounds))) : undefined }]
            void save(next)
          }}>{name}<small>{conditionThai[name]}</small></button>)}
      </div>
    </div>}
  </div>
}
