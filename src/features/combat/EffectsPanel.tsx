import { useEffect, useState } from 'react'
import { abilities } from '../../../shared/model.ts'
import type { Ability, Actor, Effect, Snapshot } from '../../../shared/model.ts'
import { srdConditions } from '../../../shared/conditions.ts'
import { effectName } from '../../../shared/effects.ts'
import type { Send } from '../../state/useCommand.ts'
import { ConditionDetails, ConditionEditor } from './ConditionEditor.tsx'
import { MoveHandle, useMovable } from '../../ui/index.ts'
import { ConditionIcon } from './ConditionBadges.tsx'

type Creature = Snapshot['publicActors'][number]
type Ending = 'none' | 'source-end' | 'source-start' | 'self-end'

/** "จบตอนจบเทิร์นของ Lyra (อีก 1 เทิร์น)" and the like. */
function describe(effect: Effect, nameOf: (id?: string) => string) {
  const parts: string[] = []
  if (effect.sourceLabel || effect.sourceId) parts.push('จาก ' + [effect.sourceLabel, effect.sourceId && nameOf(effect.sourceId)].filter(Boolean).join(' · '))
  if (effect.concentration) parts.push('ผูกกับ Concentration')
  if (effect.ends) parts.push('จบตอน' + (effect.ends.at === 'start' ? 'เริ่ม' : 'จบ') + 'เทิร์นของ ' + nameOf(effect.ends.actorId) + (effect.ends.turns > 1 ? ' (อีก ' + effect.ends.turns + ' เทิร์น)' : ''))
  if (effect.save) parts.push('ทอย ' + effect.save.ability + ' save DC ' + effect.save.dc + ' ตอน' + (effect.save.at === 'start' ? 'เริ่ม' : 'จบ') + 'เทิร์น เพื่อพ้น')
  if (effect.hidden) parts.push('ลับ (DM เห็นคนเดียว)')
  return parts.join(' · ')
}

/**
 * Everything about one creature's conditions, opened from its token:
 * what each one does, where it came from, when it ends, saves waiting to be
 * rolled, and — for the DM, the owner, or whoever controls the source — the
 * tools to add or end them.
 */
