import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Actor, Scene, Snapshot } from '../../../shared/model.ts'
import { nextLivingTurn } from '../../../shared/model.ts'
import { AreaAttack, DamageTypeSelect } from './CombatEffects.tsx'
import type { Area, AreaKind } from '../../../shared/area.ts'

type Send = (command: Record<string, unknown>) => Promise<boolean>
type Props = {
  room: Snapshot; scene?: Scene; targetId: string; setTarget: (id: string) => void
  send: Send; close: () => void; advanced: (actor: Actor, targetId: string) => ReactNode
  shape?: AreaKind; preview?: Area; chooseArea: (kind: AreaKind) => void; clearArea: () => void
}

function TurnActions({ actor, targetId, targets, setTarget, send, advanced, deathSaved }: {
  actor: Actor; targetId: string; targets: Actor[]; setTarget: (id: string) => void; send: Send; advanced: Props['advanced']; deathSaved: boolean
}) {
  const [weapon, setWeapon] = useState('')
  const [mode, setMode] = useState('normal')
  const [hpMode, setHpMode] = useState('heal')
  const [hpAmount, setHpAmount] = useState(1)
  const target = targets.find(item => item.id === targetId)
  const attack = weapon === '' ? undefined : actor.attacks?.[Number(weapon)]
  const notes = (attack ?? actor.attacks?.find(item => item.bonus === actor.attack && item.damage === actor.damage))?.notes
  function adjust(event: FormEvent) {
    event.preventDefault()
    void send({ type: 'adjustHp', actorId: target?.id ?? actor.id, amount: hpAmount, mode: hpMode,
      damageKind: new FormData(event.currentTarget as HTMLFormElement).get('damageKind') ?? undefined })
  }
  return <section className="turn-actions" aria-label="คำสั่งในเทิร์น">
    <label>เป้าหมาย<select value={target?.id ?? ''} onChange={event => setTarget(event.target.value)}>
      <option value="">เลือกจากกระดานหรือรายการ</option>
      {targets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    {target && <p className="combat-target"><b>{target.name}</b><span>HP {target.hp}/{target.maxHp} · AC {target.ac}</span></p>}
    <div className="combat-options">
      <label>การโจมตี<select value={weapon} onChange={event => setWeapon(event.target.value)}>
        <option value="">โจมตีหลัก</option>
        {actor.attacks?.map((item, index) => <option key={index} value={index}>{item.name}</option>)}
      </select></label>
      <label>การทอย<select value={mode} onChange={event => setMode(event.target.value)}>
        <option value="normal">ปกติ</option><option value="advantage">Advantage</option><option value="disadvantage">Disadvantage</option>
      </select></label>
    </div>
    <button className="primary" disabled={!target || actor.life !== 'active'} onClick={() => void send({
      type: 'sheetRoll', rollType: 'attack', actorId: actor.id, targetId: target?.id, weaponIndex: attack ? Number(weapon) : undefined,
      advantage: mode === 'advantage', disadvantage: mode === 'disadvantage'
    })}>โจมตี · {(attack?.bonus ?? actor.attack) >= 0 ? '+' : ''}{attack?.bonus ?? actor.attack} · {attack?.damage ?? actor.damage}</button>
    {notes && <small>{notes}</small>}
    {actor.life === 'dying' && <button disabled={deathSaved} onClick={() => void send({ type: 'sheetRoll', rollType: 'death', actorId: actor.id })}>
      {deathSaved ? 'ทอย Death Save แล้ว' : 'ทอย Death Save'} · {actor.successes} ผ่าน / {actor.failures} พลาด
    </button>}
    <details><summary>ปรับ HP · {target?.name ?? actor.name}</summary>
      <form className="inline combat-hp" onSubmit={adjust}>
        <select aria-label="วิธีปรับ HP" value={hpMode} onChange={event => setHpMode(event.target.value)}>
          <option value="heal">รักษา</option><option value="damage">ความเสียหาย</option><option value="temp">Temp HP</option>
        </select>
        <input aria-label="จำนวน HP" type="number" min={1} max={9999} required value={hpAmount} onChange={event => setHpAmount(event.target.valueAsNumber)} />
        {hpMode === 'damage' && <DamageTypeSelect />}
        <button>ยืนยัน</button>
      </form>
    </details>
    <details><summary>เวทมนตร์ ทดสอบ และจัดการช่องเวท</summary>{advanced(actor, target?.id ?? '')}</details>
  </section>
}

export function CombatPanel({ room, scene, targetId, setTarget, send, close, advanced, shape, preview, chooseArea, clearArea }: Props) {
  // One click to start: everyone on the board is in, or whoever fought here last time.
  const [excluded, setExcluded] = useState<string[]>(() => scene?.lastParticipants
    ? scene.tokens.map(token => token.actorId).filter(id => !scene.lastParticipants!.includes(id)) : [])
  const [surprised, setSurprised] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState<'next' | 'end'>()
  const fight = scene?.combat
  const current = fight?.order[fight.turn]
  const activeActor = room.actors.find(actor => actor.id === current?.actorId)
  const nextTurn = fight && nextLivingTurn(fight, id => room.actors.find(actor => actor.id === id)?.life === 'dead')
  const next = nextTurn && fight?.order[nextTurn.turn]
  const name = (id?: string) => room.actors.find(actor => actor.id === id)?.name ?? 'ตัวละคร'
  const participants = scene?.tokens.map(token => token.actorId).filter(id => !excluded.includes(id)) ?? []
  const targets = room.actors.filter(actor => actor.id !== current?.actorId && actor.life !== 'dead' && scene?.tokens.some(token => token.actorId === actor.id))
  const queue = room.combatQueue ?? []
  const results = room.rolls.filter(roll => roll.sceneId === scene?.id && roll.sourceId && roll.outcome).slice(-4).reverse()
  const scenePublished = Boolean(scene && scene.id === room.activeSceneId)
  async function run(command: Record<string, unknown>) {
    if (busy) return false
    setBusy(true)
    try { return await send(command) }
    finally { setBusy(false) }
  }
  async function advance(type: 'next' | 'end') {
    if ((type === 'end' || queue.length > 0) && confirmation !== type) { setConfirmation(type); return }
    if (await run({ type })) {
      setTarget('')
      clearArea()
      setConfirmation(undefined)
      if (type === 'end') { setExcluded([]); setSurprised([]) }
    }
  }
  return <aside className="combat-panel" aria-label="แผงต่อสู้ DM" aria-busy={busy}>
    <header><div><small>{fight ? 'รอบ ' + fight.round : 'เตรียม Encounter'}</small><h2>{activeActor ? activeActor.name : 'การต่อสู้'}</h2></div>
      <div className="inline">
        <button onClick={close} aria-label="ปิดแผงต่อสู้">×</button>
      </div></header>
    <label className="inline combat-auto"><input type="checkbox" checked={room.settings?.autoDamage === true}
      onChange={event => void run({ type: 'settings', settings: { autoDamage: event.target.checked } })} />หักความเสียหายอัตโนมัติเมื่อโจมตีโดน</label>
    {activeActor && <div className="combat-vitals">
      {activeActor.portrait && <img src={activeActor.portrait} alt="" />}
      <p><b>HP {activeActor.hp}/{activeActor.maxHp}</b> · AC {activeActor.ac}{activeActor.tempHp > 0 && ' · Temp HP ' + activeActor.tempHp}
        {activeActor.conditions && <small>{activeActor.conditions}</small>}
        {activeActor.life !== 'active' && <small>{({ dying: 'หมดสติ · ต้องทอย Death Save', stable: 'หมดสติ · อาการคงที่', dead: 'เสียชีวิต' })[activeActor.life]}</small>}</p>
    </div>}
    <div className="combat-scroll"><fieldset disabled={busy}>
      {!scenePublished && <p className="muted">{scene ? 'เปิดฉากให้ผู้เล่นก่อนเริ่มหรือควบคุมการต่อสู้' : 'สร้างฉากและวาง Token เพื่อเริ่ม'}</p>}
      {scenePublished && !fight && <section className="combat-block">
        <h3>เลือกผู้ร่วมต่อสู้</h3>
        {scene?.tokens.length ? scene.tokens.map(token => <div className="participants combat-seat" key={token.id}>
          <label className="inline"><input type="checkbox" checked={!excluded.includes(token.actorId)} onChange={event => {
            const id = token.actorId
            setExcluded(current => event.target.checked ? current.filter(entry => entry !== id) : [...current, id])
          }} />{name(token.actorId)}</label>
          <label className="inline"><input type="checkbox" checked={surprised.includes(token.actorId)} disabled={excluded.includes(token.actorId)}
            onChange={event => {
              const id = token.actorId
              setSurprised(current => event.target.checked ? [...current, id] : current.filter(entry => entry !== id))
            }} />ถูกจู่โจม</label>
        </div>) : <p className="muted">วาง Token ก่อนเริ่ม</p>}
        {participants.length > 0 && <button className="primary" onClick={() => void run({ type: 'combat', participants, surprised })}>ทอย Initiative</button>}
      </section>}
      {fight && <>
        <ol className="combat-order" aria-label="ลำดับเทิร์น">
          {fight.order.map((entry, index) => {
            const item = room.actors.find(actor => actor.id === entry.actorId)
            return <li key={entry.actorId}>
              <button aria-current={index === fight.turn ? 'step' : undefined} aria-pressed={targetId === entry.actorId}
                disabled={!item || item.life === 'dead' || index === fight.turn} onClick={() => setTarget(entry.actorId)}>
                <b>{entry.initiative}</b><span>{name(entry.actorId)}</span>{item && <small>{item.hp}/{item.maxHp}</small>}
              </button>
              {scenePublished && index > 0 && entry.initiative === fight.order[index - 1].initiative &&
                <button aria-label={'สลับลำดับ Initiative ของ ' + name(entry.actorId)} onClick={() => void run({ type: 'tie', actorId: entry.actorId })}>↑</button>}
            </li>
          })}
        </ol>
        {scenePublished && activeActor && <TurnActions key={fight.round + ':' + activeActor.id} actor={activeActor} targetId={targetId}
          targets={targets} setTarget={setTarget} send={run} advanced={advanced} deathSaved={fight.deathSaveAt === fight.round + ':' + activeActor.id} />}
      </>}
      {fight && scenePublished && scene && <AreaAttack room={room} scene={scene} preview={preview} shape={shape} choose={chooseArea} clear={clearArea} send={run} />}
      {results.length > 0 && <section className="combat-block"><h3>ผลล่าสุด</h3>
        <ol className="combat-history" aria-live="polite">{results.map(roll => <li key={roll.id}>
          <span>{roll.label} → {name(roll.targetId)}</span><b>{roll.total} · {roll.outcome}</b>
        </li>)}</ol>
      </section>}
    </fieldset></div>
    {fight && scenePublished && <footer>
      {confirmation ? <div className="combat-confirm" role="status">
        <p>{confirmation === 'end' ? 'จบ Encounter นี้?' : 'ยังมีผลรอจัดการ ส่งเทิร์นต่อเลยไหม?'}</p>
        <button className="primary" disabled={busy} onClick={() => void advance(confirmation)}>ยืนยัน</button>
        <button onClick={() => setConfirmation(undefined)}>ยกเลิก</button>
      </div> : <>
        <button disabled={busy} onClick={() => void advance('end')}>จบการต่อสู้</button>
        <button className="primary" aria-label="เทิร์นถัดไป" disabled={busy || !next} onClick={() => void advance('next')}>เทิร์นถัดไป{next && <small>{name(next.actorId)}</small>}</button>
      </>}
    </footer>}
  </aside>
}
