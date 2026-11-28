import { useEffect, useState } from 'react'
import { FileText, Pencil, Presentation, Trash2 } from 'lucide-react'
import type { Snapshot } from '../../../shared/model.ts'
import type { Handout } from '../../../shared/handouts.ts'
import { canvaEmbed, handoutLimits } from '../../../shared/handouts.ts'
import { Button, Dialog, EmptyState } from '../../ui/index.ts'
import { api } from '../../lib/api.ts'
import { refreshRoom } from '../../state/connection.ts'
import { roomPath, useRoomStore } from '../../state/roomStore.ts'
import { sendCommand } from '../../state/useCommand.ts'
import type { Send } from '../../state/useCommand.ts'
import './handouts.css'

/**
 * Handouts (0.14): the DM gives notes, pictures and Canva presentations to the
 * table or to some players. Each player sees only what they were given, can
 * reopen it here, and gets a card the first time a new one arrives.
 */
export const imageUrl = (roomId: string, handout: Handout) => roomPath(roomId) + '/handouts/' + handout.id + '/image?v=' + handout.image!.id

export function HandoutsPanel({ room, send, open }: { room: Snapshot; send: Send; open: (handout: Handout) => void }) {
  const dm = room.me.role === 'dm'
  const [editing, setEditing] = useState<Handout | 'new'>()
  const handouts = [...(room.handouts ?? [])].sort((a, b) => b.at - a.at)
  const players = room.members.filter(member => member.role === 'player')
  const audience = (handout: Handout) => handout.recipients === 'all' ? 'ทุกคน'
    : handout.recipients.map(id => players.find(member => member.id === id)?.name ?? '?').join(', ')
  return <div className="handouts">
    <div className="section-head"><h2>เอกสาร</h2>{dm && <button onClick={() => setEditing('new')}>+ เอกสาร</button>}</div>
    {!handouts.length && <EmptyState title="ยังไม่มีเอกสาร"
      hint={dm ? 'ส่งจดหมาย ภาพ หรืองานนำเสนอจาก Canva ให้ผู้เล่นทุกคนหรือบางคน' : 'เอกสาร ภาพ และงานนำเสนอที่ DM ส่งให้จะเก็บไว้ที่นี่'} />}
    <ul className="handout-list">{handouts.map(handout => <li key={handout.id} className={room.presenting?.handoutId === handout.id ? 'presenting' : ''}>
      <button className="handout-open" onClick={() => open(handout)} aria-label={'เปิด ' + handout.title}>
        <FileText size={16} aria-hidden="true" />
        <span><b>{handout.title}</b><small>{[handout.image && 'ภาพ', handout.canva && 'Canva', handout.text && 'ข้อความ'].filter(Boolean).join(' · ')}{dm && ' · ถึง ' + audience(handout)}</small></span>
      </button>
      {dm && <span className="handout-actions">
        {room.presenting?.handoutId === handout.id
          ? <button className="primary" onClick={() => void send({ type: 'present', handoutId: null })}>หยุดนำเสนอ</button>
          : <button title="เปิดเต็มจอให้ผู้รับทุกคน" aria-label={'นำเสนอ ' + handout.title} onClick={() => void send({ type: 'present', handoutId: handout.id })}><Presentation size={15} aria-hidden="true" /> นำเสนอ</button>}
        <button aria-label={'แก้ ' + handout.title} onClick={() => setEditing(handout)}><Pencil size={14} aria-hidden="true" /></button>
        <button aria-label={'ลบ ' + handout.title} onClick={() => void send({ type: 'handout', handoutId: handout.id, remove: true })}><Trash2 size={14} aria-hidden="true" /></button>
      </span>}
    </li>)}</ul>
    {editing && <HandoutForm room={room} handout={editing === 'new' ? undefined : editing} close={() => setEditing(undefined)} />}
  </div>
}

