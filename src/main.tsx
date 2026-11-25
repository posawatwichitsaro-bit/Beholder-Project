import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { abilities, blankSheet, objectDefinition, objectLabels, tokenRoleLabels } from '../shared/model.ts'
import type { Account, Actor, ObjectDefinition, Roll, Scene, Sheet, Snapshot, Template, TokenRole } from '../shared/model.ts'
import { AccountPanel } from './AccountPanel.tsx'
import { MonsterManual } from './MonsterManual.tsx'
import { Board } from './Board.tsx'
import { CombatPanel } from './CombatPanel.tsx'
import { DamageTypeSelect, TurnRail } from './CombatEffects.tsx'
import type { Area, AreaKind } from '../shared/area.ts'
import { SheetEditor } from './SheetEditor.tsx'
import { PersonalLibrary } from './PersonalLibrary.tsx'
import { ObjectEditor, ObjectActions } from './Objects.tsx'
import { InventoryPanel, LootDialog } from './Inventory.tsx'
import { api, commandId, json as post } from './api.ts'
import { bonusForCheck, commonSkills } from '../shared/characterStats.ts'
import type { Skill } from '../shared/characterStats.ts'
import './style.css'


type AccountProps = { account: Account | null; changeAccount: (account: Account | null) => void }

function Entry({ invite, roomId, dmLink, enter, initialError, account, changeAccount }: AccountProps & {
  invite?: string; roomId: string | null; dmLink: boolean; enter: (room: Snapshot) => void; initialError: string
}) {
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
        ? await api<Snapshot>('/api/join', post({ name: form.get('member'), invite, roomId, role: form.get('role') }))
        : await api<Snapshot>('/api/rooms', post({ name: form.get('room'), member: form.get('member') })))
    } catch (error) { setError((error as Error).message) }
    finally { setWaiting(false) }
  }
  return <main className="entry">
    <header className="entry-hero"><h1>Beholder</h1><span>Dungeons &amp; Dragons · Virtual Tabletop</span></header>
    <div className="entry-panels">
      <AccountPanel account={account} change={changeAccount} />
      <form onSubmit={submit}>
        <h2>{invite ? 'เข้าร่วมโต๊ะ' : 'เปิดโต๊ะใหม่'}</h2>
        {!invite && <label>ชื่อห้อง<input name="room" required maxLength={120} placeholder="เช่น ประตูเมืองเหนือ" /></label>}
        {account ? <p className="muted">ชื่อที่ใช้บนโต๊ะ · {account.name}</p>
          : <label>ชื่อที่ใช้บนโต๊ะ<input name="member" required maxLength={120} autoComplete="nickname" /></label>}
        {invite && <label>บทบาท<select name="role" defaultValue={dmLink ? 'dm' : 'player'}><option value="dm">DM</option><option value="player">Player</option></select></label>}
        {error && <p role="alert">{error}</p>}
        <button className="primary" disabled={waiting}>{waiting ? 'กำลังเชื่อมต่อ…' : invite ? 'เข้าร่วม' : 'สร้างห้อง DM'}</button>
      </form>
    </div>
  </main>
}

type Send = (command: Record<string, unknown>) => Promise<boolean>
type SceneOperation = { mode: 'copy' | 'delete'; scene: Scene }
type Drawer = 'scenes' | 'sheets' | 'actor' | 'combat' | 'dice' | 'library' | 'objects' | 'account' | 'manual'
type Point = { x: number; y: number }
type TokenSource = { actorId: string } | { templateId: string } | { sheet: Sheet }
type TokenPlacement = { sceneId: string; source: TokenSource; role?: TokenRole }
const arrowSteps: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }
}
const menuGroups = [
  { title: 'กระดาน', items: [['scenes', '◇', 'ฉากและแผนที่'], ['sheets', '♙', 'ชีตในห้อง'], ['objects', '▣', 'Object']] },
  { title: 'การเล่น', items: [['combat', '⚔', 'การต่อสู้'], ['dice', '⬡', 'ลูกเต๋า'], ['manual', '♜', 'Monster Manual']] },
  { title: 'ส่วนตัว', items: [['library', '▤', 'คลังส่วนตัว'], ['account', '⚙', 'ตั้งค่าบัญชี']] }
] as const

function TokenRoleForm({ name, hasMain, save, cancel }: {
  name: string; hasMain: boolean; save: (role: TokenRole) => void; cancel: () => void
}) {
  return <div className="scrim"><section className="dialog compact token-role-dialog" role="dialog" aria-label="เลือกประเภท Token">
    <header><h2>{name}</h2><button onClick={cancel} aria-label="ปิด">×</button></header>
    <button className="token-role-option" aria-label={tokenRoleLabels.character} disabled={hasMain} onClick={() => save('character')}>
      <b>{tokenRoleLabels.character}</b><small>{hasMain ? 'ผู้เล่นนี้มีตัวละครหลักในฉากแล้ว' : 'ตัวละครหลักประจำฉาก · เคลื่อนที่ด้วยปุ่มลูกศร'}</small>
    </button>
    <button className="token-role-option" aria-label={tokenRoleLabels.companion} onClick={() => save('companion')}>
      <b>{tokenRoleLabels.companion}</b><small>ผู้ร่วมทาง · ใช้ชีตเต็มรูปแบบและลากเพื่อเคลื่อนที่</small>
    </button>
  </section></div>
}

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

