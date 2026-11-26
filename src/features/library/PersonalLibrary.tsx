import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { passwordMaxLength, passwordMinLength } from '../../../shared/auth.ts'
import type { TokenDragProps } from '../board/tokenDrag.ts'
import { blankSheet, objectLabels } from '../../../shared/model.ts'
import type { Library, ObjectDefinition, SavedObject, Sheet, Template } from '../../../shared/model.ts'
import { ApiError, api, commandId, json } from '../../lib/api.ts'
import { SheetEditor } from '../sheets/SheetEditor.tsx'
import { ObjectEditor } from '../objects/Objects.tsx'

const base = '/api/library'

export function PersonalLibrary({ roomName, dm, draft, clearDraft, importSheet, useAccount, section, selectSection,
  objectDraft, clearObjectDraft, placeObject, placeCharacter, dragCharacter, accountForm }: {
  roomName: string; dm: boolean; draft?: Sheet; clearDraft: () => void; importSheet: (sheet: Sheet) => Promise<boolean>; useAccount: boolean
  /** Sign-in form shown to guests, since the library belongs to an account. */
  accountForm?: ReactNode
  section: 'sheets' | 'objects'; selectSection: (section: 'sheets' | 'objects') => void
  objectDraft?: ObjectDefinition; clearObjectDraft: () => void; placeObject?: (value: ObjectDefinition) => void
  placeCharacter?: (sheet: Sheet) => void
  /** Drag props so a saved character can be dropped straight onto the board. */
  dragCharacter?: (sheet: Sheet) => TokenDragProps
}) {
  const [library, setLibrary] = useState<Library>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState<Template>()
  const [remove, setRemove] = useState<Template>()
  const [editingObject, setEditingObject] = useState<{ id: string; definition?: ObjectDefinition; copied?: boolean }>()
  const [removeObject, setRemoveObject] = useState<SavedObject>()
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let alive = true
    void api<Library>(base).then(data => { if (alive) setLibrary(data) }).catch(problem => {
      if (alive && !(problem instanceof ApiError && problem.status === 403)) setError(problem.message)
    }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  async function run(work: () => Promise<void>) {
    if (busy) return false
    setBusy(true)
    setError('')
    setMessage('')
    try { await work(); return true }
    catch (problem) {
      if (problem instanceof ApiError && problem.status === 403) {
        // Check the session separately so an authorization error never discards a valid login.
        try { await api<Library>(base) }
        catch (sessionError) {
          if (sessionError instanceof ApiError && sessionError.status === 403) setLibrary(undefined)
        }
      }
      setError((problem as Error).message)
      return false
    } finally { setBusy(false) }
  }
  function openSheet(sheet: Sheet) {
    setEditing({ id: commandId(), sheet })
  }
  function save(value: Sheet) {
    if (!editing) return
    const id = editing.id
    void run(async () => {
      const saved = await api<Template>(base + '/sheets/' + id, json(value, 'PUT'))
      setLibrary(current => current && { ...current, sheets: [...current.sheets.filter(item => item.id !== id), saved] })
      setEditing(undefined)
      clearDraft()
      setMessage('บันทึกชีตแล้ว')
    })
  }
  if (loading) return <p className="muted">กำลังเปิดคลัง…</p>
  return <section className="personal-library">
    {error && !editingObject && <p className="feedback" role="alert">{error}</p>}
    {message && <p role="status" className="feedback">{message}</p>}
    {!library ? useAccount ? <p className="muted">เปิดคลังไม่สำเร็จ ตรวจสอบการเข้าสู่ระบบในเมนูตั้งค่าบัญชี</p> : <div className="library-sign-in">
      {draft && <p>เข้าสู่ระบบเพื่อบันทึก <b>{draft.name}</b> ไว้ใช้ทุกโต๊ะ</p>}
      {objectDraft && <p>เข้าสู่ระบบเพื่อบันทึก <b>{objectDraft.name}</b> ไว้ใช้ทุกโต๊ะ</p>}
      <p className="muted">คลังส่วนตัวผูกกับบัญชี เข้าสู่ระบบหรือสร้างบัญชีแล้วใช้ชีตและ Object เดิมได้ทุกโต๊ะ ที่นั่งในโต๊ะนี้ยังอยู่เหมือนเดิม</p>
      {accountForm}
      {/* Libraries created before accounts existed: kept reachable, folded away. */}
      <details className="legacy-profile">
        <summary>มีโปรไฟล์คลังแบบเก่า (ก่อนมีระบบบัญชี)?</summary>
        <form className="profile-form" onSubmit={event => {
          event.preventDefault()
          const input = new FormData(event.currentTarget)
          void run(async () => {
            await api(base + '/session', json({ name: input.get('name'), password: input.get('password'), mode: 'login' }))
            setLibrary(await api<Library>(base))
          })
        }}>
          <label>ชื่อโปรไฟล์<input name="name" autoComplete="username" defaultValue={roomName.slice(0, 40)} required maxLength={40} /></label>
          <label>รหัสผ่านโปรไฟล์<input name="password" type="password" required minLength={passwordMinLength} maxLength={passwordMaxLength * 2} autoComplete="current-password" /></label>
          <button className="primary" disabled={busy}>เปิดคลังเดิม</button>
        </form>
      </details>
    </div> : <>
      <div className="section-head"><h2>{library.name}</h2>{!useAccount && <button disabled={busy} onClick={() => void run(async () => {
        await api(base + '/session', { method: 'DELETE' })
        setLibrary(undefined)
        setEditing(undefined)
        setRemove(undefined)
        setEditingObject(undefined)
        setRemoveObject(undefined)
      })}>ออกจากโปรไฟล์</button>}</div>
      <div className="inline library-tools" aria-label="ประเภทในคลัง">
        <button aria-pressed={section === 'sheets'} onClick={() => { setFilter(''); selectSection('sheets') }}>ตัวละครและมอนสเตอร์</button>
        <button aria-pressed={section === 'objects'} onClick={() => { setFilter(''); selectSection('objects') }}>Object</button>
      </div>
      {section === 'sheets' ? <>
      {draft && <div className="library-draft">
        <p>คัดลอก <b>{draft.name}</b> จากห้องมาที่คลัง</p>
        <div className="inline"><button className="primary" onClick={() => openSheet(draft)}>บันทึกเป็นชีตใหม่</button>
          <button onClick={clearDraft}>ยกเลิก</button></div>
      </div>}
      <div className="inline library-tools">
        <button onClick={() => openSheet(blankSheet())}>+ ตัวละคร</button>
        <button onClick={() => openSheet(blankSheet('monster'))}>+ มอนสเตอร์</button>
      </div>
      <label>ค้นหาชีต<input value={filter} onChange={event => setFilter(event.target.value)} /></label>
      {library.sheets.length === 0 && <p className="muted">ยังไม่มีชีตในคลัง</p>}
      {library.sheets.filter(item => item.sheet.name.toLowerCase().includes(filter.trim().toLowerCase())).map(item => <article className="library-item" key={item.id}>
        <h3>{item.sheet.name}</h3>
        <small>{item.sheet.kind === 'pc' ? 'ตัวละคร' : 'มอนสเตอร์สร้างเอง'} · AC {item.sheet.ac} · HP {item.sheet.maxHp}</small>
        <div className="inline">
          <button onClick={() => setEditing(item)}>เปิดชีต</button>
          {(dm || item.sheet.kind === 'pc') && <button disabled={busy} onClick={() => void run(async () => {
            if (await importSheet(item.sheet)) setMessage('คัดลอกชีตเข้าห้องแล้ว')
          })}>ใช้ในห้องนี้</button>}
          {placeCharacter && item.sheet.kind === 'pc' && <button className="primary" {...dragCharacter?.(item.sheet)} onClick={() => placeCharacter(item.sheet)}>วาง Token</button>}
          <button onClick={() => setRemove(item)}>ลบ</button>
        </div>
      </article>)}
      </> : <>
        {objectDraft && <div className="library-draft">
          <p>คัดลอก <b>{objectDraft.name}</b> จากฉากเข้าคลัง</p>
          <div className="inline">
            <button className="primary" onClick={() => setEditingObject({ id: commandId(), definition: objectDraft, copied: true })}>บันทึกเป็น Object ใหม่</button>
            <button onClick={clearObjectDraft}>ยกเลิก</button>
          </div>
        </div>}
        <div className="inline library-tools">
          <button onClick={() => setEditingObject({ id: commandId() })}>+ Object</button>
        </div>
        <label>ค้นหา Object<input value={filter} onChange={event => setFilter(event.target.value)} /></label>
        {library.objects.length === 0 && <p className="muted">ยังไม่มี Object ในคลัง</p>}
        {library.objects.filter(item => item.definition.name.toLowerCase().includes(filter.trim().toLowerCase())).map(item =>
          <article className="library-item" key={item.id}>
            <div className="library-object-name">
              {item.definition.image && <img src={item.definition.image} alt="" />}
              <div><h3>{item.definition.name}</h3><small>{objectLabels[item.definition.kind]} · {item.definition.width} × {item.definition.height} ช่อง</small></div>
            </div>
            <div className="inline">
              {placeObject && <button className="primary" disabled={busy} onClick={() => placeObject(item.definition)}>วางในฉาก</button>}
              <button onClick={() => setEditingObject(item)}>แก้ไข</button>
              <button onClick={() => setRemoveObject(item)}>ลบ</button>
            </div>
          </article>
        )}
      </>}
    </>}
    {editing && <SheetEditor key={editing.id} initial={editing.sheet} save={save} cancel={() => setEditing(undefined)} />}
    {remove && <div className="library-draft">
      <p>ลบ {remove.sheet.name} จากคลังส่วนตัว?</p>
      <div className="inline"><button disabled={busy} onClick={() => void run(async () => {
        await api(base + '/sheets/' + remove.id, { method: 'DELETE' })
        setLibrary(current => current && { ...current, sheets: current.sheets.filter(item => item.id !== remove.id) })
        setRemove(undefined)
      })}>ยืนยันลบ</button><button onClick={() => setRemove(undefined)}>ยกเลิก</button></div>
    </div>}
    {editingObject && <ObjectEditor key={editingObject.id} initial={editingObject.definition} close={() => { setEditingObject(undefined); setError('') }}
      error={error} save={definition => run(async () => {
        const id = editingObject.id
        const saved = await api<SavedObject>(base + '/objects/' + id, json(definition, 'PUT'))
        setLibrary(current => current && { ...current, objects: [...current.objects.filter(item => item.id !== id), saved] })
        if (editingObject.copied) clearObjectDraft()
        setMessage('บันทึก Object แล้ว')
      })} />}
    {removeObject && <div className="library-draft">
      <p>ลบ {removeObject.definition.name} จากคลังส่วนตัว?</p>
      <div className="inline"><button disabled={busy} onClick={() => void run(async () => {
        await api(base + '/objects/' + removeObject.id, { method: 'DELETE' })
        setLibrary(current => current && { ...current, objects: current.objects.filter(item => item.id !== removeObject.id) })
        setRemoveObject(undefined)
      })}>ยืนยันลบ Object</button><button onClick={() => setRemoveObject(undefined)}>ยกเลิก</button></div>
    </div>}
  </section>
}
