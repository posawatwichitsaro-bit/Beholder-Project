import { useState } from 'react'
import { objectLabels } from '../shared/model.ts'
import type { Actor, ObjectDefinition, ObjectKind, SceneObject } from '../shared/model.ts'
import { PictureInput } from './PictureInput.tsx'
import { ItemName } from './Inventory.tsx'

type Point = { x: number; y: number }
type Send = (command: Record<string, unknown>) => Promise<boolean>

export function ObjectEditor({ initial, point, save, close, error }: {
  initial?: ObjectDefinition; point?: Point; save: (value: ObjectDefinition, position?: Point) => Promise<boolean>; close: () => void; error?: string
}) {
  const [kind, setKind] = useState<ObjectKind>(initial?.kind ?? 'prop')
  const [image, setImage] = useState(initial?.image)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const container = initial?.kind === 'container' ? initial : undefined
  const structure = initial?.kind === 'structure' ? initial : undefined
  const [locked, setLocked] = useState(container?.lockDc !== undefined)
  const title = point ? 'นำเข้า Object' : initial ? 'รายละเอียด Object ในคลัง' : 'เพิ่ม Object เข้าคลัง'
  return <div className="scrim"><form className="dialog compact" role="dialog" aria-label={title} onSubmit={async event => {
    event.preventDefault()
    if (loading || saving) return
    const form = new FormData(event.currentTarget)
    const value = (name: string) => Number(form.get(name))
    const fields = { name: String(form.get('name')), description: String(form.get('description')), image,
      width: value('width'), height: value('height') }
    let definition: ObjectDefinition
    if (kind === 'container') {
      const originalItems = [...(container?.items ?? [])]
      const names = String(form.get('items')).split('\n').map(item => item.trim()).filter(Boolean)
      const items = names.map(name => {
        const index = originalItems.findIndex(item => item.name === name)
        return index < 0 ? { name, description: '' } : originalItems.splice(index, 1)[0]
      })
      definition = { ...fields, kind, items, lockDc: locked ? value('lockDc') : undefined }
    } else if (kind === 'structure') {
      definition = { ...fields, kind, hp: value('hp'), ac: value('ac'), cover: value('cover') as 0 | 2 | 5 | 99 }
    } else definition = { ...fields, kind }
    setSaving(true)
    try {
      if (await save(definition, point && { x: value('x'), y: value('y') })) close()
    } finally { setSaving(false) }
  }}>
    <header><h2>{title}</h2><button type="button" onClick={close} aria-label="ปิด">×</button></header>
    <label>ประเภท<select value={kind} onChange={event => setKind(event.target.value as ObjectKind)}>
      {Object.entries(objectLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
    </select></label>
    <label>ชื่อ Object<input name="name" required maxLength={120} defaultValue={initial?.name} /></label>
    <label>รายละเอียด<textarea name="description" maxLength={2000} rows={2} defaultValue={initial?.description} /></label>
    <PictureInput label="รูป Object" value={image} change={setImage} pending={setLoading} />
    <div className="form-grid">
      {point && <><label>ช่อง X<input required name="x" type="number" step=".5" min={-1000} max={1000} defaultValue={point.x} /></label>
        <label>ช่อง Y<input required name="y" type="number" step=".5" min={-1000} max={1000} defaultValue={point.y} /></label></>}
      <label>กว้าง (ช่อง)<input required name="width" type="number" step=".5" min={.5} max={50} defaultValue={initial?.width ?? 1} /></label>
      <label>สูง (ช่อง)<input required name="height" type="number" step=".5" min={.5} max={50} defaultValue={initial?.height ?? 1} /></label>
    </div>
    {kind === 'container' && <>
      <label>ของเริ่มต้นในกล่อง (บรรทัดละหนึ่งชิ้น)<textarea name="items" rows={3} defaultValue={container?.items.map(item => item.name).join('\n')} /></label>
      <label className="inline"><input type="checkbox" checked={locked} onChange={event => setLocked(event.target.checked)} />ล็อกกล่อง</label>
      {locked && <label>DC สะเดาะล็อก<input type="number" name="lockDc" min={1} max={30} defaultValue={container?.lockDc ?? 15} required /></label>}
    </>}
    {kind === 'structure' && <div className="form-grid">
      <label>HP<input name="hp" type="number" min={1} max={9999} defaultValue={structure?.hp ?? 12} required /></label>
      <label>AC<input name="ac" type="number" min={1} max={99} defaultValue={structure?.ac ?? 12} required /></label>
      <label>ที่กำบัง<select name="cover" defaultValue={structure?.cover ?? 2}><option value="0">ไม่มี</option><option value="2">ครึ่งหนึ่ง (+2)</option>
        <option value="5">สามในสี่ (+5)</option><option value="99">เต็ม</option></select></label>
    </div>}
    {error && <p className="feedback" role="alert">{error}</p>}
    <footer><button type="button" onClick={close}>ยกเลิก</button><button className="primary" disabled={loading || saving}>{point ? 'วาง Object' : 'บันทึก Object'}</button></footer>
  </form></div>
}

export function ObjectActions({ item, actors, selected, dm, send, close, copy }: {
  item: SceneObject; actors: Actor[]; selected: string; dm: boolean; send: Send; close: () => void; copy?: () => void
}) {
  const [chosen, setChosen] = useState(selected)
  const [amount, setAmount] = useState(1)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const actor = actors.find(actor => actor.id === chosen) ?? actors[0]
  const lock = item.kind === 'container' ? item.lock : undefined
  const hasTools = actor?.inventory?.some(entry => entry.tool === 'thievesTools')
  const tried = actor && lock?.tried.includes(actor.id)
  const perform = (type: string, values: Record<string, unknown> = {}) =>
    send({ type, objectId: item.id, actorId: actor?.id, ...values })
  return <div className="scrim"><section className="dialog compact" role="dialog" aria-label={item.name}>
    <header><h2>{item.name}</h2><button onClick={close} aria-label="ปิด">×</button></header>
    <small>{objectLabels[item.kind]}</small>
    {item.image && <img className="object-portrait" src={item.image} alt="" />}
    {item.description && <p>{item.description}</p>}
    {item.kind !== 'prop' && actors.length > 0 && <label>ตัวละครที่โต้ตอบ<select value={actor?.id ?? ''} onChange={event => setChosen(event.target.value)}>
      {actors.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}
    </select></label>}
    {item.kind === 'item' && <button className="primary" disabled={!actor} onClick={() => void perform('takeItem')}>เก็บเข้า Inventory</button>}
    {item.kind === 'container' && <>
      {lock?.locked ? <div className="lock-state">
        <strong>ล็อกอยู่ · DC {lock.dc}</strong>
        {actor && <button className="primary" disabled={!hasTools || tried} onClick={() => void perform('pickLock')}>ทอยสะเดาะล็อก</button>}
        {actor && (!hasTools || tried) && <small>{!hasTools ? 'ต้องมี Thieves’ Tools ใน Inventory ของตัวละคร' : 'ตัวละครนี้ลองสะเดาะล็อกไปแล้ว'}</small>}
        {dm && <button onClick={() => void perform('openObject', { actorId: undefined })}>ปลดล็อกและเปิดทันที</button>}
      </div> : <button disabled={!actor && !dm} onClick={() => void perform('openObject', dm ? { actorId: undefined } : {})}>{item.open ? 'ปิดกล่อง' : 'เปิดกล่อง'}</button>}
      {lock?.last && <p role="status">{lock.last.passed ? 'สะเดาะสำเร็จ' : 'สะเดาะไม่สำเร็จ'} · ผลทอย {lock.last.total}</p>}
      {dm && <form className="object-position" onSubmit={event => {
        event.preventDefault()
        void perform('setLock', { dc: Number(new FormData(event.currentTarget).get('dc')) })
      }}>
        <label>DC สะเดาะล็อก<input key={lock?.dc} name="dc" type="number" min={1} max={30} defaultValue={lock?.dc ?? 15} required /></label>
        <button>{lock?.locked ? 'ตั้งล็อกใหม่' : 'ล็อกกล่อง'}</button>
      </form>}
      {item.open && <>
        <h3>ของในกล่อง</h3>
        {item.items.length === 0 && <p className="muted">กล่องว่าง</p>}
        {item.items.map(loot => <div className="actor-item" key={loot.id}><ItemName item={loot} />
          <button disabled={!actor} onClick={() => void perform('takeItem', { itemId: loot.id })}>หยิบ</button></div>)}
        {actor?.inventory?.length ? <><h3>ฝากจาก Inventory</h3>
          {actor.inventory.map(loot => <div className="actor-item" key={loot.id}><ItemName item={loot} />
            <button onClick={() => void perform('storeItem', { itemId: loot.id })}>ฝาก</button></div>)}</> : null}
      </>}
    </>}
    {item.kind === 'structure' && <>
      <p>HP {item.hp}/{item.maxHp} · AC {item.ac} · {item.hp === 0 ? 'ถูกทำลาย' : ({ 0: 'ไม่มีที่กำบัง', 2: 'กำบังครึ่งหนึ่ง', 5: 'กำบังสามในสี่', 99: 'กำบังเต็ม' })[item.cover]}</p>
      {item.hp > 0 && <button disabled={!actor} onClick={() => void perform('attackObject')}>ทอยโจมตีสิ่งก่อสร้าง</button>}
      {dm && item.hp > 0 && <div className="inline"><input aria-label="ความเสียหายต่อสิ่งก่อสร้าง" type="number" min={1} value={amount} onChange={event => setAmount(event.target.valueAsNumber)} />
        <button onClick={() => void perform('damageObject', { amount })}>หัก HP</button></div>}
    </>}
    {dm && <form className="object-position" onSubmit={event => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      void perform('moveObject', { x: Number(form.get('x')), y: Number(form.get('y')) })
    }}>
      <label>ช่อง X<input name="x" type="number" step=".5" defaultValue={item.x} required /></label>
      <label>ช่อง Y<input name="y" type="number" step=".5" defaultValue={item.y} required /></label>
      <button>ย้าย</button>
    </form>}
    {copy && <button onClick={copy}>คัดลอก Object เข้าคลังส่วนตัว</button>}
    {dm && (confirmRemove ? <div className="inline"><button onClick={() => void perform('removeObject')}>ยืนยันนำออก</button>
      <button onClick={() => setConfirmRemove(false)}>ยกเลิก</button></div> : <button onClick={() => setConfirmRemove(true)}>นำ Object ออกจากฉาก</button>)}
  </section></div>
}
