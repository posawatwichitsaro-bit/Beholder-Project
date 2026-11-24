import { useEffect, useState } from 'react'
import { blankSheet } from '../shared/model.ts'
import type { Library, Sheet, Template } from '../shared/model.ts'
import { ApiError, api, commandId, json } from './api.ts'
import { SheetEditor } from './SheetEditor.tsx'

const base = '/api/library'

export function PersonalLibrary({ roomName, dm, draft, clearDraft, importSheet }: {
  roomName: string; dm: boolean; draft?: Sheet; clearDraft: () => void; importSheet: (sheet: Sheet) => Promise<boolean>
}) {
  const [library, setLibrary] = useState<Library>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState<Template>()
  const [remove, setRemove] = useState<Template>()
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let alive = true
    void api<Library>(base).then(data => { if (alive) setLibrary(data) }).catch(problem => {
      if (alive && !(problem instanceof ApiError && problem.status === 403)) setError(problem.message)
    }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  async function run(work: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try { await work() }
    catch (problem) {
      if (problem instanceof ApiError && problem.status === 403) {
        // Check the session separately so an authorization error never discards a valid login.
        try { await api<Library>(base) }
        catch (sessionError) {
          if (sessionError instanceof ApiError && sessionError.status === 403) setLibrary(undefined)
        }
      }
      setError((problem as Error).message)
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
    {error && <p className="feedback" role="alert">{error}</p>}
    {message && <p role="status" className="feedback">{message}</p>}
    {!library ? <form className="profile-form" onSubmit={event => {
      event.preventDefault()
      const input = new FormData(event.currentTarget)
      const mode = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? 'login'
      void run(async () => {
        await api(base + '/session', json({ name: input.get('name'), password: input.get('password'), mode }))
        setLibrary(await api<Library>(base))
      })
    }}>
      {draft && <p>เข้าคลังเพื่อบันทึก <b>{draft.name}</b></p>}
      <p className="muted">ใช้โปรไฟล์เดียวกันในแต่ละห้องเพื่อเปิดชีตที่บันทึกไว้</p>
      <label>ชื่อโปรไฟล์<input name="name" autoComplete="username" defaultValue={roomName.slice(0, 40)} required maxLength={40} /></label>
      <label>รหัสผ่านโปรไฟล์<input name="password" type="password" required minLength={8} maxLength={128} autoComplete="current-password" /></label>
      <div className="inline"><button value="login" className="primary" disabled={busy}>เข้าคลัง</button><button value="register" disabled={busy}>สร้างโปรไฟล์</button></div>
    </form> : <>
      <div className="section-head"><h2>{library.name}</h2><button disabled={busy} onClick={() => void run(async () => {
        await api(base + '/session', { method: 'DELETE' })
        setLibrary(undefined)
        setEditing(undefined)
        setRemove(undefined)
      })}>ออกจากโปรไฟล์</button></div>
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
          <button onClick={() => setRemove(item)}>ลบ</button>
        </div>
      </article>)}
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
  </section>
}
