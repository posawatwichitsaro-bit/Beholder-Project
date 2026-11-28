import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Eye, EyeOff, Flag, MapPin, Presentation, Trash2, Upload } from 'lucide-react'
import type { Snapshot } from '../../../shared/model.ts'
import { canEditPin, pinKinds, worldLimits } from '../../../shared/worldMaps.ts'
import type { PinKind, WorldMap, WorldPin } from '../../../shared/worldMaps.ts'
import { EmptyState } from '../../ui/index.ts'
import { api } from '../../lib/api.ts'
import { refreshRoom } from '../../state/connection.ts'
import { roomPath, useRoomStore } from '../../state/roomStore.ts'
import { sendCommand } from '../../state/useCommand.ts'
import type { Send } from '../../state/useCommand.ts'
import './world.css'

/**
 * World maps (0.16): overview pictures with pins. The DM keeps a map and its
 * own pins hidden until the party knows them; players pin shared maps freely
 * and anyone moves the party marker.
 */
export const worldImageUrl = (roomId: string, map: WorldMap) => roomPath(roomId) + '/world/' + map.id + '/image?v=' + map.image!.id

const pinIcons: Record<PinKind, string> = { city: '🏰', town: '🏘️', dungeon: '💀', wild: '🌲', water: '🌊', poi: '⭐', danger: '⚠️', note: '📜' }

