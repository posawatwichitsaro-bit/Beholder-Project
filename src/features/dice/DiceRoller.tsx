import { useState } from 'react'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import type { Roll } from '../../../shared/model.ts'
import type { Send } from '../../state/useCommand.ts'
import { composeFormula } from './dicePool.ts'

const sizes = [4, 6, 8, 10, 12, 20, 100] as const

/**
 * Build a roll by tapping dice (each tap adds one: d6 d6 d4 → 2d6+1d4), nudge
 * the modifier, then roll. A d20 can go straight out with Advantage or
 * Disadvantage. Recent formulas come back with one tap; typing still works.
 */
export function DiceRoller({ send, rolls, me }: { send: Send; rolls: Roll[]; me: string }) {
  const [pool, setPool] = useState<Partial<Record<number, number>>>({})
  const [modifier, setModifier] = useState(0)
  const [typed, setTyped] = useState('')
  const formula = composeFormula(pool, modifier)
  const recent = [...new Set(rolls.filter(roll => roll.name === me && roll.label.startsWith('ทอยเต๋า')).map(roll => roll.formula).reverse())].slice(0, 5)
  const add = (sides: number, step: number) => setPool(current => {
    const count = Math.max(0, Math.min(20, (current[sides] ?? 0) + step))
    return { ...current, [sides]: count }
  })
  const clear = () => { setPool({}); setModifier(0) }
  async function roll(value: string, extra: { advantage?: boolean; disadvantage?: boolean } = {}) {
    if (await send({ type: 'roll', formula: value, ...extra })) clear()
  }

  return <div className="dice-roller">
    <div className="dice-pool" role="group" aria-label="เลือกลูกเต๋า">
      {sizes.map(sides => <div key={sides} className="dice-pick" data-active={pool[sides] ? 'true' : undefined}>
        <button type="button" className="dice-face" aria-label={'เพิ่ม d' + sides} onClick={() => add(sides, 1)}>
          <span>d{sides}</span>{pool[sides] ? <b>×{pool[sides]}</b> : null}
        </button>
        {pool[sides] ? <button type="button" className="dice-less" aria-label={'ลด d' + sides} onClick={() => add(sides, -1)}><Minus size={12} aria-hidden="true" /></button> : null}
      </div>)}
    </div>
    <div className="dice-modifier" role="group" aria-label="ตัวปรับ">
      <button type="button" aria-label="ลดตัวปรับ" onClick={() => setModifier(value => Math.max(-99, value - 1))}><Minus size={14} aria-hidden="true" /></button>
      <span>{modifier >= 0 ? '+' + modifier : modifier}</span>
      <button type="button" aria-label="เพิ่มตัวปรับ" onClick={() => setModifier(value => Math.min(99, value + 1))}><Plus size={14} aria-hidden="true" /></button>
      <button type="button" className="dice-clear" aria-label="ล้างลูกเต๋าที่เลือก" disabled={!formula && !modifier} onClick={clear}><RotateCcw size={14} aria-hidden="true" /></button>
    </div>
    <button type="button" className="primary dice-go" disabled={!formula} onClick={() => void roll(formula)}>{formula ? 'ทอย ' + formula : 'แตะลูกเต๋าเพื่อเลือก'}</button>
    <div className="dice-quick" role="group" aria-label="ทอย d20 ทันที">
      <button type="button" onClick={() => void roll('1d20' + (modifier ? (modifier > 0 ? '+' : '') + modifier : ''))}>d20</button>
      <button type="button" onClick={() => void roll('1d20' + (modifier ? (modifier > 0 ? '+' : '') + modifier : ''), { advantage: true })}>d20 Advantage</button>
      <button type="button" onClick={() => void roll('1d20' + (modifier ? (modifier > 0 ? '+' : '') + modifier : ''), { disadvantage: true })}>d20 Disadvantage</button>
    </div>
    {recent.length > 0 && <div className="dice-recent" role="group" aria-label="สูตรล่าสุด">
      {recent.map(value => <button key={value} type="button" className="bh-chip" onClick={() => void roll(value)}>{value}</button>)}
    </div>}
    <details className="dice-typed">
      <summary>พิมพ์สูตรเอง</summary>
      <form className="inline" onSubmit={event => { event.preventDefault(); if (typed.trim()) void send({ type: 'roll', formula: typed }).then(ok => { if (ok) setTyped('') }) }}>
        <input aria-label="สูตรเต๋า" value={typed} placeholder="เช่น 2d6+1d4+3" onChange={event => setTyped(event.target.value)} /><button className="primary">ทอย</button>
      </form>
    </details>
  </div>
}
