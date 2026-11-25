import { useState } from 'react'
import type { CSSProperties, DragEvent } from 'react'
import { Copy, Crosshair, Eye, GripVertical, Grid3x3, ImageUp, Plus, Trash2 } from 'lucide-react'
import type { Scene, Snapshot } from '../../../shared/model.ts'
import type { Command, Send } from '../../state/useCommand.ts'

const dragType = 'application/x-beholder-scene'

/**
 * Scenes as map cards. Players see only the scene that is open to them.
 * The DM sees every scene with a "players see this" or "preparing" badge,
 * drags cards to reorder (↑/↓ stay for keyboard use), opens a prepared scene
 * to the table from its card, and manages the selected scene below the list.
 */
export function ScenePanel({ room, scene, send, commandHere, switchView, addDemo, createScene, editGrid, calibrateGrid, copyScene, deleteScene, uploadMap, inviteLink, dmInviteLink, copyInvite }: {
  room: Snapshot; scene?: Scene; send: Send; commandHere: (command: Command) => Promise<boolean>
  switchView: (id: string) => void; addDemo: () => void; createScene: () => void; editGrid: (scene: Scene) => void; calibrateGrid: (scene: Scene) => void
  copyScene: (scene: Scene) => void; deleteScene: (scene: Scene) => void; uploadMap: (scene: Scene, file: File) => void
  inviteLink?: string; dmInviteLink?: string; copyInvite: () => void
}) {
  const dm = room.me.role === 'dm'
  const [dragging, setDragging] = useState<string>()
  const [over, setOver] = useState<string>()
  const mapUrl = (item: Scene) => item.map ? '/api/rooms/' + room.id + '/maps/' + item.map.id : undefined

  function drop(event: DragEvent, targetId: string) {
    const sourceId = event.dataTransfer.getData(dragType)
    setDragging(undefined)
    setOver(undefined)
    if (!sourceId || sourceId === targetId) return
    event.preventDefault()
    const ids = room.scenes.map(item => item.id).filter(id => id !== sourceId)
    ids.splice(ids.indexOf(targetId) + (room.scenes.findIndex(item => item.id === sourceId) < room.scenes.findIndex(item => item.id === targetId) ? 1 : 0), 0, sourceId)
    void send({ type: 'reorderScenes', sceneIds: ids })
  }

  return <div className="scene-panel">
    <div className="section-head"><h2>ฉาก</h2>{dm && <button aria-label="สร้างฉาก" onClick={createScene}><Plus size={16} aria-hidden="true" /></button>}</div>
    <ol className="scene-list scene-cards">
      {room.scenes.map((item, index) => {
        const live = room.activeSceneId === item.id
        const viewing = scene?.id === item.id
        const art = mapUrl(item)
        return <li key={item.id} className={'scene-row' + (dragging === item.id ? ' dragging' : '') + (over === item.id ? ' drop-target' : '')}
          draggable={dm} onDragStart={event => { event.dataTransfer.setData(dragType, item.id); event.dataTransfer.effectAllowed = 'move'; setDragging(item.id) }}
          onDragEnd={() => { setDragging(undefined); setOver(undefined) }}
          onDragOver={event => { if (dm && event.dataTransfer.types.includes(dragType)) { event.preventDefault(); setOver(item.id) } }}
          onDragLeave={() => setOver(current => current === item.id ? undefined : current)}
          onDrop={event => drop(event, item.id)}>
          {dm && <span className="scene-grip" aria-hidden="true"><GripVertical size={14} /></span>}
          <button className={'scene-item ' + (viewing ? 'selected' : '')} aria-current={viewing ? 'true' : undefined} onClick={() => switchView(item.id)}>
            <span className="scene-thumb" aria-hidden="true" style={art ? { '--_art': `url("${art}")` } as CSSProperties : undefined} data-empty={art ? undefined : 'true'} />
            <span className="scene-name">{item.name}</span>
            {live ? <small className="scene-badge live">เปิดอยู่</small> : dm && <small className="scene-badge">กำลังเตรียม</small>}
          </button>
          {dm && !live && <button className="scene-publish" aria-label={'เปิดฉาก ' + item.name + ' ให้ผู้เล่น'} title="เปิดให้ผู้เล่น"
            onClick={() => void send({ type: 'activate', sceneId: item.id })}><Eye size={15} aria-hidden="true" /></button>}
          {dm && <span className="scene-move">
            <button aria-label={'ย้ายฉาก ' + item.name + ' ขึ้น'} title="ย้ายขึ้น" disabled={index === 0}
              onClick={() => void send({ type: 'moveScene', sceneId: item.id, offset: -1 })}>↑</button>
            <button aria-label={'ย้ายฉาก ' + item.name + ' ลง'} title="ย้ายลง" disabled={index === room.scenes.length - 1}
              onClick={() => void send({ type: 'moveScene', sceneId: item.id, offset: 1 })}>↓</button>
          </span>}
        </li>
      })}
    </ol>
    {!room.scenes.length && <p className="muted">{dm ? 'ยังไม่มีฉาก · กด + หรือเพิ่ม Encounter ตัวอย่างด้านล่าง' : 'ยังไม่มีฉาก'}</p>}
    {dm && room.scenes.length > 1 && <p className="scene-hint">ลากการ์ดเพื่อเรียงลำดับ · กด <Eye size={12} aria-hidden="true" /> เพื่อเปิดฉากนั้นให้ผู้เล่น</p>}

    {dm && scene && <section className="scene-settings" aria-label={'ตั้งค่าฉาก ' + scene.name}>
      <h3>{scene.name}<small>{scene.cell}px ต่อช่อง · {scene.tokens.length} Token · {scene.objects?.length ?? 0} Object</small></h3>
      <div className="scene-actions">
        <label className="button file"><ImageUp size={15} aria-hidden="true" /> อัปโหลดแผนที่<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) uploadMap(scene, file)
        }} /></label>
        <button onClick={() => calibrateGrid(scene)} disabled={!scene.map} title={scene.map ? 'ลากกรอบทับช่องบนแผนที่' : 'อัปโหลดแผนที่ก่อน'}><Crosshair size={15} aria-hidden="true" /> ปรับ Grid บนภาพ</button>
        <button onClick={() => editGrid(scene)}><Grid3x3 size={15} aria-hidden="true" /> ตั้งค่า Grid</button>
        <button onClick={() => copyScene(scene)}><Copy size={15} aria-hidden="true" /> คัดลอกฉาก</button>
        <button className="danger" onClick={() => deleteScene(scene)}><Trash2 size={15} aria-hidden="true" /> ลบฉาก</button>
      </div>
      {room.scenes.some(item => item.id !== scene.id && item.map) && <select aria-label="ใช้ภาพจากฉากอื่น" value="" onChange={event => {
        if (event.target.value) void commandHere({ type: 'reuseMap', sourceId: event.target.value })
      }}><option value="">ใช้ภาพจากฉากอื่น</option>
        {room.scenes.filter(item => item.id !== scene.id && item.map).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>}
    </section>}
    {dm && <button className="demo-button" onClick={addDemo}>เพิ่ม Encounter ด่านร้างริมทาง</button>}

    {inviteLink && <details className="invite"><summary>เชิญผู้เล่น</summary><input aria-label="ลิงก์เชิญ" readOnly value={inviteLink} onFocus={event => event.target.select()} />
      <button onClick={copyInvite}>คัดลอก</button></details>}
    {dm && <details className="invite"><summary>เชิญ DM</summary>
      <button onClick={() => void send({ type: 'dmInvite' })}>{dmInviteLink ? 'ออกลิงก์ DM ใหม่' : 'สร้างลิงก์ DM'}</button>
      {dmInviteLink && <input aria-label="ลิงก์เชิญ DM" readOnly value={dmInviteLink} onFocus={event => event.currentTarget.select()} />}
    </details>}
    <p className="muted">{room.members.length} คน · {room.members.map(member => member.name).join(', ')}</p>
    <a className="home-link" href="/">กลับหน้าเปิดโต๊ะ</a>
  </div>
}
