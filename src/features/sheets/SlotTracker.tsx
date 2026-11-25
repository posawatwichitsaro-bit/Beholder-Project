import { useState } from 'react'
import { Moon } from 'lucide-react'
import type { Actor } from '../../../shared/model.ts'
import { formatSlots, parseSlots } from '../../../shared/conditions.ts'
import type { Send } from '../../state/useCommand.ts'

/**
 * Spell slots as pips per level: a filled pip is a slot you still have.
 * Click a filled pip to spend it, an empty one to get it back; a long rest
 * refills everything. Sheets whose slots are free text keep a text box.
 */
export function SlotTracker({ actor, send }: { actor: Actor; send: Send }) {
  const levels = parseSlots(actor.slots)
  const [text, setText] = useState(actor.slots)
  const save = (slots: string) => send({ type: 'slots', slots, actorId: actor.id })
  if (!levels || !levels.length) return <form className="sheet-inline slot-text" onSubmit={event => { event.preventDefault(); void save(text) }}>
    <label>ช่องเวท<input value={text} placeholder="เช่น L1 4/4, L2 2/2" onChange={event => setText(event.target.value)} /></label>
    <button>บันทึก</button>
    <small>เขียนแบบ “L1 4/4, L2 2/2” แล้วจะกดใช้ทีละช่องได้</small>
  </form>
  return <div className="slot-tracker" aria-label="ช่องเวท">
    {levels.map(slot => <div className="slot-row" key={slot.level}>
      <span className="slot-level">ระดับ {slot.level}</span>
      <span className="slot-pips">
        {Array.from({ length: slot.max }, (_, index) => {
          const available = index < slot.left
          return <button key={index} type="button" className="slot-pip" aria-pressed={available}
            aria-label={'ช่องเวทระดับ ' + slot.level + ' ที่ ' + (index + 1) + (available ? ' (ยังใช้ได้)' : ' (ใช้แล้ว)')}
            onClick={() => void save(formatSlots(levels.map(entry => entry.level === slot.level
              ? { ...entry, left: available ? entry.left - 1 : entry.left + 1 } : entry)))} />
        })}
      </span>
      <span className="slot-count">{slot.left}/{slot.max}</span>
    </div>)}
    <button type="button" className="slot-rest" onClick={() => void save(formatSlots(levels.map(entry => ({ ...entry, left: entry.max }))))}>
      <Moon size={14} aria-hidden="true" /> พักยาว · คืนช่องเวททั้งหมด</button>
  </div>
}