async function uploadPicture(roomId: string, mapId: string, file: File) {
  try {
    await api(roomPath(roomId) + '/world/' + mapId + '/image', { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
    await refreshRoom(roomId)
  } catch (error) { useRoomStore.getState().setError((error as Error).message) }
}

export function WorldMapPanel({ room, send, open }: { room: Snapshot; send: Send; open: (mapId: string) => void }) {
  const dm = room.me.role === 'dm'
  const maps = room.worldMaps ?? []
  const [name, setName] = useState('')
  const [file, setFile] = useState<File>()
  const [busy, setBusy] = useState(false)
  async function create() {
    setBusy(true)
    let mapId: string | undefined
    const ok = await sendCommand({ type: 'worldMap', name: name.trim() }, undefined, receipt => { if (typeof receipt.mapId === 'string') mapId = receipt.mapId })
    if (ok && mapId && file) await uploadPicture(room.id, mapId, file)
    setBusy(false)
    if (ok) { setName(''); setFile(undefined) }
  }
  return <div className="world-maps">
    <div className="section-head"><h2>แผนที่โลก</h2></div>
    {!maps.length && <EmptyState title="ยังไม่มีแผนที่โลก"
      hint={dm ? 'ใส่ภาพแผนที่ภูมิภาค เมือง หรือดันเจียน แล้วปักหมุดสถานที่ แผ่นใหม่จะซ่อนจากผู้เล่นจนกว่าจะแชร์' : 'แผนที่ที่ DM แชร์จะอยู่ที่นี่'} />}
    <ul className="world-list">{maps.map(map => <li key={map.id} className={room.presentingMap?.mapId === map.id ? 'presenting' : ''}>
      <button className="world-open" onClick={() => open(map.id)} aria-label={'เปิด ' + map.name}>
        {map.image ? <img src={worldImageUrl(room.id, map)} alt="" /> : <span className="world-blank"><MapPin size={18} aria-hidden="true" /></span>}
        <span><b>{map.name}</b><small>หมุด {map.pins.length}{dm && (map.shared ? ' · แชร์แล้ว' : ' · ซ่อนจากผู้เล่น')}</small></span>
      </button>
      {dm && <span className="world-actions">
        <label className="button-like" title="เปลี่ยนภาพแผนที่"><Upload size={14} aria-hidden="true" /> ภาพ
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label={'ภาพของ ' + map.name}
            onChange={event => { const picked = event.target.files?.[0]; if (picked) void uploadPicture(room.id, map.id, picked) }} /></label>
        <button aria-pressed={Boolean(map.shared)} onClick={() => void send({ type: 'worldMap', mapId: map.id, shared: !map.shared })}>
          {map.shared ? <><EyeOff size={14} aria-hidden="true" /> เลิกแชร์</> : <><Eye size={14} aria-hidden="true" /> แชร์ให้ผู้เล่น</>}</button>
        {room.presentingMap?.mapId === map.id
          ? <button className="primary" onClick={() => void send({ type: 'presentMap', mapId: null })}>หยุดนำเสนอ</button>
          : <button disabled={!map.image} aria-label={'นำเสนอ ' + map.name} title="เปิดเต็มจอให้ทุกคน (แชร์ให้อัตโนมัติ)"
            onClick={() => void send({ type: 'presentMap', mapId: map.id })}><Presentation size={14} aria-hidden="true" /> นำเสนอ</button>}
        <button aria-label={'ลบ ' + map.name} onClick={() => void send({ type: 'worldMap', mapId: map.id, remove: true })}><Trash2 size={14} aria-hidden="true" /></button>
      </span>}
    </li>)}</ul>
    {dm && <form className="world-new" onSubmit={event => { event.preventDefault(); if (name.trim() && !busy) void create() }}>
      <h3>แผนที่ใหม่</h3>
      <label>ชื่อ<input maxLength={worldLimits.name} value={name} onChange={event => setName(event.target.value)} placeholder="เช่น Sword Coast" /></label>
      <label>ภาพแผนที่ (PNG, JPEG, WebP)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setFile(event.target.files?.[0])} /></label>
      <button className="primary" disabled={!name.trim() || busy}>+ แผนที่</button>
    </form>}
  </div>
}

type Mode = 'look' | 'pin' | 'party'
type Draft = { x: number; y: number }

/** The map full screen: drag to pan, wheel or buttons to zoom, click pins for details. */
export function WorldMapViewer({ room, map, send, close, presenting = false }: {
  room: Snapshot; map: WorldMap; send: Send; close: () => void; presenting?: boolean
}) {
  const dm = room.me.role === 'dm'
  const frame = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
  const [size, setSize] = useState<{ width: number; height: number }>()
  const [mode, setMode] = useState<Mode>('look')
  const [openPin, setOpenPin] = useState<string>()
  const [draft, setDraft] = useState<Draft>()
  const drag = useRef<{ from: { x: number; y: number }; start: { x: number; y: number }; moved: boolean }>(undefined)
  const pin = map.pins.find(item => item.id === openPin)

  // Fit the picture once it loads.
  function fit(width: number, height: number) {
    const box = frame.current?.getBoundingClientRect()
    if (!box) return
    const zoom = Math.min(box.width / width, box.height / height)
    setSize({ width, height })
    setView({ zoom, x: (box.width - width * zoom) / 2, y: (box.height - height * zoom) / 2 })
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { if (openPin || draft) { setOpenPin(undefined); setDraft(undefined) } else close() } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [openPin, draft, close])
  function zoomAt(factor: number, cx?: number, cy?: number) {
    const box = frame.current!.getBoundingClientRect()
    const px = cx ?? box.width / 2, py = cy ?? box.height / 2
    setView(current => {
      const zoom = Math.min(8, Math.max(.05, current.zoom * factor))
      const scale = zoom / current.zoom
      return { zoom, x: px - (px - current.x) * scale, y: py - (py - current.y) * scale }
    })
  }
  /** The spot under the pointer as a fraction of the picture, or undefined outside it. */
  function spot(event: { clientX: number; clientY: number }) {
    if (!size) return undefined
    const box = frame.current!.getBoundingClientRect()
    const x = (event.clientX - box.left - view.x) / view.zoom / size.width
    const y = (event.clientY - box.top - view.y) / view.zoom / size.height
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : undefined
  }
  function down(event: ReactPointerEvent) {
    if ((event.target as HTMLElement).closest('.world-pin, .world-party')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { from: { x: event.clientX, y: event.clientY }, start: { x: view.x, y: view.y }, moved: false }
  }
  function move(event: ReactPointerEvent) {
    const current = drag.current
    if (!current) return
    const dx = event.clientX - current.from.x, dy = event.clientY - current.from.y
    if (Math.abs(dx) + Math.abs(dy) > 4) current.moved = true
    if (current.moved) setView(value => ({ ...value, x: current.start.x + dx, y: current.start.y + dy }))
  }
  function up(event: ReactPointerEvent) {
    const current = drag.current
    drag.current = undefined
    if (!current || current.moved) return
    const at = spot(event)
    if (!at) return
    if (mode === 'pin') { setDraft(at); setOpenPin(undefined) }
    else if (mode === 'party') { void send({ type: 'partyMarker', mapId: map.id, x: at.x, y: at.y }); setMode('look') }
    else setOpenPin(undefined)
  }

  const title = (presenting ? 'DM กำลังนำเสนอ · ' : 'แผนที่โลก · ') + map.name
  return <div className="world-viewer" role="dialog" aria-modal="true" aria-label={title}>
    <header>
      <b>{title}</b>
      <span className="world-tools">
        {map.image && <>
          <button aria-pressed={mode === 'pin'} onClick={() => { setMode(mode === 'pin' ? 'look' : 'pin'); setDraft(undefined) }}><MapPin size={15} aria-hidden="true" /> ปักหมุด</button>
          <button aria-pressed={mode === 'party'} onClick={() => setMode(mode === 'party' ? 'look' : 'party')}><Flag size={15} aria-hidden="true" /> ย้ายปาร์ตี้</button>
          {map.party && <button onClick={() => void send({ type: 'partyMarker', mapId: map.id, x: null })}>เอาหมุดปาร์ตี้ออก</button>}
          <button aria-label="ซูมเข้า" onClick={() => zoomAt(1.25)}>+</button>
          <button aria-label="ซูมออก" onClick={() => zoomAt(.8)}>−</button>
          <button onClick={() => size && fit(size.width, size.height)}>พอดีจอ</button>
        </>}
        <button className="primary" onClick={close}>ปิด</button>
      </span>
    </header>
    {mode !== 'look' && <p className="world-hint" role="status">{mode === 'pin' ? 'คลิกบนแผนที่เพื่อปักหมุด' : 'คลิกจุดที่ปาร์ตี้อยู่'}</p>}
    <div ref={frame} className={'world-frame mode-' + mode} onPointerDown={down} onPointerMove={move} onPointerUp={up}
      onWheel={event => { const box = frame.current!.getBoundingClientRect(); zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX - box.left, event.clientY - box.top) }}>
      {map.image ? <div className="world-layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, width: size?.width, height: size?.height }}>
        <img src={worldImageUrl(room.id, map)} alt={map.name} draggable={false} onLoad={event => fit(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />
        {size && map.pins.map(item => <button key={item.id} className={'world-pin' + (item.hidden ? ' hidden-pin' : '') + (item.id === openPin ? ' open' : '')}
          style={{ left: item.x * size.width, top: item.y * size.height, transform: `translate(-50%, -100%) scale(${1 / view.zoom})` }}
          aria-label={'หมุด ' + item.name + (item.hidden ? ' (ซ่อนจากผู้เล่น)' : '')} onClick={() => { setOpenPin(item.id); setDraft(undefined) }}>
          <span aria-hidden="true">{pinIcons[item.kind]}</span><small>{item.name}</small>
        </button>)}
        {size && map.party && <span className="world-party" role="img" aria-label="ปาร์ตี้อยู่ที่นี่"
          style={{ left: map.party.x * size.width, top: map.party.y * size.height, transform: `translate(-50%, -50%) scale(${1 / view.zoom})` }}>⚑ ปาร์ตี้</span>}
      </div> : <EmptyState title="แผนที่นี้ยังไม่มีภาพ" hint={dm ? 'ใส่ภาพจากปุ่ม "ภาพ" ในแผงแผนที่โลก' : undefined} />}
    </div>
    {(pin || draft) && <aside className="world-card">
      {draft ? <PinForm room={room} map={map} at={draft} send={send} done={() => { setDraft(undefined); setMode('look') }} />
        : pin && <PinDetails room={room} map={map} pin={pin} send={send} close={() => setOpenPin(undefined)} />}
    </aside>}
  </div>
}

function PinForm({ room, map, pin, at, send, done }: { room: Snapshot; map: WorldMap; pin?: WorldPin; at?: Draft; send: Send; done: () => void }) {
  const dm = room.me.role === 'dm'
  const [name, setName] = useState(pin?.name ?? '')
  const [kind, setKind] = useState<PinKind>(pin?.kind ?? (dm ? 'town' : 'note'))
  const [note, setNote] = useState(pin?.note ?? '')
  const [sceneId, setSceneId] = useState(pin?.sceneId ?? '')
  const [hidden, setHidden] = useState(pin ? Boolean(pin.hidden) : dm)
  return <form className="world-pin-form" onSubmit={async event => {
    event.preventDefault()
    if (!name.trim()) return
    const ok = await send({ type: 'pin', mapId: map.id, ...(pin ? { pinId: pin.id } : { x: at!.x, y: at!.y }), name: name.trim(), kind, note: note.trim(),
      ...(dm ? { sceneId: sceneId || null, hidden } : {}) })
    if (ok) done()
  }}>
    <h3>{pin ? 'แก้หมุด' : 'หมุดใหม่'}</h3>
    <label>ชื่อ<input required maxLength={worldLimits.name} value={name} onChange={event => setName(event.target.value)} autoFocus /></label>
    <label>ชนิด<select value={kind} onChange={event => setKind(event.target.value as PinKind)}>
      {(Object.keys(pinKinds) as PinKind[]).map(key => <option key={key} value={key}>{pinIcons[key]} {pinKinds[key]}</option>)}
    </select></label>
    <label>โน้ต<textarea rows={3} maxLength={worldLimits.note} value={note} onChange={event => setNote(event.target.value)} /></label>
    {dm && <>
      <label>ผูกกับฉาก<select value={sceneId} onChange={event => setSceneId(event.target.value)}>
        <option value="">ไม่ผูก</option>{room.scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.name}</option>)}
      </select></label>
      <label className="inline"><input type="checkbox" checked={hidden} onChange={event => setHidden(event.target.checked)} />ซ่อนจากผู้เล่น</label>
    </>}
    <div className="inline"><button className="primary">{pin ? 'บันทึก' : 'ปักหมุด'}</button><button type="button" onClick={done}>ยกเลิก</button></div>
  </form>
}

function PinDetails({ room, map, pin, send, close }: { room: Snapshot; map: WorldMap; pin: WorldPin; send: Send; close: () => void }) {
  const dm = room.me.role === 'dm'
  const [editing, setEditing] = useState(false)
  if (editing) return <PinForm room={room} map={map} pin={pin} send={send} done={() => setEditing(false)} />
  const scene = room.scenes.find(item => item.id === pin.sceneId)
  const owner = room.members.find(member => member.id === pin.ownerId)
  return <div className="world-pin-details">
    <header><h3>{pinIcons[pin.kind]} {pin.name}</h3><button aria-label="ปิด" onClick={close}>×</button></header>
    <small>{pinKinds[pin.kind]}{owner && owner.role !== 'dm' ? ' · ปักโดย ' + owner.name : ''}{pin.hidden ? ' · ซ่อนจากผู้เล่น' : ''}</small>
    {pin.note && <p className="world-note">{pin.note}</p>}
    {dm && scene && <button className="primary" disabled={room.activeSceneId === scene.id}
      onClick={() => void send({ type: 'activate', sceneId: scene.id })}>{room.activeSceneId === scene.id ? 'กำลังเล่นฉาก ' + scene.name : 'ไปฉาก ' + scene.name}</button>}
    {dm && <button onClick={() => void send({ type: 'pin', mapId: map.id, pinId: pin.id, hidden: !pin.hidden })}>{pin.hidden ? 'เปิดเผยให้ผู้เล่น' : 'ซ่อนจากผู้เล่น'}</button>}
    {canEditPin(pin, room.me) && <div className="inline">
      <button onClick={() => setEditing(true)}>แก้หมุด</button>
      <button onClick={() => void send({ type: 'pin', mapId: map.id, pinId: pin.id, remove: true }).then(ok => { if (ok) close() })}>ลบหมุด</button>
    </div>}
  </div>
}

/** For players: the DM's presented map opens full screen until they close it. */
export function WorldMapPresenter({ room, send }: { room: Snapshot; send: Send }) {
  const [closedAt, setClosedAt] = useState<number>()
  const presenting = room.presentingMap
  const map = presenting && closedAt !== presenting.at ? room.worldMaps?.find(item => item.id === presenting.mapId) : undefined
  if (!map || room.me.role === 'dm') return null
  return <WorldMapViewer room={room} map={map} send={send} presenting close={() => setClosedAt(presenting!.at)} />
}
