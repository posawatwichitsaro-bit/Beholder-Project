import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { abilities, blankSheet } from '../shared/model.ts'
import type { Actor, Roll, Scene, Sheet, Snapshot, Template } from '../shared/model.ts'
import { Board } from './Board.tsx'
import { SheetEditor } from './SheetEditor.tsx'
import './style.css'

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}))
    throw new Error(problem.error ?? 'เชื่อมต่อไม่สำเร็จ')
  }
  return response.status === 204 ? undefined as T : response.json()
}
const post = (body: object): RequestInit => ({
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
})
const commandId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}

function Entry({ invite, enter, initialError }: { invite?: string; enter: (room: Snapshot) => void; initialError: string }) {
  const [error, setError] = useState(initialError)
  const [waiting, setWaiting] = useState(false)
  useEffect(() => setError(initialError), [initialError])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError('')
    setWaiting(true)
    try {
      enter(invite
        ? await api<Snapshot>('/api/join', post({ name: form.get('member'), invite }))
        : await api<Snapshot>('/api/rooms', post({ name: form.get('room'), member: form.get('member') })))
    } catch (error) { setError((error as Error).message) }
    finally { setWaiting(false) }
  }
  return <main className="entry">
    <div className="entry-mark" aria-hidden="true">◈</div>
    <h1>Beholder</h1>
    <form onSubmit={submit}>
      <h2>{invite ? 'เข้าร่วมโต๊ะ' : 'เปิดโต๊ะใหม่'}</h2>
      {!invite && <label>ชื่อห้อง<input name="room" required maxLength={120} placeholder="เช่น ประตูเมืองเหนือ" /></label>}
      <label>ชื่อที่ใช้บนโต๊ะ<input name="member" required maxLength={120} autoComplete="nickname" /></label>
      {error && <p role="alert">{error}</p>}
      <button className="primary" disabled={waiting}>{waiting ? 'กำลังเชื่อมต่อ…' : invite ? 'เข้าร่วม' : 'สร้างห้อง DM'}</button>
    </form>
  </main>
}

type Send = (command: Record<string, unknown>) => Promise<boolean>

function SceneForm({ scene, save, cancel }: { scene?: Scene; save: Send; cancel: () => void }) {
  return <div className="scrim"><form className="dialog compact" onSubmit={async event => {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    if (await save({ type: 'scene', sceneId: scene?.id, name: fields.get('name'), cell: Number(fields.get('cell')), originX: Number(fields.get('x')), originY: Number(fields.get('y')) })) cancel()
  }}>
    <header><h2>{scene ? 'ตั้งค่า Grid' : 'สร้างฉาก'}</h2><button type="button" onClick={cancel} aria-label="ปิด">×</button></header>
    <label>ชื่อฉาก<input required name="name" maxLength={120} defaultValue={scene?.name} /></label>
    <label>ขนาดช่อง (px)<input required name="cell" type="number" min={12} max={300} defaultValue={scene?.cell ?? 48} /></label>
    <div className="form-grid">
      <label>จุดกำเนิด X<input required name="x" type="number" defaultValue={scene?.originX ?? 0} /></label>
      <label>จุดกำเนิด Y<input required name="y" type="number" defaultValue={scene?.originY ?? 0} /></label>
    </div>
    <footer><button type="button" onClick={cancel}>ยกเลิก</button><button className="primary">บันทึกฉาก</button></footer>
  </form></div>
}