export function EffectsPanel({ room, creature, sources, send, close }: {
  room: Snapshot; creature: Creature; sources: { id: string; name: string }[]; send: Send; close: () => void
}) {
  const dm = room.me.role === 'dm'
  const owned = room.actors.find(item => item.id === creature.id)
  const nameOf = (id?: string) => room.publicActors.find(item => item.id === id)?.name ?? room.actors.find(item => item.id === id)?.name ?? 'ตัวละคร'
  const mine = (id?: string) => Boolean(id && room.actors.some(item => item.id === id))
  const effects = (owned ?? creature).effects ?? []
  useEffect(() => {
    function key(event: KeyboardEvent) { if (event.key === 'Escape') { event.preventDefault(); close() } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [close])

  return <div className="scrim" onClick={event => { if (event.target === event.currentTarget) close() }}>
    <section className="dialog compact condition-panel bh-on-parchment" role="dialog" aria-modal="true" aria-label={'Condition · ' + creature.name}>
      <header><h2>Condition · {creature.name}</h2><button type="button" aria-label="ปิด" onClick={close}>×</button></header>
      <ConditionDetails creature={owned ?? creature} />
      {effects.length > 0 && <ul className="effect-list" aria-label="ที่มาและเวลาจบ">{effects.map(effect => <li key={effect.id}>
        <span className="condition-details-icon"><ConditionIcon name={effectName(effect)} size={14} /></span>
        <span className="effect-text"><b>{effectName(effect)}</b><small>{describe(effect, nameOf) || 'ไม่มีกำหนดจบ'}</small></span>
        <span className="effect-actions">
          {effect.pending && (dm || owned) && <button type="button" className="primary"
            onClick={() => void send({ type: 'effectSave', actorId: creature.id, effectId: effect.id })}>
            ทอย {effect.pending.ability} save (DC {effect.pending.dc})</button>}
          {effect.pending && dm && <button type="button" onClick={() => void send({ type: 'effectSave', actorId: creature.id, effectId: effect.id, skip: true })}>ข้ามเซฟ</button>}
          {(dm || owned || mine(effect.sourceId)) && <button type="button" aria-label={'จบ ' + effectName(effect) + (effect.sourceLabel ? ' จาก ' + effect.sourceLabel : '')}
            onClick={() => void send({ type: 'removeEffect', actorId: creature.id, effectId: effect.id })}>จบ</button>}
        </span>
      </li>)}</ul>}
      {owned ? <ConditionEditor actor={owned as Actor} send={send} /> : !sources.length && <p className="muted">เจ้าของตัวละครหรือ DM เป็นผู้แก้ Condition</p>}
      {(dm || owned || sources.length > 0) && <EffectForm room={room} creature={creature} sources={sources} send={send} />}
    </section>
  </div>
}

/** Add a condition with a source, an end and a repeat save — Hold Person, a net, a frightening roar. */
function EffectForm({ room, creature, sources, send }: { room: Snapshot; creature: Creature; sources: { id: string; name: string }[]; send: Send }) {
  const dm = room.me.role === 'dm'
  const [condition, setCondition] = useState('Paralyzed')
  const [custom, setCustom] = useState('')
  const [level, setLevel] = useState(1)
  const [sourceId, setSourceId] = useState(sources.find(item => item.id !== creature.id)?.id ?? '')
  const [label, setLabel] = useState('')
  const [ending, setEnding] = useState<Ending>('none')
  const [saveOn, setSaveOn] = useState(false)
  const [ability, setAbility] = useState<Ability>('WIS')
  const [dc, setDc] = useState(13)
  const [concentration, setConcentration] = useState(false)
  const [hidden, setHidden] = useState(false)
  const name = condition === 'other' ? custom.trim() : condition
  const needsSource = !dm && !room.actors.some(item => item.id === creature.id)

  async function add() {
    const ends = ending === 'none' ? undefined
      : ending === 'self-end' ? { at: 'end', actorId: creature.id, turns: 1 }
      : { at: ending === 'source-start' ? 'start' : 'end', actorId: sourceId, turns: 1 }
    const ok = await send({
      type: 'addEffect', targetIds: [creature.id], condition: name, level: name === 'Exhaustion' ? level : undefined,
      sourceId: sourceId || undefined, sourceLabel: label.trim() || undefined, ends,
      save: saveOn ? { ability, dc, at: 'end' } : undefined, concentration: concentration && Boolean(sourceId), hidden: dm && hidden
    })
    if (ok) { setLabel(''); setSaveOn(false); setConcentration(false) }
  }

  return <details className="effect-form">
    <summary>เพิ่ม Condition แบบมีที่มา</summary>
    <div className="effect-form-grid">
      <label>Condition<select aria-label="Condition ที่จะเพิ่ม" value={condition} onChange={event => setCondition(event.target.value)}>
        {srdConditions.filter(item => item !== 'Concentration').map(item => <option key={item}>{item}</option>)}
        <option value="other">อื่น ๆ (พิมพ์เอง)</option>
      </select></label>
      {condition === 'other' && <label>ชื่อ<input value={custom} maxLength={40} onChange={event => setCustom(event.target.value)} placeholder="เช่น Blessed" /></label>}
      {condition === 'Exhaustion' && <label>ระดับ<input type="number" min={1} max={6} value={level} onChange={event => setLevel(Math.max(1, Math.min(6, event.target.valueAsNumber || 1)))} /></label>}
      <label>ผู้ทำ<select aria-label="ผู้ทำ" value={sourceId} onChange={event => setSourceId(event.target.value)}>
        {!needsSource && <option value="">ไม่ระบุ</option>}
        {sources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>มาจาก (เวท / ความสามารถ)<input value={label} maxLength={60} onChange={event => setLabel(event.target.value)} placeholder="เช่น Hold Person" /></label>
      <label>จบเมื่อ<select aria-label="จบเมื่อ" value={ending} onChange={event => setEnding(event.target.value as Ending)}>
        <option value="none">ไม่มีกำหนด (จบเอง)</option>
        {sourceId && <option value="source-end">จบเทิร์นถัดไปของผู้ทำ</option>}
        {sourceId && <option value="source-start">เริ่มเทิร์นถัดไปของผู้ทำ</option>}
        <option value="self-end">จบเทิร์นถัดไปของ {creature.name}</option>
      </select></label>
    </div>
    <label className="wizard-check"><input type="checkbox" checked={saveOn} onChange={event => setSaveOn(event.target.checked)} />ทอยเซฟซ้ำตอนจบเทิร์นของ {creature.name}</label>
    {saveOn && <div className="effect-form-grid">
      <label>Save<select aria-label="Save ที่ต้องทอย" value={ability} onChange={event => setAbility(event.target.value as Ability)}>{abilities.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>DC<input type="number" min={1} max={40} value={dc} onChange={event => setDc(Math.max(1, Math.min(40, event.target.valueAsNumber || 10)))} /></label>
    </div>}
    {sourceId && <label className="wizard-check"><input type="checkbox" checked={concentration} onChange={event => setConcentration(event.target.checked)} />ผูกกับ Concentration ของผู้ทำ</label>}
    {dm && <label className="wizard-check"><input type="checkbox" checked={hidden} onChange={event => setHidden(event.target.checked)} />ลับ (ผู้เล่นไม่เห็น)</label>}
    <button type="button" className="primary" disabled={!name || (needsSource && !sourceId)} onClick={() => void add()}>เพิ่ม {name || 'Condition'}</button>
  </details>
}

/** Saves waiting to be rolled by this seat: repeat saves and Concentration checks. */
export function PendingSaves({ room, send }: { room: Snapshot; send: Send }) {
  const dm = room.me.role === 'dm'
  const movable = useMovable('pending-saves')
  const pool: { id: string; name: string; effects?: Effect[] }[] = dm ? room.publicActors : room.actors
  const waiting = pool.flatMap(creature => (creature.effects ?? []).filter(effect => effect.pending).map(effect => ({ creature, effect })))
  if (!waiting.length) return null
  return <section className="pending-saves" aria-label="รอทอยเซฟ" {...movable}>
    <h2><MoveHandle id="pending-saves" label="การ์ดรอทอยเซฟ" />รอทอยเซฟ · {waiting.length}</h2>
    {waiting.map(({ creature, effect }) => <div key={effect.id} className="pending-save">
      <span><b>{creature.name}</b><small>{effect.pending!.ability} save DC {effect.pending!.dc} · {effect.pending!.reason === 'concentration' ? 'Concentration' : effectName(effect)}{effect.sourceLabel ? ' (' + effect.sourceLabel + ')' : ''}</small></span>
      <button type="button" className="primary" onClick={() => void send({ type: 'effectSave', actorId: creature.id, effectId: effect.id })}>ทอย</button>
      {dm && <button type="button" onClick={() => void send({ type: 'effectSave', actorId: creature.id, effectId: effect.id, skip: true })}>ข้าม</button>}
    </div>)}
  </section>
}
