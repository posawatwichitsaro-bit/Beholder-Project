import { useState } from 'react'
import type { DamageKind, Roll, Snapshot } from '../../../shared/model.ts'
import type { Send } from '../../state/useCommand.ts'
import { MoveHandle, useMovable } from '../../ui/index.ts'
import { DamageTypeSelect } from './CombatEffects.tsx'

function QueueItem({ roll, name, send, sceneId }: { roll: Roll; name: string; send: Send; sceneId?: string }) {
  const [amount, setAmount] = useState(String(Math.max(0, roll.total)))
  const [proficient, setProficient] = useState(false)
  const [damageKind, setDamageKind] = useState<DamageKind>(roll.damageKind ?? 'untyped')
  const apply = (value: number) => send({ type: 'damage', rollId: roll.id, actorId: roll.targetId, amount: value, damageKind, sceneId })
  // 0.14: a failed save whose spell gives a condition: apply it here, or let it go.
  if (roll.offer && !roll.cast && roll.applied !== false) {
    const offer = roll.offer
    return <article className="queue-item">
      <p className="queue-line"><b>{name}</b> พลาดเซฟ · {offer.label}<small>{roll.label} · {roll.total}</small></p>
      <div className="queue-actions">
        <button className="primary" onClick={() => void send({ type: 'addEffect', sourceId: offer.sourceId, targetIds: [offer.targetId], condition: offer.condition,
          sourceLabel: offer.label, ...(offer.concentration ? { concentration: true } : {}), sceneId })}>ใส่ {offer.condition} ให้ {name}</button>
        <button onClick={() => void send({ type: 'dismissOffer', rollId: roll.id, sceneId })}>ไม่ใส่</button>
      </div>
    </article>
  }
  if (roll.cast) return <article className="queue-item">
    <p className="queue-line"><b>{name}</b> ต้องทอย {roll.cast.ability} Save · DC {roll.cast.dc}<small>{roll.label}</small></p>
    <div className="queue-actions">
      <label className="queue-check"><input type="checkbox" checked={proficient} onChange={event => setProficient(event.target.checked)} />มี Proficiency</label>
      <button className="primary" onClick={() => void send({ type: 'spellSave', rollId: roll.id, proficient, sceneId })}>ทอย Save ให้ {name}</button>
    </div>
  </article>
  return <form className="queue-item" onSubmit={event => { event.preventDefault(); void apply(Number(amount)) }}>
    <p className="queue-line"><b>{name}</b> โดน {roll.total}{roll.critical ? ' · คริติคัล' : ''}<small>{roll.label} · {roll.formula} [{roll.faces.join(', ')}]</small></p>
    <div className="queue-actions">
      <DamageTypeSelect value={damageKind} change={setDamageKind} />
      <input aria-label={'ความเสียหายต่อ ' + name} required type="number" min={0} max={9999} value={amount} onChange={event => setAmount(event.target.value)} />
    </div>
    <div className="queue-actions">
      <button className="primary">หัก HP</button>
      <button type="button" onClick={() => void apply(Math.floor(Number(amount) / 2))}>ครึ่ง</button>
      <button type="button" onClick={() => void send({ type: 'damage', rollId: roll.id, actorId: roll.targetId, amount: 0, sceneId })}>ข้ามผล</button>
    </div>
  </form>
}

/**
 * The DM's one place to settle results: hits waiting for damage and saves
 * waiting to be rolled. Floats over the map while anything is pending, so
 * there is no panel to open; the auto-damage switch lives in its header.
 */
export function DamageQueue({ room, send }: { room: Snapshot; send: Send }) {
  const queue = room.combatQueue ?? []
  const movable = useMovable('damage-queue')
  if (room.me.role !== 'dm' || !queue.length) return null
  const name = (id?: string) => room.publicActors.find(actor => actor.id === id)?.name ?? 'ตัวละคร'
  return <section className="damage-queue" aria-label="ผลรอจัดการ" {...movable}>
    <header>
      <MoveHandle id="damage-queue" label="การ์ดรอการตัดสิน" />
      <h2>รอการตัดสิน · {queue.length}</h2>
      <label className="queue-check"><input type="checkbox" checked={room.settings?.autoDamage === true}
        onChange={event => void send({ type: 'settings', settings: { autoDamage: event.target.checked } })} />หักอัตโนมัติเมื่อโดน</label>
    </header>
    <div className="damage-queue-list">
      {queue.map(roll => <QueueItem key={roll.id} roll={roll} name={name(roll.targetId ?? roll.cast?.targetId)} send={send} sceneId={roll.sceneId ?? room.activeSceneId} />)}
    </div>
  </section>
}