function ActorActions({ actor, scene, room, send }: { actor: Actor; scene?: Scene; room: Snapshot; send: Send }) {
  const [target, setTarget] = useState('')
  const [advantage, setAdvantage] = useState(false)
  const [disadvantage, setDisadvantage] = useState(false)
  const [proficient, setProficient] = useState(false)
  const [ability, setAbility] = useState('STR')
  const [cover, setCover] = useState(0)
  const [spellDamage, setSpellDamage] = useState('1d8')
  const [spellName, setSpellName] = useState('')
  const [half, setHalf] = useState(false)
  const [weapon, setWeapon] = useState('')
  const [healing, setHealing] = useState(1)
  const [slots, setSlots] = useState(actor.slots)
  const targets = room.publicActors.filter(item => item.id !== actor.id && scene?.tokens.some(token => token.actorId === item.id))
  const targetId = targets.some(item => item.id === target) ? target : targets[0]?.id
  function roll(rollType: string) {
    const weaponIndex = (rollType === 'attack' || rollType === 'damage') && weapon !== '' && actor.attacks?.[Number(weapon)] ? Number(weapon) : undefined
    void send({ type: 'sheetRoll', rollType, actorId: actor.id, sceneId: scene?.id, targetId, ability, advantage, disadvantage, proficient, cover, formula: spellDamage, weaponIndex })
  }
  return <div className="actor-actions">
    <div className="stat-row"><span><b>{actor.hp}/{actor.maxHp}</b> HP</span><span><b>{actor.ac}</b> AC</span><span><b>{actor.tempHp}</b> Temp</span></div>
    <div className="ability-row">{abilities.map(key => <span key={key}>{key} <b>{actor.abilities[key]}</b></span>)}</div>
    <p className="muted">{[actor.classLevel, actor.speed + ' ฟุต', actor.conditions, actor.life === 'active' ? '' : actor.life].filter(Boolean).join(' · ')}</p>
    {(actor.skills || actor.saves || actor.spells) && <p className="muted">{[actor.skills, actor.saves, actor.spells].filter(Boolean).join(' · ')}</p>}
    <div className="inline">
      <select aria-label="ค่าความสามารถ" value={ability} onChange={e => setAbility(e.target.value)}>{abilities.map(key => <option key={key}>{key}</option>)}</select>
      <button onClick={() => roll('check')}>Check</button><button onClick={() => roll('save')}>Save</button>
      <button onClick={() => roll('initiative')}>Initiative</button>
    </div>
    <div className="checks">
      <label><input type="checkbox" checked={proficient} onChange={e => setProficient(e.target.checked)} />Proficient</label>
      <label><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Adv.</label>
      <label><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Disadv.</label>
    </div>
    <div className="inline">
      <select aria-label="เป้าหมาย" value={targetId ?? ''} onChange={e => setTarget(e.target.value)}>
        {targets.length === 0 && <option value="">ไม่มีเป้าหมาย</option>}
        {targets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <select aria-label="ที่กำบังของเป้าหมาย" value={cover} onChange={e => setCover(Number(e.target.value))}>
        <option value={0}>ไม่มี Cover</option><option value={2}>Half Cover</option><option value={5}>¾ Cover</option>
      </select>
    </div>
    {!!actor.attacks?.length && <select aria-label="เลือกรายการโจมตี" value={weapon} onChange={e => setWeapon(e.target.value)}>
      <option value="">การโจมตีหลัก</option>
      {actor.attacks.map((item, index) => <option value={index} key={index}>{item.name}</option>)}
    </select>}
    <div className="inline"><button disabled={!targetId || !scene?.tokens.some(token => token.actorId === actor.id)} onClick={() => roll('attack')}>Attack</button>
      <button onClick={() => roll('damage')}>Damage</button></div>
    <div className="inline"><input aria-label="สูตร Spell Damage" value={spellDamage} onChange={e => setSpellDamage(e.target.value)} />
      <button disabled={!targetId} onClick={() => roll('spellAttack')}>Spell Attack</button></div>
    <details className="spell-save"><summary>เวทที่ให้เป้าหมายทอย Save</summary>
      <label>ชื่อเวท<input value={spellName} onChange={event => setSpellName(event.target.value)} /></label>
      <label className="inline"><input type="checkbox" checked={half} onChange={event => setHalf(event.target.checked)} />ผ่านแล้วรับความเสียหายครึ่งหนึ่ง</label>
      <button disabled={!targetId || !spellName.trim()} onClick={() => void send({
        type: 'castSave', actorId: actor.id, targetId, sceneId: scene?.id, ability, label: spellName, half, formula: spellDamage
      })}>ขอ {ability} Save · DC {actor.spellDC}</button>
    </details>
    <div className="inline"><input aria-label="ช่องเวท" placeholder="ช่องเวทคงเหลือ" value={slots} onChange={e => setSlots(e.target.value)} />
      <button onClick={() => void send({ type: 'slots', slots, actorId: actor.id })}>บันทึก</button></div>
    <p className="muted">Spell DC {actor.spellDC}</p>
    {actor.hp === 0 && <div className="inline"><span>Death saves {actor.successes} ✓ / {actor.failures} ×</span>
      {actor.life === 'dying' && <button onClick={() => roll('death')}>ทอย</button>}</div>}
    {room.me.role === 'dm' && <div className="inline"><input aria-label="HP ที่รักษา" type="number" min="1" value={healing} onChange={e => setHealing(e.target.valueAsNumber)} />
      <button onClick={() => void send({ type: 'heal', actorId: actor.id, amount: healing })}>รักษา</button></div>}
  </div>
}

function Table({ initial }: { initial: Snapshot }) {
  const [room, setRoom] = useState(initial)
  const [online, setOnline] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [focusScene, setFocusScene] = useState('')
  const [selected, setSelected] = useState('')
  const [modal, setModal] = useState<'createScene' | 'editScene'>()
  const [sheet, setSheet] = useState<{ initial: Sheet; actor?: Actor; template?: Template; asTemplate?: boolean }>()
  const [placing, setPlacing] = useState<{ actorId?: string; templateId?: string }>()
  const [formula, setFormula] = useState('1d20')
  const [participants, setParticipants] = useState<string[]>()
  const [surprised, setSurprised] = useState<string[]>([])
  const [amounts, setAmounts] = useState<Record<string, number>>({})
  const [older, setOlder] = useState<Roll[]>([])
  const [historyEnded, setHistoryEnded] = useState(false)
  const [saveProficiency, setSaveProficiency] = useState<Record<string, boolean>>({})
  const pending = useRef(false)
  const latest = useRef(room)
  const dm = room.me.role === 'dm'
  const scene = room.scenes.find(item => item.id === (dm && focusScene ? focusScene : room.activeSceneId))
  const actor = room.actors.find(item => item.id === selected)
  const combat = scene?.combat
  const base = '/api/rooms/' + room.id
  const refresh = async () => accept(await api<Snapshot>(base))

  function accept(next: Snapshot) {
    if (next.revision < latest.current.revision) return
    latest.current = next
    setRoom(next)
  }
  useEffect(() => {
    let socket: WebSocket | undefined
    let retry: ReturnType<typeof setTimeout>
    let closed = false
    const open = () => {
      socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + base + '/socket')
      socket.onopen = () => { if (!closed) setOnline(true) }
      socket.onmessage = event => accept(JSON.parse(event.data) as Snapshot)
      socket.onclose = () => {
        if (closed) return
        setOnline(false)
        retry = setTimeout(open, 1200)
      }
    }
    open()
    const timer = setInterval(() => { void refresh().catch(() => {}) }, 5000)
    return () => { closed = true; clearTimeout(retry); clearInterval(timer); socket?.close() }
  }, [base])

  const send: Send = async command => {
    if (pending.current) return false
    pending.current = true
    setError('')
    try {
      const payload = post({ ...command, commandId: commandId(), revision: latest.current.revision })
      // Retry only when the browser received no HTTP response. The server reuses this receipt.
      try { await api(base + '/commands', payload) }
      catch (error) {
        if (!(error instanceof TypeError)) throw error
        await api(base + '/commands', payload)
      }
      await refresh().catch(() => {})
      return true
    } catch (error) {
      setError((error as Error).message)
      await refresh().catch(() => {})
      return false
    } finally { pending.current = false }
  }
  function switchView(id: string) { setFocusScene(id); setPlacing(undefined); setParticipants(undefined) }
  useEffect(() => { setOlder([]); setHistoryEnded(false) }, [room.activeSceneId])
  const history = [...older.filter(roll => !room.rolls.some(current => current.id === roll.id)), ...room.rolls]
  const inviteLink = room.invite && location.origin + '/?invite=' + room.invite + '&room=' + room.id
  const actorName = (id: string) => room.publicActors.find(item => item.id === id)?.name ?? 'ตัวละคร'
  const commandHere = (command: Record<string, unknown>) => send({ ...command, sceneId: scene?.id })

  return <main className="table">
    <header className="table-header">
      <a className="brand" href="/">◈ <span>Beholder</span></a>
      <div className="room-name">{room.name}<span>{room.members.length} คน</span></div>
      <div className="identity"><span className={online ? 'online' : 'offline'}>{online ? 'สด' : 'กำลังเชื่อมต่อ'}</span><span>{room.me.name} · {dm ? 'DM' : 'ผู้เล่น'}</span></div>
    </header>
    <aside className="sidebar panel">
      <div className="section-head"><h2>ฉาก</h2>{dm && <button aria-label="สร้างฉาก" onClick={() => setModal('createScene')}>+</button>}</div>
      {room.scenes.map(item => <button className={'scene-item ' + (scene?.id === item.id ? 'selected' : '')} key={item.id} onClick={() => switchView(item.id)}>
        <span>{item.name}</span>{room.activeSceneId === item.id && <small>เปิดอยู่</small>}
      </button>)}
      {!room.scenes.length && <p className="muted">ยังไม่มีฉาก</p>}
      {inviteLink && <details className="invite"><summary>เชิญผู้เล่น</summary><input aria-label="ลิงก์เชิญ" readOnly value={inviteLink} onFocus={e => e.target.select()} />
        <button onClick={async () => {
          try { await navigator.clipboard.writeText(inviteLink); setNotice('คัดลอกลิงก์แล้ว') }
          catch { setNotice('เลือกข้อความในช่องเพื่อคัดลอกลิงก์') }
        }}>คัดลอก</button></details>}
      <div className="section-head"><h2>ชีต</h2><button onClick={() => setSheet({ initial: blankSheet() })}>+ ตัวละคร</button></div>
      {room.actors.map(item => <div className="actor-item" key={item.id}>
        <button className={selected === item.id ? 'selected' : ''} onClick={() => setSelected(item.id)}>{item.name}</button>
        {dm && scene && <button aria-label={'วาง ' + item.name} disabled={scene.tokens.some(token => token.actorId === item.id)}
          onClick={() => setPlacing({ actorId: item.id })}>วาง</button>}
      </div>)}
      {dm && <><div className="section-head"><h2>มอนสเตอร์</h2><button onClick={() => setSheet({ initial: blankSheet('monster'), asTemplate: true })}>+ ต้นแบบ</button></div>
        {room.templates.map(item => <div className="actor-item" key={item.id}>
          <button onClick={() => setSheet({ initial: item.sheet, template: item, asTemplate: true })}>{item.sheet.name}</button>
          {scene && <button onClick={() => setPlacing({ templateId: item.id })}>วาง</button>}
        </div>)}</>}
    </aside>
    <section className="workspace">
      <div className="scene-header"><h1>{scene?.name ?? 'กระดาน'}</h1>
        {dm && scene && <div className="inline">
          {room.activeSceneId !== scene.id && <button className="primary" onClick={() => void commandHere({ type: 'activate' })}>เปิดให้ผู้เล่น</button>}
          <button onClick={() => setModal('editScene')}>ตั้งค่า Grid</button>
          {room.scenes.some(item => item.id !== scene.id && item.map) && <select className="reuse-map" aria-label="ใช้ภาพจากฉากอื่น" value="" onChange={event => {
            if (event.target.value) void commandHere({ type: 'reuseMap', sourceId: event.target.value })
          }}><option value="">ใช้ภาพจากฉากอื่น</option>
            {room.scenes.filter(item => item.id !== scene.id && item.map).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>}
          <label className="button file">อัปโหลดแผนที่<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async event => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (!file) return
            try {
              await api(base + '/scenes/' + scene.id + '/map', { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
              await refresh()
            } catch (error) { setError((error as Error).message) }
          }} /></label>
        </div>}
      </div>
      {scene ? <Board key={scene.id} scene={scene} room={room} selected={selected} select={setSelected}
        move={(token, point) => void commandHere({ type: 'move', tokenId: token.id, ...point })}
        place={placing && (point => void commandHere({ type: 'place', ...placing, ...point }).then(ok => { if (ok) setPlacing(undefined) }))} />
        : <div className="empty"><p>{dm ? 'สร้างฉากเพื่อเริ่มจัดกระดาน' : 'รอ DM เปิดฉาก'}</p>
            {dm && <button className="primary" onClick={() => setModal('createScene')}>สร้างฉาก</button>}</div>}
      {placing && <button onClick={() => setPlacing(undefined)}>ยกเลิกการวาง</button>}
    </section>
    <aside className="activity panel">
      <div className="section-head"><h2>การต่อสู้</h2>
        {dm && scene?.id === room.activeSceneId && !!scene?.tokens.length && !combat &&
          <button onClick={() => { setParticipants(scene.tokens.map(token => token.actorId)); setSurprised([]) }}>เริ่ม</button>}
      </div>
      {participants && scene && <div className="encounter">
        {scene.tokens.map(token => <div className="participants" key={token.id}>
          <label><input type="checkbox" checked={participants.includes(token.actorId)}
            onChange={event => setParticipants(event.target.checked ? [...participants, token.actorId] : participants.filter(id => id !== token.actorId))} /> {actorName(token.actorId)}</label>
          <label><input type="checkbox" checked={surprised.includes(token.actorId)}
            onChange={event => setSurprised(event.target.checked ? [...surprised, token.actorId] : surprised.filter(id => id !== token.actorId))} /> ถูกจู่โจม</label>
        </div>)}
        <div className="inline"><button onClick={() => setParticipants(undefined)}>ยกเลิก</button>
          <button onClick={() => void commandHere({ type: 'combat', participants, surprised }).then(ok => { if (ok) setParticipants(undefined) })}>ทอย Initiative</button></div>
      </div>}
      {combat && <div className="encounter">
        <p>รอบ {combat.round}</p>
        {combat.order.map((entry, index) => <div key={entry.actorId} className={'turn ' + (index === combat.turn ? 'current' : '')}>
          <button onClick={() => setSelected(entry.actorId)}>{actorName(entry.actorId)}</button><b>{entry.initiative}</b>
          {dm && index > 0 && entry.initiative === combat.order[index - 1].initiative &&
            <button aria-label="สลับลำดับ Initiative" onClick={() => void commandHere({ type: 'tie', actorId: entry.actorId })}>↑</button>}
        </div>)}
        {dm && scene?.id === room.activeSceneId && <div className="inline"><button onClick={() => void commandHere({ type: 'next' })}>เทิร์นถัดไป</button>
          <button onClick={() => void commandHere({ type: 'end' })}>จบการต่อสู้</button></div>}
      </div>}
      {actor && <section className="sheet-summary"><div className="section-head"><h2>{actor.name}</h2>
        <button onClick={() => setSheet({ initial: actor, actor })}>แก้ชีต</button></div>
        <ActorActions key={actor.id} actor={actor} scene={scene} room={room} send={send} />
      </section>}
      <div className="section-head"><h2>ผลทอย</h2></div>
      <form className="inline" onSubmit={event => { event.preventDefault(); void send({ type: 'roll', formula }) }}>
        <input aria-label="สูตรเต๋า" value={formula} onChange={event => setFormula(event.target.value)} /><button className="primary">ทอย</button>
      </form>
      <div className="dice-buttons">{[4, 6, 8, 10, 12, 20, 100].map(die => <button key={die} onClick={() => void send({ type: 'roll', formula: '1d' + die })}>d{die}</button>)}</div>
      <ol className="rolls">{[...history].reverse().map(roll => <li key={roll.id}>
        <div><small>{roll.name} · {roll.label}</small><br /><span>{roll.formula}{roll.faces.length > 0 && ' · [' + roll.faces.join(', ') + ']'}{roll.modifier ? ' ' + (roll.modifier > 0 ? '+' : '') + roll.modifier : ''}</span>
          {roll.outcome && <small> · {roll.outcome}</small>}</div><strong>{roll.total}</strong>
        {roll.cast && !roll.cast.resolved && (dm || room.actors.some(item => item.id === roll.targetId)) && <div className="inline damage">
          <label><input type="checkbox" checked={saveProficiency[roll.id] ?? false}
            onChange={event => setSaveProficiency({ ...saveProficiency, [roll.id]: event.target.checked })} />Proficient</label>
          <button onClick={() => void commandHere({ type: 'spellSave', rollId: roll.id, proficient: saveProficiency[roll.id] })}>ทอยให้ {actorName(roll.cast.targetId)}</button>
        </div>}
        {dm && roll.targetId && roll.applied === false && <div className="inline damage">
          <input aria-label="ความเสียหายที่ยืนยัน" type="number" min="0" value={amounts[roll.id] ?? Math.max(0, roll.total)}
            onChange={e => setAmounts({ ...amounts, [roll.id]: e.target.valueAsNumber })} />
          <button onClick={() => void commandHere({ type: 'damage', rollId: roll.id, actorId: roll.targetId, amount: amounts[roll.id] ?? Math.max(0, roll.total) })}>ยืนยัน HP</button>
        </div>}
      </li>)}</ol>
      {!historyEnded && history.length >= 40 && <button onClick={async () => {
        try {
          const page = await api<Roll[]>(base + '/rolls?before=' + history[0].id)
          setOlder(previous => [...page, ...previous])
          setHistoryEnded(page.length < 40)
        } catch (error) { setError((error as Error).message) }
      }}>ดูผลทอยก่อนหน้า</button>}
    </aside>
    {(error || notice) && <div className="toast" role={error ? 'alert' : 'status'}>{error || notice}<button aria-label="ปิดข้อความ" onClick={() => { setError(''); setNotice('') }}>×</button></div>}
    {modal && <SceneForm scene={modal === 'editScene' ? scene : undefined} save={send} cancel={() => setModal(undefined)} />}
    {sheet && <SheetEditor initial={sheet.initial} cancel={() => setSheet(undefined)} save={value => void send({
      type: sheet.asTemplate ? 'template' : 'sheet', actorId: sheet.actor?.id, templateId: sheet.template?.id, kind: value.kind, sheet: value
    }).then(ok => { if (ok) setSheet(undefined) })} />}
  </main>
}

function App() {
  const [room, setRoom] = useState<Snapshot>()
  const [error, setError] = useState('')
  const params = new URLSearchParams(location.search)
  const invite = params.get('invite') ?? undefined
  const roomId = params.get('room')
  const [loading, setLoading] = useState(Boolean(roomId))
  const enter = (state: Snapshot) => { history.replaceState(null, '', '/?room=' + state.id); setRoom(state) }
  useEffect(() => {
    if (!roomId) return
    void api<Snapshot>('/api/rooms/' + roomId).then(enter).catch(error => {
      if (!invite) setError(error.message)
    }).finally(() => setLoading(false))
  }, [])
  if (loading) return <main className="entry"><p>กำลังเปิดโต๊ะ…</p></main>
  return room ? <Table initial={room} /> : <Entry invite={invite} enter={enter} initialError={error} />
}

createRoot(document.getElementById('root')!).render(<App />)