/** The DM's form: title, text, a Canva view link, a picture, and who gets it. */
function HandoutForm({ room, handout, close }: { room: Snapshot; handout?: Handout; close: () => void }) {
  const players = room.members.filter(member => member.role === 'player')
  const [title, setTitle] = useState(handout?.title ?? '')
  const [text, setText] = useState(handout?.text ?? '')
  const [canva, setCanva] = useState(handout?.canva?.replace('?embed', '') ?? '')
  const [file, setFile] = useState<File>()
  const [everyone, setEveryone] = useState(!handout || handout.recipients === 'all')
  const [chosen, setChosen] = useState<string[]>(handout && handout.recipients !== 'all' ? handout.recipients : [])
  const [busy, setBusy] = useState(false)
  const canvaProblem = canva.trim() ? ('error' in canvaEmbed(canva) ? (canvaEmbed(canva) as { error: string }).error : '') : ''
  const ready = title.trim() && !canvaProblem && (everyone || chosen.length) && !busy
  async function submit() {
    setBusy(true)
    let handoutId = handout?.id
    const ok = await sendCommand({
      type: 'handout', ...(handout ? { handoutId: handout.id } : {}), title: title.trim(), text: text.trim(), canva: canva.trim(),
      recipients: everyone ? 'all' : chosen
    }, undefined, receipt => { if (typeof receipt.handoutId === 'string') handoutId = receipt.handoutId })
    if (ok && file && handoutId) {
      try {
        await api(roomPath(room.id) + '/handouts/' + handoutId + '/image', { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
        await refreshRoom(room.id)
      } catch (error) { useRoomStore.getState().setError((error as Error).message) }
    }
    setBusy(false)
    if (ok) close()
  }
  return <Dialog title={handout ? 'แก้เอกสาร' : 'เอกสารใหม่'} onClose={close} footer={<>
    <Button onClick={close}>ยกเลิก</Button>
    <Button variant="primary" className="primary" disabled={!ready} pending={busy} onClick={() => void submit()}>{handout ? 'บันทึก' : 'ส่งเอกสาร'}</Button>
  </>}>
    <form className="handout-form" onSubmit={event => { event.preventDefault(); if (ready) void submit() }}>
      <label>หัวข้อ<input value={title} maxLength={handoutLimits.title} onChange={event => setTitle(event.target.value)} placeholder="เช่น จดหมายจากท่านเคานต์" required /></label>
      <label>ข้อความ<textarea value={text} rows={5} maxLength={handoutLimits.text} onChange={event => setText(event.target.value)} /></label>
      <label>ลิงก์ Canva (ไม่บังคับ)<input value={canva} onChange={event => setCanva(event.target.value)} inputMode="url"
        placeholder="https://www.canva.com/design/…/view" aria-invalid={Boolean(canvaProblem)} />
        <small className={canvaProblem ? 'field-error' : 'field-hint'}>{canvaProblem || 'ใน Canva กด แชร์ → คัดลอกลิงก์แบบ "ดูได้" (ทุกคนที่มีลิงก์)'}</small></label>
      <label>ภาพ (ไม่บังคับ){handout?.image && !file && <small className="field-hint"> · มีภาพอยู่แล้ว เลือกไฟล์ใหม่เพื่อแทน</small>}
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setFile(event.target.files?.[0])} /></label>
      <fieldset className="handout-recipients"><legend>ส่งให้</legend>
        <label><input type="radio" checked={everyone} onChange={() => setEveryone(true)} />ทุกคน</label>
        <label><input type="radio" checked={!everyone} onChange={() => setEveryone(false)} />เลือกผู้เล่น</label>
        {!everyone && <div className="handout-players">
          {!players.length && <small className="field-hint">ยังไม่มีผู้เล่นในห้อง</small>}
          {players.map(member => <label key={member.id}><input type="checkbox" checked={chosen.includes(member.id)}
            onChange={event => setChosen(event.target.checked ? [...chosen, member.id] : chosen.filter(id => id !== member.id))} />{member.name}</label>)}
        </div>}
      </fieldset>
    </form>
  </Dialog>
}

/** One handout opened: its text, picture and Canva presentation. `presenting` makes it full screen. */
export function HandoutViewer({ room, handout, presenting, close }: { room: Snapshot; handout: Handout; presenting?: boolean; close: () => void }) {
  const body = <div className={'handout-view' + (presenting ? ' handout-full' : '')}>
    {handout.canva && <div className="handout-canva"><iframe src={handout.canva} title={'Canva · ' + handout.title} loading="lazy" allow="fullscreen" allowFullScreen /></div>}
    {handout.image && <img className="handout-image" src={imageUrl(room.id, handout)} alt={handout.title} />}
    {handout.text && <p className="handout-text">{handout.text}</p>}
  </div>
  if (presenting) return <div className="handout-present" role="dialog" aria-modal="true" aria-label={'DM กำลังนำเสนอ · ' + handout.title}>
    <header><b>DM กำลังนำเสนอ · {handout.title}</b><button className="primary" onClick={close}>ปิด</button></header>
    {body}
  </div>
  return <Dialog title={handout.title} size="lg" onClose={close}>{body}</Dialog>
}

const seenKey = (roomId: string) => 'beholder-handouts-seen:' + roomId
function readSeen(roomId: string): string[] | undefined {
  try { const raw = localStorage.getItem(seenKey(roomId)); return raw ? JSON.parse(raw) : undefined } catch { return undefined }
}
function writeSeen(roomId: string, ids: string[]) {
  try { localStorage.setItem(seenKey(roomId), JSON.stringify(ids.slice(-400))) } catch { /* private window: the card may show again */ }
}

/**
 * For players: a card when a handout they have not seen arrives, and the DM's
 * presentation full screen. What was seen is remembered in this browser; on a
 * first visit everything already there counts as seen, so joining late is quiet.
 */
export function HandoutInbox({ room, open }: { room: Snapshot; open: (handout: Handout) => void }) {
  const dm = room.me.role === 'dm'
  const handouts = room.handouts ?? []
  const [seen, setSeen] = useState<string[]>(() => readSeen(room.id) ?? handouts.map(item => item.id))
  const [closedAt, setClosedAt] = useState<number>()
  useEffect(() => { if (!readSeen(room.id)) writeSeen(room.id, seen) }, [])
  const fresh = dm ? undefined : handouts.find(item => !seen.includes(item.id))
  const mark = (id: string) => { const next = [...seen, id]; setSeen(next); writeSeen(room.id, next) }
  const presented = room.presenting && closedAt !== room.presenting.at ? handouts.find(item => item.id === room.presenting!.handoutId) : undefined
  useEffect(() => { if (presented && !seen.includes(presented.id)) mark(presented.id) }, [presented?.id])
  return <>
    {presented && !dm && <HandoutViewer room={room} handout={presented} presenting close={() => setClosedAt(room.presenting!.at)} />}
    {fresh && !presented && <div className="handout-card" role="status">
      <FileText size={18} aria-hidden="true" />
      <span>DM ส่งเอกสาร: <b>{fresh.title}</b></span>
      <button className="primary" onClick={() => { mark(fresh.id); open(fresh) }}>เปิดอ่าน</button>
      <button onClick={() => mark(fresh.id)}>ไว้ทีหลัง</button>
    </div>}
  </>
}