function SceneOperationForm({ operation, save, cancel }: {
  operation: SceneOperation; save: Send; cancel: () => void
}) {
  const { mode, scene } = operation
  const title = mode === 'copy' ? 'คัดลอกฉาก' : 'ลบฉาก'
  return <div className="scrim"><form className="dialog compact" role="dialog" aria-label={title} onSubmit={async event => {
    event.preventDefault()
    const name = new FormData(event.currentTarget).get('name')
    if (await save({ type: mode === 'copy' ? 'copyScene' : 'deleteScene', sceneId: scene.id, name })) cancel()
  }}>
    <header><h2>{title}</h2><button type="button" onClick={cancel} aria-label="ปิด">×</button></header>
    {mode === 'copy'
      ? <label>ชื่อฉากสำเนา<input name="name" required maxLength={120} defaultValue={scene.name.slice(0, 110) + ' (สำเนา)'} /></label>
      : <p>ลบฉาก <b>{scene.name}</b> พร้อม Token และ Object ที่วางในฉากนี้?</p>}
    <footer><button type="button" onClick={cancel}>ยกเลิก</button><button className={mode === 'copy' ? 'primary' : 'danger'}>
      {mode === 'copy' ? 'สร้างสำเนา' : 'ยืนยันลบฉาก'}</button></footer>
  </form></div>
}

