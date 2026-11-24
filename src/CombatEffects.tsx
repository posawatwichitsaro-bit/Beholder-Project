import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { damageKinds, sizes } from '../shared/model.ts'
import type { DamageKind, Scene, Snapshot } from '../shared/model.ts'
import { areaContains, areaLabels, areaOutline } from '../shared/area.ts'
import type { Area, AreaKind } from '../shared/area.ts'
import { tokenColor, tokenInitials } from './tokenAppearance.ts'

type Send = (command: Record<string, unknown>) => Promise<boolean>

export function DamageTypeSelect({ value, change }: { value?: DamageKind; change?: (kind: DamageKind) => void }) {
  return <select name="damageKind" aria-label="ประเภทความเสียหาย" value={value} defaultValue={value === undefined ? 'untyped' : undefined}
    onChange={event => change?.(event.target.value as DamageKind)}>
    {Object.entries(damageKinds).map(([kind, [label]]) => <option key={kind} value={kind}>{label}</option>)}
  </select>
}

export function TurnRail({ scene, room, focus }: { scene: Scene; room: Snapshot; focus: (id: string) => void }) {
  const current = useRef<HTMLButtonElement>(null)
  const fight = scene.combat!
  useEffect(() => { current.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [fight.turn, fight.round])
  return <aside className="turn-rail" aria-labelledby="turn-initiative-title">
    <header className="rail-header"><h2 id="turn-initiative-title">Turn Initiative</h2><p>รอบ {fight.round}</p></header>
    <ol>{fight.order.map(({ actorId, initiative }, index) => {
      const actor = room.publicActors.find(item => item.id === actorId)
      const active = index === fight.turn
      if (!actor) return null
      const tokenIndex = scene.tokens.findIndex(token => token.actorId === actorId)
      return <li key={actorId}><button ref={active ? current : undefined} aria-current={active ? 'step' : undefined}
        className={actor.hp === 0 ? 'turn-down' : undefined} disabled={tokenIndex < 0} onClick={() => focus(actorId)}
        style={{ '--token-color': tokenColor(tokenIndex) } as CSSProperties}
        aria-label={tokenIndex < 0 ? actor.name + ' · ไม่มี Token ในฉาก' : 'ไปที่ Token ' + actor.name}
        title={actor.name + ' · Initiative ' + initiative}>
        <span className="rail-portrait" aria-hidden="true">{actor.portrait ? <img src={actor.portrait} alt="" /> : tokenInitials(actor.name)}</span>
        <span className="rail-caption"><span className="rail-name">{actor.name}</span>{active && <small>กำลังเล่น</small>}</span>
        <b className="rail-score">{initiative}</b>
      </button></li>
    })}</ol>
  </aside>
}

export function AreaAttack({ room, scene, preview, shape, choose, clear, send }: {
  room: Snapshot; scene: Scene; preview?: Area; shape?: AreaKind; choose: (shape: AreaKind) => void
  clear: () => void; send: Send
}) {
  return <section className="combat-block area-controls" aria-label="โจมตีแบบ AoE">
    <h3>โจมตีแบบ AoE</h3>
    <div className="area-shapes">
      {(Object.entries(areaLabels) as [AreaKind, string][]).map(([kind, label]) => <button key={kind}
        aria-pressed={shape === kind || preview?.kind === kind} onClick={() => choose(kind)}>{label}</button>)}
    </div>
    {(shape || preview) && <button className="clear-area" onClick={clear}>ยกเลิก AoE</button>}
    {shape && <p className="muted">ลากบนกระดานเพื่อกำหนดพื้นที่</p>}
    {preview && <AreaResult key={JSON.stringify(preview)} area={preview} room={room} scene={scene} send={send} clear={clear} />}
  </section>
}

function AreaResult({ area, room, scene, send, clear }: { area: Area; room: Snapshot; scene: Scene; send: Send; clear: () => void }) {
  const [choices, setChoices] = useState<Record<string, string>>({})
  const outline = areaOutline(area)
  const width = Math.abs(area.to.x - area.from.x) * 5
  const height = Math.abs(area.to.y - area.from.y) * 5
  const reach = Math.round(Math.hypot(width, height) * 10) / 10
  const targets = scene.tokens.flatMap(token => {
    const actor = room.actors.find(item => item.id === token.actorId)
    if (!actor || actor.life === 'dead') return []
    const half = sizes[actor.size] / 2
    return areaContains(outline, { x: token.x + half, y: token.y + half }) ? [actor] : []
  })
  return <form className="combat-result" onSubmit={async event => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (await send({ type: 'areaDamage', area, formula: form.get('formula'), damageKind: form.get('damageKind'),
      targets: targets.filter(actor => choices[actor.id] !== 'none').map(actor => ({ actorId: actor.id, effect: choices[actor.id] ?? 'full' })) })) clear()
  }}>
    <strong>{areaLabels[area.kind]} · {targets.length} เป้าหมาย</strong>
    <small>{area.kind === 'rectangle' ? width + ' × ' + height + ' ฟุต'
      : (area.kind === 'circle' ? 'รัศมี ' : 'ระยะ ') + reach + ' ฟุต' + (area.kind === 'line' ? ' · กว้าง 5 ฟุต' : '')}</small>
    <div className="combat-options"><label>สูตรความเสียหาย<input name="formula" required defaultValue="2d6" /></label>
      <label>ประเภท<DamageTypeSelect /></label></div>
    {targets.map(actor => <label className="area-target" key={actor.id}>{actor.name}
      <select aria-label={'ผล AoE ต่อ ' + actor.name} value={choices[actor.id] ?? 'full'} onChange={event => setChoices({ ...choices, [actor.id]: event.target.value })}>
        <option value="full">เต็ม</option><option value="half">ครึ่งหนึ่ง</option><option value="none">ข้าม</option>
      </select></label>)}
    <button className="primary" disabled={!targets.some(actor => choices[actor.id] !== 'none')}>ทอยและใช้ความเสียหาย AoE</button>
  </form>
}
