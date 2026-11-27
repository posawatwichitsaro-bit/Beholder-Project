import { useState } from 'react'
import { Eye, Flame } from 'lucide-react'
import type { Actor } from '../../../shared/model.ts'
import { visionOf } from '../../../shared/vision.ts'
import type { Send } from '../../state/useCommand.ts'

const presets = [{ label: 'Torch / คบไฟ', bright: 20, dim: 20 }, { label: 'Lantern / ตะเกียง', bright: 30, dim: 30 }, { label: 'Light (Cantrip)', bright: 20, dim: 20 }, { label: 'Candle / เทียน', bright: 5, dim: 5 }]

/**
 * How a creature sees: vision range, Darkvision (from its species or stat block
 * unless the DM set it) and a carried light. Only the DM changes these; a
 * player can light or put out the light the DM gave them.
 */
export function VisionFields({ actor, dm, send }: { actor: Actor; dm: boolean; send: Send }) {
  const vision = visionOf(actor)
  const [editing, setEditing] = useState(false)
  const [range, setRange] = useState(vision.range ?? 0)
  const [darkvision, setDarkvision] = useState(vision.darkvision ?? 0)
  const [bright, setBright] = useState(vision.light?.bright ?? 0)
  const [dim, setDim] = useState(vision.light?.dim ?? 0)
  const light = vision.light
  const summary = [
    vision.range ? 'มองได้ ' + vision.range + ' ฟุต' : 'มองได้ไกลเท่าที่ผนังและแสงให้',
    vision.darkvision ? 'Darkvision ' + vision.darkvision + ' ฟุต' : 'ไม่มี Darkvision',
    light ? 'แสง ' + light.bright + '/' + light.dim + ' ฟุต' + (light.on ? ' (จุดอยู่)' : ' (ดับ)') : undefined
  ].filter(Boolean).join(' · ')
  return <section className="sheet-vision" aria-label="การมองเห็น">
    <h3><Eye size={14} aria-hidden="true" /> การมองเห็น</h3>
    <p className="sheet-note">{summary}</p>
    {light && <button type="button" onClick={() => void send({ type: 'actorVision', actorId: actor.id, lightOn: !light.on })}>
      <Flame size={14} aria-hidden="true" /> {light.on ? 'ดับแสง' : 'จุดแสง'}</button>}
    {dm && !editing && <button type="button" onClick={() => setEditing(true)}>ตั้งค่าการมองเห็น</button>}
    {dm && editing && <form className="sheet-vision-form" onSubmit={async event => {
      event.preventDefault()
      const ok = await send({ type: 'actorVision', actorId: actor.id, vision: {
        range: range || undefined, darkvision, light: bright + dim > 0 ? { bright, dim, on: light?.on ?? true } : undefined
      } })
      if (ok) setEditing(false)
    }}>
      <label>ระยะมองเห็น (ฟุต, 0 = ไม่จำกัด)<input type="number" min={0} max={1000} step={5} value={range} onChange={event => setRange(event.target.valueAsNumber || 0)} /></label>
      <label>Darkvision (ฟุต)<input type="number" min={0} max={1000} step={5} value={darkvision} onChange={event => setDarkvision(event.target.valueAsNumber || 0)} /></label>
      <label>แหล่งแสงที่ถือ<select aria-label="ชนิดแหล่งแสง" value={presets.find(item => item.bright === bright && item.dim === dim)?.label ?? (bright + dim ? 'custom' : 'none')} onChange={event => {
        const preset = presets.find(item => item.label === event.target.value)
        if (event.target.value === 'none') { setBright(0); setDim(0) } else if (preset) { setBright(preset.bright); setDim(preset.dim) }
      }}>
        <option value="none">ไม่มี</option>{presets.map(item => <option key={item.label} value={item.label}>{item.label} ({item.bright}/{item.dim} ฟุต)</option>)}
        <option value="custom" disabled>กำหนดเอง</option>
      </select></label>
      <label>แสงสว่าง (ฟุต)<input type="number" min={0} max={300} step={5} value={bright} onChange={event => setBright(event.target.valueAsNumber || 0)} /></label>
      <label>แสงสลัวต่ออีก (ฟุต)<input type="number" min={0} max={300} step={5} value={dim} onChange={event => setDim(event.target.valueAsNumber || 0)} /></label>
      <div className="inline"><button className="primary">บันทึก</button><button type="button" onClick={() => setEditing(false)}>ยกเลิก</button></div>
    </form>}
  </section>
}