function ActorActions({ actor, scene, room, send, combatTarget }: { actor: Actor; scene?: Scene; room: Snapshot; send: Send; combatTarget?: string }) {
  const compact = combatTarget !== undefined
  const [target, setTarget] = useState('')
  const [advantage, setAdvantage] = useState(false)
  const [disadvantage, setDisadvantage] = useState(false)
  const [proficient, setProficient] = useState(false)
  const [ability, setAbility] = useState('STR')
  const [skill, setSkill] = useState('')
  const [cover, setCover] = useState(0)
  const [spellDamage, setSpellDamage] = useState('1d8')
  const [spellName, setSpellName] = useState('')
  const [half, setHalf] = useState(false)
  const [weapon, setWeapon] = useState('')
  const [healing, setHealing] = useState(1)
  const [slots, setSlots] = useState(actor.slots)
  const targets = room.publicActors.filter(item => item.id !== actor.id && scene?.tokens.some(token => token.actorId === item.id))
  const targetId = compact ? combatTarget : targets.some(item => item.id === target) ? target : targets[0]?.id
  function roll(rollType: string) {
    const weaponIndex = (rollType === 'attack' || rollType === 'damage') && weapon !== '' && actor.attacks?.[Number(weapon)] ? Number(weapon) : undefined
    void send({ type: 'sheetRoll', rollType, actorId: actor.id, sceneId: scene?.id, targetId, ability,
      skill: rollType === 'check' ? skill : undefined, advantage, disadvantage, proficient, cover, formula: spellDamage, weaponIndex })
  }
  return <div className="actor-actions">
    {!compact && <><div className="stat-row"><span><b>{actor.hp}/{actor.maxHp}</b> HP</span><span><b>{actor.ac}</b> AC</span><span><b>{actor.tempHp}</b> Temp</span></div>
    <div className="ability-row">{abilities.map(key => <span key={key}>{key} <b>{actor.abilities[key]}</b></span>)}</div>
    <p className="muted">{[actor.classLevel, actor.speed + ' ฟุต', actor.conditions, actor.life === 'active' ? '' : actor.life].filter(Boolean).join(' · ')}</p>
    {(actor.skills || actor.saves || actor.spells) && <p className="muted">{[
      Object.keys(actor.skillChecks ?? {}).length ? '' : actor.skills,
      Object.keys(actor.savingThrows ?? {}).length ? '' : actor.saves, actor.spells
    ].filter(Boolean).join(' · ')}</p>}</>}
    {Object.keys(actor.skillChecks ?? {}).length > 0 && <label>เลือกทักษะสำหรับ Check<select value={skill} onChange={event => setSkill(event.target.value)}>
      <option value="">ใช้ค่าความสามารถด้านล่าง</option>
      {(Object.keys(commonSkills) as Skill[]).map(key => {
        const structured = actor.skillChecks?.[key]
        const bonus = structured && bonusForCheck(actor, structured)
        return <option key={key} value={key}>{key}{bonus !== undefined ? ' (' + (bonus >= 0 ? '+' : '') + bonus + ')' : ''}</option>
      })}
    </select></label>}
    <div className="inline">
      <select aria-label="ค่าความสามารถ" value={ability} onChange={e => setAbility(e.target.value)}>{abilities.map(key => {
        const saved = actor.savingThrows?.[key]
        const bonus = saved && bonusForCheck(actor, saved)
        return <option key={key} value={key}>{key}{bonus !== undefined ? ' · Save ' + (bonus >= 0 ? '+' : '') + bonus : ''}</option>
      })}</select>
      <button onClick={() => roll('check')}>Check</button><button onClick={() => roll('save')}>Save</button>
      {!compact && <button onClick={() => roll('initiative')}>Initiative</button>}
    </div>
    <div className="checks">
      <label><input type="checkbox" checked={proficient} onChange={e => setProficient(e.target.checked)} />Proficient</label>
      <label><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Adv.</label>
      <label><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Disadv.</label>
    </div>
    <div className="inline">
      {!compact && <select aria-label="เป้าหมาย" value={targetId ?? ''} onChange={e => setTarget(e.target.value)}>
        {targets.length === 0 && <option value="">ไม่มีเป้าหมาย</option>}
        {targets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>}
      <select aria-label="ที่กำบังของเป้าหมาย" value={cover} onChange={e => setCover(Number(e.target.value))}>
        <option value={0}>ไม่มี Cover</option><option value={2}>Half Cover</option><option value={5}>¾ Cover</option>
      </select>
    </div>
    {!compact && !!actor.attacks?.length && <select aria-label="เลือกรายการโจมตี" value={weapon} onChange={e => setWeapon(e.target.value)}>
      <option value="">การโจมตีหลัก</option>
      {actor.attacks.map((item, index) => <option value={index} key={index}>{item.name}</option>)}
    </select>}
    {!compact && <div className="inline"><button disabled={!targetId || !scene?.tokens.some(token => token.actorId === actor.id)} onClick={() => roll('attack')}>Attack</button>
      <button onClick={() => roll('damage')}>Damage</button></div>}
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
    {!compact && actor.hp === 0 && <div className="inline"><span>Death saves {actor.successes} ✓ / {actor.failures} ×</span>
      {actor.life === 'dying' && <button onClick={() => roll('death')}>ทอย</button>}</div>}
    {!compact && room.me.role === 'dm' && <div className="inline"><input aria-label="HP ที่รักษา" type="number" min="1" value={healing} onChange={e => setHealing(e.target.valueAsNumber)} />
      <button onClick={() => void send({ type: 'heal', actorId: actor.id, amount: healing })}>รักษา</button></div>}
  </div>
}

function Table({ initial, account, changeAccount }: AccountProps & { initial: Snapshot }) {
  const [room, setRoom] = useState(initial)
  const [online, setOnline] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [drawer, setDrawer] = useState<Drawer>()
  const [libraryDraft, setLibraryDraft] = useState<Sheet>()
  const [objectDraft, setObjectDraft] = useState<ObjectDefinition>()
  const [librarySection, setLibrarySection] = useState<'sheets' | 'objects'>('sheets')
  const [hpTarget, setHpTarget] = useState<string>()
  const [objectImport, setObjectImport] = useState<{ sceneId: string; point: Point }>()
  const [objectTarget, setObjectTarget] = useState<string>()
  const [lootTarget, setLootTarget] = useState<string>()
  const [hideTray, setHideTray] = useState(false)
  const [privateRoll, setPrivateRoll] = useState(false)
  const [placementPoint, setPlacementPoint] = useState<Point>()
  const [focusScene, setFocusScene] = useState('')
  const [selected, setSelected] = useState('')
  const [modal, setModal] = useState<'createScene' | { sceneId: string }>()
  const [sceneOperation, setSceneOperation] = useState<SceneOperation>()
  const [sheet, setSheet] = useState<{ initial: Sheet; actor?: Actor; template?: Template; asTemplate?: boolean }>()
  const [tokenPlacement, setPlacing] = useState<TokenPlacement>()
  const [tokenChoice, setTokenChoice] = useState<{ placement: TokenPlacement; name: string; ownerId: string }>()
  const [objectPlacement, setObjectPlacement] = useState<{ sceneId: string; definition: ObjectDefinition }>()
  const [formula, setFormula] = useState('1d20')
  const [combatTarget, setCombatTarget] = useState('')
  const [cameraFocus, setCameraFocus] = useState<{ actorId: string; sequence: number }>()
  const [areaKind, setAreaKind] = useState<AreaKind>()
  const [areaPreview, setAreaPreview] = useState<Area>()
  const [amounts, setAmounts] = useState<Record<string, number>>({})
  const [older, setOlder] = useState<Roll[]>([])
  const [historyEnded, setHistoryEnded] = useState(false)
  const [saveProficiency, setSaveProficiency] = useState<Record<string, boolean>>({})
  const pending = useRef(false)
  const latest = useRef(room)
  const dm = room.me.role === 'dm'
  const published = room.scenes.find(item => item.id === room.activeSceneId)
  const scene = (dm && focusScene ? room.scenes.find(item => item.id === focusScene) : undefined) ?? published
  const placingObject = objectPlacement?.sceneId === scene?.id ? objectPlacement?.definition : undefined
  const placing = tokenPlacement?.sceneId === scene?.id ? tokenPlacement : undefined
  const mainToken = !dm ? scene?.tokens.find(token => token.role === 'character' && room.actors.some(actor => actor.id === token.actorId)) : undefined
  const visibleChoice = tokenChoice?.placement.sceneId === scene?.id ? tokenChoice : undefined
  const editingScene = typeof modal === 'object' ? room.scenes.find(item => item.id === modal.sceneId) : undefined
  const actor = room.actors.find(item => item.id === selected)
  const hpActor = room.actors.find(item => item.id === hpTarget)
  const sceneObject = scene?.objects?.find(item => item.id === objectTarget)
  const lootMonster = room.publicActors.find(item => item.id === lootTarget && item.lootable && scene?.tokens.some(token => token.actorId === item.id))
  const combat = scene?.combat
  const combatOpen = dm && drawer === 'combat'
  const showTurnRail = Boolean(combat && (dm || combat.order.some(entry => room.actors.some(actor => actor.id === entry.actorId))))
  const menuOpen = Boolean(drawer && !combatOpen)
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

  const send = async (command: Record<string, unknown>, created?: (id: string) => void) => {
    if (pending.current) return false
    pending.current = true
    setError('')
    try {
      const silent = dm && privateRoll && ['roll', 'sheetRoll', 'attackObject'].includes(String(command.type))
      const payload = post({ ...command, privateRoll: silent, commandId: commandId(), revision: latest.current.revision })
      // Retry only when the browser received no HTTP response. The server reuses this receipt.
      let receipt: { sceneId?: string }
      try { receipt = await api(base + '/commands', payload) }
      catch (error) {
        if (!(error instanceof TypeError)) throw error
        receipt = await api(base + '/commands', payload)
      }
      await refresh().catch(() => {})
      if (receipt.sceneId) created?.(receipt.sceneId)
      return true
    } catch (error) {
      setError((error as Error).message)
      await refresh().catch(() => {})
      return false
    } finally { pending.current = false }
  }
  const mainTokenId = mainToken?.id
  const keyboardSceneId = !dm ? scene?.id : undefined
  useEffect(() => {
    if (!mainTokenId || !keyboardSceneId) return
    const queue: Point[] = []
    let stepping = false
    let cancelled = false
    async function step() {
      stepping = true
      while (!cancelled && latest.current.activeSceneId === keyboardSceneId && queue.length) {
        const direction = queue.shift()!
        if (!await send({ type: 'stepCharacter', tokenId: mainTokenId, sceneId: keyboardSceneId, dx: direction.x, dy: direction.y })) break
      }
      queue.length = 0
      stepping = false
    }
    function key(event: KeyboardEvent) {
      const direction = arrowSteps[event.key]
      if (!direction || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey ||
        document.querySelector('.scrim, .context-popover') ||
        (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, summary, [contenteditable]'))) return
      event.preventDefault()
      if (queue.length < 4) queue.push(direction)
      if (!stepping) void step()
    }
    window.addEventListener('keydown', key)
    return () => { cancelled = true; window.removeEventListener('keydown', key) }
  }, [mainTokenId, keyboardSceneId])
  function switchView(id: string) {
    setFocusScene(id); setPlacing(undefined); setPlacementPoint(undefined); setCombatTarget('')
    setObjectTarget(undefined); setLootTarget(undefined); setObjectImport(undefined); setObjectPlacement(undefined); setTokenChoice(undefined)
  }
  function clearArea() { setAreaKind(undefined); setAreaPreview(undefined) }
  useEffect(() => { setOlder([]); setHistoryEnded(false) }, [room.activeSceneId])
  useEffect(() => { setCombatTarget(''); clearArea() }, [scene?.id, combat?.round, combat?.turn])
  useEffect(() => { if (!combatOpen) clearArea() }, [combatOpen])
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.defaultPrevented || document.querySelector('.scrim')) return
      if (event.key === 'Escape') {
        setDrawer(undefined)
        setPlacing(undefined)
        setObjectPlacement(undefined)
        setPlacementPoint(undefined)
        clearArea()
      }
      if (!(event.target instanceof HTMLElement) || event.target.closest('input,select,textarea,button,[contenteditable]') || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key.toLowerCase() === 't') setDrawer(current => current === 'sheets' ? undefined : 'sheets')
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  const history = [...older.filter(roll => !room.rolls.some(current => current.id === roll.id)), ...room.rolls]
  const inviteLink = room.invite && location.origin + '/?invite=' + room.invite + '&room=' + room.id
  const dmInviteLink = room.dmInvite && location.origin + '/?invite=' + room.dmInvite + '&room=' + room.id + '&role=dm'
  const actorName = (id: string) => room.publicActors.find(item => item.id === id)?.name ?? 'ตัวละคร'
  const commandHere = (command: Record<string, unknown>) => send({ ...command, sceneId: scene?.id })
  function showActor(id: string) {
    setSelected(id)
    setDrawer('actor')
  }
  function saveToLibrary(value: Sheet) {
    setLibraryDraft(value)
    setLibrarySection('sheets')
    setDrawer('library')
  }
  function openObjectLibrary() {
    setLibrarySection('objects')
    setDrawer('library')
  }
  function hasMain(ownerId: string) {
    return Boolean(scene?.tokens.some(token => token.role === 'character' &&
      room.actors.some(actor => actor.id === token.actorId && actor.ownerId === ownerId)))
  }
  function beginPlace(value: TokenPlacement) {
    setObjectPlacement(undefined)
    if (placementPoint) {
      void placeToken(value, placementPoint).then(ok => {
        if (ok) { setPlacementPoint(undefined); setDrawer(undefined) }
      })
    } else {
      setPlacing(value)
      setDrawer(undefined)
    }
  }
  const placeToken = (value: TokenPlacement, point: Point) =>
    send({ type: 'place', sceneId: value.sceneId, ...value.source, kind: 'sheet' in value.source ? value.source.sheet.kind : undefined, role: value.role, ...point })
  function chooseToken(source: TokenSource, name?: string, ownerId = room.me.id) {
    if (!scene) return
    const placement = { sceneId: scene.id, source }
    if (name !== undefined) setTokenChoice({ placement, name, ownerId })
    else beginPlace(placement)
  }
  const turnName = combat && actorName(combat.order[combat.turn].actorId)
  const recentRolls = room.rolls.slice(-5).reverse()
  const canPlace = dm && Boolean(scene)
  const chooseDrawer = (value: Drawer) => {
    setPlacementPoint(undefined)
    setDrawer(current => current === value ? undefined : value)
  }

  return <main className={'table' + (combatOpen ? ' with-combat' : '') + (showTurnRail ? ' with-turn-rail' : '')}>
    <header className="table-header">
      <button className="hamburger" aria-label="เมนูโต๊ะ" aria-expanded={menuOpen} aria-controls="table-drawer" onClick={() => setDrawer(menuOpen ? undefined : 'scenes')}>☰</button>
      <div className="table-location"><h1>{scene?.name ?? 'กระดาน'}</h1><span>{room.name}{dm && scene && scene.id !== room.activeSceneId ? ' · ฉากเตรียม' : ''}</span></div>
      {dm && scene && room.activeSceneId !== scene.id && <button className="primary publish-scene" onClick={() => void commandHere({ type: 'activate' })}>เปิดให้ผู้เล่น</button>}
      <div className="identity"><span className={online ? 'online' : 'offline'}>{online ? 'สด' : 'กำลังเชื่อมต่อ'}</span><span>{room.me.name} · {dm ? 'DM' : 'ผู้เล่น'}</span></div>
    </header>
    {menuOpen && <button className="drawer-backdrop" aria-label="ปิดเมนูบนกระดาน" onClick={() => { setDrawer(undefined); setPlacementPoint(undefined) }} />}
    <aside className="table-drawer panel" id="table-drawer" aria-label="เมนูโต๊ะ" hidden={!menuOpen}>
    <nav className="drawer-nav" aria-label="ระบบในห้อง">
      {menuGroups.map(group => <div className="drawer-group" key={group.title}>
        <span className="drawer-group-title">{group.title}</span>
        <div className="drawer-group-actions">{group.items.filter(([item]) => item !== 'manual' || dm).map(([item, icon, title]) =>
          <button key={item} aria-pressed={drawer === item || (item === 'sheets' && drawer === 'actor')} onClick={() => chooseDrawer(item)}>
            <span aria-hidden="true">{icon}</span>{title}
          </button>)}</div>
      </div>)}
    </nav>
    <div className="drawer-content" hidden={drawer !== 'scenes'}>
      <div className="section-head"><h2>ฉาก</h2>{dm && <button aria-label="สร้างฉาก" onClick={() => setModal('createScene')}>+</button>}</div>
      {dm && <button className="demo-button" onClick={async () => {
        if (await send({ type: 'demoEncounter' })) switchView(latest.current.scenes.at(-1)!.id)
      }}>เพิ่ม Encounter ด่านร้างริมทาง</button>}
      <ol className="scene-list">
        {room.scenes.map((item, index) => <li key={item.id} className="scene-row">
          <button className={'scene-item ' + (scene?.id === item.id ? 'selected' : '')} aria-current={scene?.id === item.id ? 'true' : undefined}
            onClick={() => switchView(item.id)}>
            <span>{item.name}</span>{room.activeSceneId === item.id && <small>เปิดอยู่</small>}
          </button>
          {dm && <>
            <button aria-label={'ย้ายฉาก ' + item.name + ' ขึ้น'} title="ย้ายขึ้น" disabled={index === 0}
              onClick={() => void send({ type: 'moveScene', sceneId: item.id, offset: -1 })}>↑</button>
            <button aria-label={'ย้ายฉาก ' + item.name + ' ลง'} title="ย้ายลง" disabled={index === room.scenes.length - 1}
              onClick={() => void send({ type: 'moveScene', sceneId: item.id, offset: 1 })}>↓</button>
          </>}
        </li>)}
      </ol>
      {!room.scenes.length && <p className="muted">ยังไม่มีฉาก</p>}
      {dm && scene && <div className="scene-settings">
        <button onClick={() => setModal({ sceneId: scene.id })}>ตั้งค่า Grid</button>
        <button onClick={() => setSceneOperation({ mode: 'copy', scene })}>คัดลอกฉาก</button>
        <button className="danger" onClick={() => setSceneOperation({ mode: 'delete', scene })}>ลบฉาก</button>
        {room.scenes.some(item => item.id !== scene.id && item.map) && <select aria-label="ใช้ภาพจากฉากอื่น" value="" onChange={event => {
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
            setDrawer(undefined)
          } catch (error) { setError((error as Error).message) }
        }} /></label>
      </div>}
      {inviteLink && <details className="invite"><summary>เชิญผู้เล่น</summary><input aria-label="ลิงก์เชิญ" readOnly value={inviteLink} onFocus={e => e.target.select()} />
        <button onClick={async () => {
          try { await navigator.clipboard.writeText(inviteLink); setNotice('คัดลอกลิงก์แล้ว') }
          catch { setNotice('เลือกข้อความในช่องเพื่อคัดลอกลิงก์') }
        }}>คัดลอก</button></details>}
      {dm && <details className="invite"><summary>เชิญ DM</summary>
        <button onClick={() => void send({ type: 'dmInvite' })}>{dmInviteLink ? 'ออกลิงก์ DM ใหม่' : 'สร้างลิงก์ DM'}</button>
        {dmInviteLink && <input aria-label="ลิงก์เชิญ DM" readOnly value={dmInviteLink} onFocus={event => event.currentTarget.select()} />}
      </details>}
      <p className="muted">{room.members.length} คน · {room.members.map(member => member.name).join(', ')}</p>
      <a className="home-link" href="/">กลับหน้าเปิดโต๊ะ</a>
    </div>
    <div className="drawer-content" hidden={drawer !== 'objects'}>
      <div className="section-head"><h2>Object ในฉาก</h2>{dm && scene && <button onClick={() => setObjectImport({ sceneId: scene.id, point: { x: 2, y: 2 } })}>นำเข้า Object</button>}</div>
      <button className="library-shortcut" onClick={openObjectLibrary}>เปิดคลัง Object ส่วนตัว</button>
      {!scene?.objects?.length && <p className="muted">ยังไม่มี Object ในฉาก</p>}
      {scene?.objects?.map(item => <button className="scene-item" key={item.id} onClick={() => setObjectTarget(item.id)}>
        <span>{item.name}</span><small>{objectLabels[item.kind]}</small>
      </button>)}
    </div>
    <div className="drawer-content" hidden={drawer !== 'sheets'}>
      {placementPoint && <p className="feedback">เลือกชีตหรือมอนสเตอร์เพื่อวางที่ช่อง {placementPoint.x}, {placementPoint.y}</p>}
      <div className="section-head"><h2>ชีต</h2><div className="inline">
        <button onClick={() => { setLibrarySection('sheets'); setDrawer('library') }}>เปิดคลังชีต</button>
        <button onClick={() => setSheet({ initial: blankSheet() })}>+ ตัวละคร</button>
      </div></div>
      {room.actors.map(item => {
        const token = scene?.tokens.find(token => token.actorId === item.id)
        const roleLabel = token?.role && tokenRoleLabels[token.role]
        return <div className="actor-item" key={item.id}>
          <button className={selected === item.id ? 'selected' : ''} aria-label={item.name} aria-description={roleLabel}
            onClick={() => showActor(item.id)}>{item.name}{roleLabel && <small className="actor-token-role" aria-hidden="true">{roleLabel}</small>}</button>
          {scene && <button aria-label={'วาง ' + item.name} disabled={Boolean(token)}
            onClick={() => chooseToken({ actorId: item.id }, item.kind === 'pc' ? item.name : undefined, item.ownerId)}>วาง</button>}
        </div>
      })}
      {dm && <><div className="section-head"><h2>มอนสเตอร์</h2><button onClick={() => setSheet({ initial: blankSheet('monster'), asTemplate: true })}>+ ต้นแบบ</button></div>
        {room.templates.map(item => <div className="actor-item" key={item.id}>
          <button onClick={() => setSheet({ initial: item.sheet, template: item, asTemplate: true })}>{item.sheet.name}</button>
          {scene && <button onClick={() => chooseToken({ templateId: item.id })}>วาง</button>}
        </div>)}</>}
    </div>
    {dm && drawer === 'manual' && <div className="drawer-content"><MonsterManual
      addTemplate={sheet => send({ type: 'template', sheet })}
      placeMonster={scene ? sheet => chooseToken({ sheet }) : undefined} /></div>}
    <div className="drawer-content" hidden={drawer !== 'library'}>
      {drawer === 'library' && <PersonalLibrary key={account?.email} useAccount={Boolean(account)} roomName={room.me.name} dm={dm} draft={libraryDraft} clearDraft={() => setLibraryDraft(undefined)}
        section={librarySection} selectSection={setLibrarySection} objectDraft={objectDraft} clearObjectDraft={() => setObjectDraft(undefined)}
        placeCharacter={scene ? value => chooseToken({ sheet: value }, value.name) : undefined}
        placeObject={dm && scene ? definition => {
          setPlacing(undefined)
          setObjectPlacement({ sceneId: scene.id, definition })
          setDrawer(undefined)
        } : undefined}
        importSheet={value => send({ type: value.kind === 'monster' ? 'template' : 'sheet', kind: value.kind, sheet: value })} />}
    </div>
    <div className="drawer-content account-settings" hidden={drawer !== 'account'}>
      {drawer === 'account' && <AccountPanel account={account} change={changeAccount} />}
    </div>
    {!dm && <div className="drawer-content" hidden={drawer !== 'combat'}>
      <div className="section-head"><h2>การต่อสู้</h2></div>
      {combat && <div className="encounter">
        <p>รอบ {combat.round}</p>
        {combat.order.map((entry, index) => <div key={entry.actorId} className={'turn ' + (index === combat.turn ? 'current' : '')}>
          <button onClick={() => room.actors.some(item => item.id === entry.actorId) && showActor(entry.actorId)}>{actorName(entry.actorId)}</button><b>{entry.initiative}</b>
        </div>)}
      </div>}
      {!combat && <p className="muted">ยังไม่มีการต่อสู้ในฉากนี้</p>}
    </div>}
    <div className="drawer-content" hidden={drawer !== 'actor'}>
      {actor && <section className="sheet-summary"><div className="section-head"><h2>{actor.name}</h2>
        <button onClick={() => setSheet({ initial: actor, actor })}>แก้ชีต</button></div>
        <button className="save-to-library" onClick={() => saveToLibrary(actor)}>คัดลอกเข้าคลังส่วนตัว</button>
        <InventoryPanel key={actor.id} actor={actor} send={send} />
        {actor.monsterReference && <details><summary>Stat block{actor.monsterReference.page && ' · SRD หน้า ' + actor.monsterReference.page}</summary><p className="stat-block">{actor.monsterReference.statBlock}</p></details>}
        <ActorActions key={actor.id} actor={actor} scene={scene} room={room} send={async value => {
          const ok = await send(value)
          if (ok && (value.type === 'sheetRoll' || value.type === 'castSave')) setDrawer('dice')
          return ok
        }} />
      </section>}
    </div>
    <div className="drawer-content" hidden={drawer !== 'dice'}>
      <div className="section-head"><h2>ผลทอย</h2></div>
      {dm && <div className="dice-settings">
        <label className="inline"><input type="checkbox" checked={privateRoll} onChange={event => setPrivateRoll(event.target.checked)} />ทอยลับสำหรับ DM คนนี้</label>
        {hideTray && <button onClick={() => setHideTray(false)}>แสดงถาดผลเต๋า</button>}
      </div>}
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
        {dm && roll.targetId && roll.applied === false && <form className="damage damage-form" onSubmit={event => {
          event.preventDefault()
          const damageKind = new FormData(event.currentTarget).get('damageKind')
          void commandHere({ type: 'damage', rollId: roll.id, actorId: roll.targetId, amount: amounts[roll.id] ?? Math.max(0, roll.total), damageKind })
        }}>
          <DamageTypeSelect />
          <div className="inline">
          <input aria-label="ความเสียหายที่ยืนยัน" type="number" min="0" value={amounts[roll.id] ?? Math.max(0, roll.total)}
            onChange={e => setAmounts({ ...amounts, [roll.id]: e.target.valueAsNumber })} />
          <button>ยืนยัน HP</button>
          </div></form>}
      </li>)}</ol>
      {!historyEnded && history.length >= 40 && <button onClick={async () => {
        try {
          const page = await api<Roll[]>(base + '/rolls?before=' + history[0].id)
          setOlder(previous => [...page, ...previous])
          setHistoryEnded(page.length < 40)
        } catch (error) { setError((error as Error).message) }
      }}>ดูผลทอยก่อนหน้า</button>}
    </div>
    </aside>
    <section className="workspace" aria-label="ฉากปัจจุบัน">
      {scene ? <Board key={scene.id} scene={scene} room={room} selected={selected} targetId={combatOpen ? combatTarget : undefined}
        mainTokenId={mainTokenId}
        focus={cameraFocus} areaKind={combatOpen ? areaKind : undefined} preview={combatOpen ? areaPreview : undefined}
        onArea={area => { setAreaPreview(area); setAreaKind(undefined) }}
        select={value => {
          if (combatOpen && combat) {
            setCombatTarget(value === combat.order[combat.turn].actorId ? '' : value)
          } else setSelected(value)
        }}
        move={(tokenIds, delta) => void commandHere({ type: 'moveTokens', tokenIds, dx: delta.x, dy: delta.y })}
        place={placingObject ? point => void commandHere({ type: 'importObject', definition: placingObject, ...point })
          .then(ok => { if (ok) setObjectPlacement(undefined) })
          : placing && (point => void placeToken(placing, point).then(ok => { if (ok) setPlacing(undefined) }))}
        placementLabel={placingObject && 'คลิกช่องเพื่อวาง ' + placingObject.name}
        actions={(token, point, object) => {
          if (object) return [{ label: 'โต้ตอบกับ Object', run: () => setObjectTarget(object.id) }]
          if (!token) return [
            { label: 'วาง Token ที่นี่', run: () => { setPlacementPoint(point); setDrawer('sheets') } },
            ...(canPlace ? [
              { label: 'นำเข้า Object ที่นี่', run: () => setObjectImport({ sceneId: scene.id, point }) },
              { label: 'เปิดคลัง Object ส่วนตัว', run: openObjectLibrary },
              { label: 'ตั้งค่า Grid', run: () => setModal({ sceneId: scene.id }) }
            ] : []),
            { label: 'เปิดลูกเต๋า', run: () => setDrawer('dice') }
          ]
          const accessible = room.actors.find(item => item.id === token.actorId)
          const lootable = room.publicActors.find(item => item.id === token.actorId && item.lootable)
          return [
            ...(lootable ? [{ label: lootable.lootResult ? 'ดูผลค้นศพ' : 'ค้นศพ / Loot', run: () => setLootTarget(token.actorId) }] : []),
            ...(accessible ? [{ label: 'เปิดชีต', run: () => showActor(accessible.id) }] : []),
            ...(accessible?.kind === 'pc' && token.role ? [{
              label: token.role === 'character' ? 'ตั้งเป็น Companion Token' : 'ตั้งเป็น Character Token',
              run: () => void commandHere({ type: 'tokenRole', tokenId: token.id, role: token.role === 'character' ? 'companion' : 'character' })
            }] : []),
            ...(dm ? [
              { label: 'ปรับ HP', run: () => setHpTarget(token.actorId) },
              { label: 'นำ Token ออกจากฉาก', disabled: combat?.order.some(entry => entry.actorId === token.actorId),
                run: () => void commandHere({ type: 'removeToken', tokenId: token.id }) }
            ] : []),
            { label: 'เปิดการต่อสู้', run: () => setDrawer('combat') }
          ]
        }} />
        : <div className="empty"><p>{dm ? 'สร้างฉากเพื่อเริ่มจัดกระดาน' : 'รอ DM เปิดฉาก'}</p>
            {dm && <button className="primary" onClick={() => setModal('createScene')}>สร้างฉาก</button>}</div>}
      {(placing || placingObject) && <button className="cancel-placement" onClick={() => { setPlacing(undefined); setObjectPlacement(undefined) }}>ยกเลิกการวาง</button>}
      {!placing && !placingObject && <div className="board-status">
        {mainToken && <button className="main-token-control" title="คลิกเพื่อไปที่ตัวละครหลัก" onClick={() =>
          setCameraFocus(current => ({ actorId: mainToken.actorId, sequence: (current?.sequence ?? 0) + 1 }))}>
          <kbd>↑ ↓ ← →</kbd><span>{actorName(mainToken.actorId)}</span>
        </button>}
        {combat ? <button onClick={() => chooseDrawer('combat')}>รอบ {combat.round} · {turnName}</button>
          : dm && scene?.tokens.length ? <button onClick={() => chooseDrawer('combat')}>เตรียมการต่อสู้</button> : null}
      </div>}
      {(!dm || !hideTray) && <aside className="dice-tray" aria-label="ถาดผลเต๋า">
        <header><button onClick={() => chooseDrawer('dice')}>ผลทอยของโต๊ะ</button>
          {dm && <button aria-label="ปิดถาดผลเต๋าของฉัน" onClick={() => setHideTray(true)}>×</button>}</header>
        {recentRolls.length ? <ol aria-live="polite">{recentRolls.map(roll => <li key={roll.id}>
          <span><b>{roll.name}</b> · {roll.label}{roll.privateTo ? ' · ลับ' : ''}{roll.outcome ? ' · ' + roll.outcome : ''}</span><strong>{roll.total}</strong>
        </li>)}</ol> : <p>ยังไม่มีการทอย</p>}
      </aside>}
    </section>
    {scene && showTurnRail && <TurnRail scene={scene} room={room} focus={actorId => {
      if (menuOpen) setDrawer(undefined)
      setCameraFocus(current => ({ actorId, sequence: (current?.sequence ?? 0) + 1 }))
    }} />}
    {combatOpen && <CombatPanel key={scene?.id} room={room} scene={scene} targetId={combatTarget} setTarget={setCombatTarget}
      shape={areaKind} preview={areaPreview} clearArea={clearArea}
      chooseArea={kind => { setAreaPreview(undefined); setAreaKind(kind) }}
      send={commandHere} close={() => setDrawer(undefined)}
      advanced={(acting, target) => <ActorActions key={acting.id} actor={acting} room={room} scene={scene} send={commandHere} combatTarget={target} />} />}
    {(error || notice) && <div className="toast" role={error ? 'alert' : 'status'}>{error || notice}<button aria-label="ปิดข้อความ" onClick={() => { setError(''); setNotice('') }}>×</button></div>}
    {(modal === 'createScene' || editingScene) && <SceneForm scene={editingScene} save={send} cancel={() => setModal(undefined)} />}
    {visibleChoice && <TokenRoleForm name={visibleChoice.name} hasMain={hasMain(visibleChoice.ownerId)} cancel={() => setTokenChoice(undefined)}
      save={role => { setTokenChoice(undefined); beginPlace({ ...visibleChoice.placement, role }) }} />}
    {sceneOperation && <SceneOperationForm key={sceneOperation.mode + sceneOperation.scene.id} operation={sceneOperation}
      save={async command => {
        const ok = await send(command, switchView)
        if (ok && sceneOperation.mode === 'delete' && sceneOperation.scene.id === scene?.id) switchView('')
        return ok
      }} cancel={() => setSceneOperation(undefined)} />}
    {objectImport && dm && objectImport.sceneId === scene?.id && <ObjectEditor point={objectImport.point}
      save={(definition, position) => send({ type: 'importObject', sceneId: objectImport.sceneId, definition, ...position })}
      close={() => setObjectImport(undefined)} />}
    {sceneObject && <ObjectActions key={sceneObject.id} item={sceneObject} selected={selected} dm={dm}
      actors={room.actors.filter(actor => scene?.tokens.some(token => token.actorId === actor.id))}
      send={commandHere} close={() => setObjectTarget(undefined)} copy={dm ? () => {
        setObjectDraft(objectDefinition(sceneObject))
        setObjectTarget(undefined)
        openObjectLibrary()
      } : undefined} />}
    {lootMonster && <LootDialog key={lootMonster.id} monster={lootMonster} stats={room.actors.find(item => item.id === lootMonster.id)}
      characters={room.actors.filter(item => item.kind === 'pc' && item.life === 'active' && scene?.tokens.some(token => token.actorId === item.id))}
      dm={dm} sceneActive={scene?.id === room.activeSceneId} send={commandHere} close={() => setLootTarget(undefined)} />}
    {hpActor && dm && <div className="scrim"><form className="dialog compact" onSubmit={async event => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      if (await commandHere({ type: 'adjustHp', actorId: hpActor.id, amount: Number(form.get('amount')), mode: form.get('mode'), damageKind: form.get('damageKind') })) setHpTarget(undefined)
    }}>
      <header><h2>ปรับ HP · {hpActor.name}</h2><button type="button" aria-label="ปิด" onClick={() => setHpTarget(undefined)}>×</button></header>
      <p>HP {hpActor.hp}/{hpActor.maxHp} · Temp HP {hpActor.tempHp}</p>
      <label>การปรับ<select name="mode"><option value="damage">ความเสียหาย</option><option value="heal">รักษา</option><option value="temp">ตั้ง Temporary HP</option></select></label>
      <label>ประเภทเมื่อเป็นความเสียหาย<DamageTypeSelect /></label>
      <label>จำนวน<input type="number" name="amount" min={1} max={9999} defaultValue={1} required /></label>
      <footer><button type="button" onClick={() => setHpTarget(undefined)}>ยกเลิก</button><button className="primary">ยืนยันการปรับ HP</button></footer>
    </form></div>}
    {sheet && <SheetEditor initial={sheet.initial} editInventory={!sheet.actor} copy={sheet.template ? () => { saveToLibrary(sheet.template!.sheet); setSheet(undefined) } : undefined}
      cancel={() => setSheet(undefined)} save={value => void send({
      type: sheet.asTemplate ? 'template' : 'sheet', actorId: sheet.actor?.id, templateId: sheet.template?.id, kind: value.kind, sheet: value
    }).then(ok => { if (ok) { setSheet(undefined); setDrawer('sheets') } })} />}
  </main>
}

function App() {
  const [room, setRoom] = useState<Snapshot>()
  const [account, setAccount] = useState<Account | null>(null)
  const [error, setError] = useState('')
  const params = new URLSearchParams(location.search)
  const invite = params.get('invite') ?? undefined
  const roomId = params.get('room')
  const [loading, setLoading] = useState(true)
  const enter = (state: Snapshot) => { history.replaceState(null, '', '/?room=' + state.id); setRoom(state) }
  useEffect(() => {
    const loadRoom = roomId && !invite ? api<Snapshot>('/api/rooms/' + roomId).then(enter) : Promise.resolve()
    void Promise.allSettled([api<Account | null>('/api/account').then(setAccount), loadRoom]).then(([profile, seat]) => {
      if (seat.status === 'rejected') setError(seat.reason.message)
      else if (profile.status === 'rejected') setError(profile.reason.message)
      setLoading(false)
    })
  }, [])
  function changeAccount(next: Account | null) {
    setAccount(next)
    if (!roomId || invite || account?.email === next?.email) return
    if (room && !next) setRoom(undefined)
    void api<Snapshot>('/api/rooms/' + roomId).then(state => {
      setError('')
      enter(state)
    }).catch(error => {
      if (!room || !next) setError(next ? error.message : '')
    })
  }
  if (loading) return <main className="entry"><p>กำลังเปิดโต๊ะ…</p></main>
  return room ? <Table key={room.me.id} initial={room} account={account} changeAccount={changeAccount} />
    : <Entry invite={invite} roomId={roomId} dmLink={params.get('role') === 'dm'} enter={enter} initialError={error} account={account} changeAccount={changeAccount} />
}

createRoot(document.getElementById('root')!).render(<App />)
