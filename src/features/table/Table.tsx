import { useEffect, useReducer, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { blankSheet, objectDefinition, objectLabels, tokenRoleLabels } from '../../../shared/model.ts'
import type { Actor, ObjectDefinition, Roll, Sheet, Template, TokenRole } from '../../../shared/model.ts'
import type { Area, AreaKind } from '../../../shared/area.ts'
import { AccountPanel } from '../account/AccountPanel.tsx'
import { MonsterManual } from '../manual/MonsterManual.tsx'
import { Board } from '../board/Board.tsx'
import { CombatPanel } from '../combat/CombatPanel.tsx'
import { DamageTypeSelect, TurnRail } from '../combat/CombatEffects.tsx'
import { SheetEditor } from '../sheets/SheetEditor.tsx'
import { ActorActions } from '../sheets/ActorActions.tsx'
import { PersonalLibrary } from '../library/PersonalLibrary.tsx'
import { ObjectEditor, ObjectActions } from '../objects/Objects.tsx'
import { InventoryPanel, LootDialog } from '../objects/Inventory.tsx'
import { SceneForm, SceneOperationForm } from '../scenes/SceneForms.tsx'
import type { SceneOperation } from '../scenes/SceneForms.tsx'
import { TokenRoleForm } from '../tokens/TokenRoleForm.tsx'
import type { AccountProps } from '../entry/Entry.tsx'
import { HudTopBar } from '../shell/HudTopBar.tsx'
import { PanelRail } from '../shell/PanelRail.tsx'
import { Dock } from '../shell/Dock.tsx'
import { CommandPalette } from '../shell/CommandPalette.tsx'
import type { PaletteCommand } from '../shell/commands.ts'
import { dockReducer, emptyDock } from '../shell/dock.ts'
import { groupLabels, panelById, panelForShortcut, panelsFor } from '../shell/panelRegistry.ts'
import type { PanelId, Role } from '../shell/panelRegistry.ts'
import { api } from '../../lib/api.ts'
import { currentRoom, roomPath, useRoomStore } from '../../state/roomStore.ts'
import { refreshRoom, useRoomConnection } from '../../state/connection.ts'
import { sendCommand } from '../../state/useCommand.ts'
import type { Command } from '../../state/useCommand.ts'

type Point = { x: number; y: number }
type TokenSource = { actorId: string } | { templateId: string } | { sheet: Sheet }
type TokenPlacement = { sceneId: string; source: TokenSource; role?: TokenRole }
const arrowSteps: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }
}
const wideScreen = () => typeof matchMedia === 'undefined' || matchMedia('(min-width: 761px)').matches
const typingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && Boolean(target.closest('input, select, textarea, [contenteditable]'))

/** The table view. Renders only while the store holds a room (see RoomRoute). */
export function Table({ account, changeAccount }: AccountProps) {
  // Keep the last snapshot so a store reset during unmount never renders an empty table.
  const stored = useRoomStore(state => state.room)
  const lastRoom = useRef(stored)
  if (stored) lastRoom.current = stored
  const room = lastRoom.current!
  const online = useRoomStore(state => state.online)
  const error = useRoomStore(state => state.error)
  const notice = useRoomStore(state => state.notice)
  const privateRoll = useRoomStore(state => state.privateRoll)
  const { setError, setNotice, clearMessages, setPrivateRoll } = useRoomStore.getState()
  const [dock, dispatchDock] = useReducer(dockReducer, emptyDock)
  const [dmCombat, setDmCombat] = useState(false)
  const [railOpen, setRailOpen] = useState(wideScreen)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [libraryDraft, setLibraryDraft] = useState<Sheet>()
  const [objectDraft, setObjectDraft] = useState<ObjectDefinition>()
  const [librarySection, setLibrarySection] = useState<'sheets' | 'objects'>('sheets')
  const [hpTarget, setHpTarget] = useState<string>()
  const [objectImport, setObjectImport] = useState<{ sceneId: string; point: Point }>()
  const [objectTarget, setObjectTarget] = useState<string>()
  const [lootTarget, setLootTarget] = useState<string>()
  const [hideTray, setHideTray] = useState(false)
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
  const dm = room.me.role === 'dm'
  const role: Role = dm ? 'dm' : 'player'
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
  const combatOpen = dm && dmCombat
  const showTurnRail = Boolean(combat && (dm || combat.order.some(entry => room.actors.some(actor => actor.id === entry.actorId))))
  const menuOpen = dock.open.length > 0
  const base = roomPath(room.id)
  const refresh = () => refreshRoom(room.id)
  const send = sendCommand

  useRoomConnection(room.id)

  /** Open a panel. The DM's combat tracker is its own side panel, not a dock panel. */
  function openPanel(id: PanelId, stack = false) {
    if (dm && id === 'combat') { setDmCombat(true); return }
    dispatchDock({ type: 'open', id, stack })
  }
  function choosePanel(id: PanelId) {
    setPlacementPoint(undefined)
    if (dm && id === 'combat') setDmCombat(open => !open)
    else dispatchDock({ type: 'toggle', id })
    if (!wideScreen()) setRailOpen(false)
  }
  /** Close dock panels (a pinned one stays). */
  const closePanels = () => dispatchDock({ type: 'closeAll' })
  const isPressed = (id: PanelId) => id === 'combat' && dm ? dmCombat
    : dock.open.includes(id) || (id === 'sheets' && dock.open.includes('actor'))

  const mainTokenId = mainToken?.id
  const keyboardSceneId = !dm ? scene?.id : undefined
  useEffect(() => {
    if (!mainTokenId || !keyboardSceneId) return
    const queue: Point[] = []
    let stepping = false
    let cancelled = false
    async function step() {
      stepping = true
      while (!cancelled && currentRoom().activeSceneId === keyboardSceneId && queue.length) {
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
  const shortcutState = useRef({ role, choosePanel })
  shortcutState.current = { role, choosePanel }
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(open => !open)
        return
      }
      if (event.defaultPrevented || document.querySelector('.scrim')) return
      if (event.key === 'Escape') {
        dispatchDock({ type: 'closeAll' })
        setDmCombat(false)
        setPlacing(undefined)
        setObjectPlacement(undefined)
        setPlacementPoint(undefined)
        clearArea()
        return
      }
      if (typingTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return
      const panel = panelForShortcut(event.key, shortcutState.current.role)
      if (panel?.inRail) {
        event.preventDefault()
        shortcutState.current.choosePanel(panel.id)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  const history = [...older.filter(roll => !room.rolls.some(current => current.id === roll.id)), ...room.rolls]
  const inviteLink = room.invite && location.origin + '/?invite=' + room.invite + '&room=' + room.id
  const dmInviteLink = room.dmInvite && location.origin + '/?invite=' + room.dmInvite + '&room=' + room.id + '&role=dm'
  const actorName = (id: string) => room.publicActors.find(item => item.id === id)?.name ?? 'ตัวละคร'
  const commandHere = (command: Command) => send({ ...command, sceneId: scene?.id })
  function showActor(id: string) {
    setSelected(id)
    openPanel('actor')
  }
  function saveToLibrary(value: Sheet) {
    setLibraryDraft(value)
    setLibrarySection('sheets')
    openPanel('library')
  }
  function openObjectLibrary() {
    setLibrarySection('objects')
    openPanel('library')
  }
  function hasMain(ownerId: string) {
    return Boolean(scene?.tokens.some(token => token.role === 'character' &&
      room.actors.some(actor => actor.id === token.actorId && actor.ownerId === ownerId)))
  }
  function beginPlace(value: TokenPlacement) {
    setObjectPlacement(undefined)
    if (placementPoint) {
      void placeToken(value, placementPoint).then(ok => {
        if (ok) { setPlacementPoint(undefined); closePanels() }
      })
    } else {
      setPlacing(value)
      closePanels()
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
  async function copyInvite() {
    if (!inviteLink) return
    try { await navigator.clipboard.writeText(inviteLink); setNotice('คัดลอกลิงก์แล้ว') }
    catch { setNotice('เลือกข้อความในช่องเพื่อคัดลอกลิงก์') }
  }
  const turnName = combat && actorName(combat.order[combat.turn].actorId)
  const recentRolls = room.rolls.slice(-5).reverse()
  const canPlace = dm && Boolean(scene)
  const preparing = Boolean(dm && scene && scene.id !== room.activeSceneId)
  const focusMain = () => mainToken && setCameraFocus(current => ({ actorId: mainToken.actorId, sequence: (current?.sequence ?? 0) + 1 }))

  const bodies: Record<PanelId, () => ReactNode> = {
    scenes: () => <>
      <div className="section-head"><h2>ฉาก</h2>{dm && <button aria-label="สร้างฉาก" onClick={() => setModal('createScene')}>+</button>}</div>
      {dm && <button className="demo-button" onClick={async () => {
        if (await send({ type: 'demoEncounter' })) switchView(currentRoom().scenes.at(-1)!.id)
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
            closePanels()
          } catch (error) { setError((error as Error).message) }
        }} /></label>
      </div>}
      {inviteLink && <details className="invite"><summary>เชิญผู้เล่น</summary><input aria-label="ลิงก์เชิญ" readOnly value={inviteLink} onFocus={e => e.target.select()} />
        <button onClick={() => void copyInvite()}>คัดลอก</button></details>}
      {dm && <details className="invite"><summary>เชิญ DM</summary>
        <button onClick={() => void send({ type: 'dmInvite' })}>{dmInviteLink ? 'ออกลิงก์ DM ใหม่' : 'สร้างลิงก์ DM'}</button>
        {dmInviteLink && <input aria-label="ลิงก์เชิญ DM" readOnly value={dmInviteLink} onFocus={event => event.currentTarget.select()} />}
      </details>}
      <p className="muted">{room.members.length} คน · {room.members.map(member => member.name).join(', ')}</p>
      <a className="home-link" href="/">กลับหน้าเปิดโต๊ะ</a>
    </>,
    objects: () => <>
      <div className="section-head"><h2>Object ในฉาก</h2>{dm && scene && <button onClick={() => setObjectImport({ sceneId: scene.id, point: { x: 2, y: 2 } })}>นำเข้า Object</button>}</div>
      <button className="library-shortcut" onClick={openObjectLibrary}>เปิดคลัง Object ส่วนตัว</button>
      {!scene?.objects?.length && <p className="muted">ยังไม่มี Object ในฉาก</p>}
      {scene?.objects?.map(item => <button className="scene-item" key={item.id} onClick={() => setObjectTarget(item.id)}>
        <span>{item.name}</span><small>{objectLabels[item.kind]}</small>
      </button>)}
    </>,
    sheets: () => <>
      {placementPoint && <p className="feedback">เลือกชีตหรือมอนสเตอร์เพื่อวางที่ช่อง {placementPoint.x}, {placementPoint.y}</p>}
      <div className="section-head"><h2>ชีต</h2><div className="inline">
        <button onClick={() => { setLibrarySection('sheets'); openPanel('library') }}>เปิดคลังชีต</button>
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
    </>,
    manual: () => <MonsterManual
      addTemplate={sheet => send({ type: 'template', sheet })}
      placeMonster={scene ? sheet => chooseToken({ sheet }) : undefined} />,
    library: () => <PersonalLibrary key={account?.email} useAccount={Boolean(account)} roomName={room.me.name} dm={dm} draft={libraryDraft} clearDraft={() => setLibraryDraft(undefined)}
      section={librarySection} selectSection={setLibrarySection} objectDraft={objectDraft} clearObjectDraft={() => setObjectDraft(undefined)}
      placeCharacter={scene ? value => chooseToken({ sheet: value }, value.name) : undefined}
      placeObject={dm && scene ? definition => {
        setPlacing(undefined)
        setObjectPlacement({ sceneId: scene.id, definition })
        closePanels()
      } : undefined}
      importSheet={value => send({ type: value.kind === 'monster' ? 'template' : 'sheet', kind: value.kind, sheet: value })} />,
    account: () => <div className="account-settings"><AccountPanel account={account} change={changeAccount} /></div>,
    combat: () => <>
      <div className="section-head"><h2>การต่อสู้</h2></div>
      {combat && <div className="encounter">
        <p>รอบ {combat.round}</p>
        {combat.order.map((entry, index) => <div key={entry.actorId} className={'turn ' + (index === combat.turn ? 'current' : '')}>
          <button onClick={() => room.actors.some(item => item.id === entry.actorId) && showActor(entry.actorId)}>{actorName(entry.actorId)}</button><b>{entry.initiative}</b>
        </div>)}
      </div>}
      {!combat && <p className="muted">ยังไม่มีการต่อสู้ในฉากนี้</p>}
    </>,
    actor: () => actor ? <section className="sheet-summary"><div className="section-head"><h2>{actor.name}</h2>
      <button onClick={() => setSheet({ initial: actor, actor })}>แก้ชีต</button></div>
      <button className="save-to-library" onClick={() => saveToLibrary(actor)}>คัดลอกเข้าคลังส่วนตัว</button>
      <InventoryPanel key={actor.id} actor={actor} send={send} />
      {actor.monsterReference && <details><summary>Stat block{actor.monsterReference.page && ' · SRD หน้า ' + actor.monsterReference.page}</summary><p className="stat-block">{actor.monsterReference.statBlock}</p></details>}
      <ActorActions key={actor.id} actor={actor} scene={scene} room={room} send={async value => {
        const ok = await send(value)
        if (ok && (value.type === 'sheetRoll' || value.type === 'castSave')) openPanel('dice', true)
        return ok
      }} />
    </section> : <p className="muted">เลือกตัวละครจากชีตในห้องหรือจาก Token บนกระดาน</p>,
    dice: () => <>
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
    </>
  }

  const roleDefs = panelsFor(role)
  const paletteCommands: PaletteCommand[] = [
    ...roleDefs.filter(panel => panel.inRail).map(panel => ({
      id: 'panel-' + panel.id, label: 'เปิด ' + panel.label, group: 'แผง · ' + groupLabels[panel.group],
      keywords: panel.keywords, shortcut: panel.shortcut, run: () => openPanel(panel.id)
    })),
    ...(dm ? [
      { id: 'create-scene', label: 'สร้างฉากใหม่', group: 'DM', keywords: 'scene new ฉาก', run: () => setModal('createScene') },
      ...(scene && preparing ? [{ id: 'publish', label: 'เปิดฉากนี้ให้ผู้เล่น', group: 'DM', keywords: 'publish activate show เปิด', run: () => void commandHere({ type: 'activate' }) }] : []),
      ...(scene ? [{ id: 'grid', label: 'ตั้งค่า Grid ของฉากนี้', group: 'DM', keywords: 'grid cell origin', run: () => setModal({ sceneId: scene.id }) }] : []),
      ...(scene?.tokens.length ? [{ id: 'combat', label: combat ? 'เปิดแผงต่อสู้' : 'เตรียมการต่อสู้', group: 'DM', keywords: 'combat initiative fight', run: () => openPanel('combat') }] : []),
      { id: 'demo', label: 'เพิ่ม Encounter ด่านร้างริมทาง', group: 'DM', keywords: 'demo encounter goblin', run: () => void send({ type: 'demoEncounter' }).then(ok => { if (ok) switchView(currentRoom().scenes.at(-1)!.id) }) },
      { id: 'private-roll', label: privateRoll ? 'เลิกทอยลับ' : 'ทอยลับ (เฉพาะ DM เห็น)', group: 'DM', keywords: 'private secret roll ลับ', run: () => setPrivateRoll(!privateRoll) }
    ] : []),
    { id: 'roll-d20', label: 'ทอย d20', group: 'ลูกเต๋า', keywords: 'roll dice', run: () => void send({ type: 'roll', formula: '1d20' }) },
    ...[4, 6, 8, 10, 12, 100].map(die => ({ id: 'roll-d' + die, label: 'ทอย d' + die, group: 'ลูกเต๋า', keywords: 'roll dice', run: () => void send({ type: 'roll', formula: '1d' + die }) })),
    ...(mainToken ? [{ id: 'focus-main', label: 'ไปที่ ' + actorName(mainToken.actorId), group: 'กระดาน', keywords: 'camera center main character ตัวหลัก', run: focusMain }] : []),
    ...(inviteLink ? [{ id: 'invite', label: 'คัดลอกลิงก์เชิญผู้เล่น', group: 'โต๊ะ', keywords: 'invite link share เชิญ', run: () => void copyInvite() }] : []),
    { id: 'close-panels', label: 'ปิดแผงทั้งหมด', group: 'โต๊ะ', keywords: 'close hide escape', shortcut: 'Esc', run: () => { dispatchDock({ type: 'closeAll' }); setDmCombat(false) } },
    { id: 'home', label: 'กลับหน้าแรก', group: 'โต๊ะ', keywords: 'home lobby leave ออก', run: () => { location.href = '/' } }
  ]

  return <main className={'table hud' + (combatOpen ? ' with-combat' : '') + (showTurnRail ? ' with-turn-rail' : '')}>
    <HudTopBar sceneName={scene?.name} roomName={room.name} preparing={preparing} live={Boolean(scene && scene.id === room.activeSceneId)}
      canPublish={preparing} publish={() => void commandHere({ type: 'activate' })}
      railOpen={railOpen} toggleRail={() => setRailOpen(open => !open)} openPalette={() => setPaletteOpen(true)}
      online={online} me={room.me.name} dm={dm} />
    <PanelRail items={roleDefs} isPressed={isPressed} choose={choosePanel} open={railOpen} />
    <Dock items={dock.open.map(id => ({ id, title: panelById(id).label, body: bodies[id]() }))}
      pinned={dock.pinned} pin={id => dispatchDock({ type: 'pin', id })} close={id => dispatchDock({ type: 'close', id })} />
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
            { label: 'วาง Token ที่นี่', run: () => { setPlacementPoint(point); openPanel('sheets') } },
            ...(canPlace ? [
              { label: 'นำเข้า Object ที่นี่', run: () => setObjectImport({ sceneId: scene.id, point }) },
              { label: 'เปิดคลัง Object ส่วนตัว', run: openObjectLibrary },
              { label: 'ตั้งค่า Grid', run: () => setModal({ sceneId: scene.id }) }
            ] : []),
            { label: 'เปิดลูกเต๋า', run: () => openPanel('dice') }
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
            { label: 'เปิดการต่อสู้', run: () => openPanel('combat') }
          ]
        }} />
        : <div className="empty"><p>{dm ? 'สร้างฉากเพื่อเริ่มจัดกระดาน' : 'รอ DM เปิดฉาก'}</p>
            {dm && <button className="primary" onClick={() => setModal('createScene')}>สร้างฉาก</button>}</div>}
      {(placing || placingObject) && <button className="cancel-placement" onClick={() => { setPlacing(undefined); setObjectPlacement(undefined) }}>ยกเลิกการวาง</button>}
      {!placing && !placingObject && <div className="board-status">
        {mainToken && <button className="main-token-control" title="คลิกเพื่อไปที่ตัวละครหลัก" onClick={focusMain}>
          <kbd>↑ ↓ ← →</kbd><span>{actorName(mainToken.actorId)}</span>
        </button>}
        {combat ? <button onClick={() => choosePanel('combat')}>รอบ {combat.round} · {turnName}</button>
          : dm && scene?.tokens.length ? <button onClick={() => choosePanel('combat')}>เตรียมการต่อสู้</button> : null}
      </div>}
      {(!dm || !hideTray) && <aside className="dice-tray" aria-label="ถาดผลเต๋า">
        <header><button onClick={() => choosePanel('dice')}>ผลทอยของโต๊ะ</button>
          {dm && <button aria-label="ปิดถาดผลเต๋าของฉัน" onClick={() => setHideTray(true)}>×</button>}</header>
        {recentRolls.length ? <ol aria-live="polite">{recentRolls.map(roll => <li key={roll.id}>
          <span><b>{roll.name}</b> · {roll.label}{roll.privateTo ? ' · ลับ' : ''}{roll.outcome ? ' · ' + roll.outcome : ''}</span><strong>{roll.total}</strong>
        </li>)}</ol> : <p>ยังไม่มีการทอย</p>}
      </aside>}
    </section>
    {scene && showTurnRail && <TurnRail scene={scene} room={room} focus={actorId => {
      if (menuOpen) closePanels()
      setCameraFocus(current => ({ actorId, sequence: (current?.sequence ?? 0) + 1 }))
    }} />}
    {combatOpen && <CombatPanel key={scene?.id} room={room} scene={scene} targetId={combatTarget} setTarget={setCombatTarget}
      shape={areaKind} preview={areaPreview} clearArea={clearArea}
      chooseArea={kind => { setAreaPreview(undefined); setAreaKind(kind) }}
      send={commandHere} close={() => setDmCombat(false)}
      advanced={(acting, target) => <ActorActions key={acting.id} actor={acting} room={room} scene={scene} send={commandHere} combatTarget={target} />} />}
    {(error || notice) && <div className="toast" role={error ? 'alert' : 'status'}>{error || notice}<button aria-label="ปิดข้อความ" onClick={clearMessages}>×</button></div>}
    {paletteOpen && <CommandPalette commands={paletteCommands} close={() => setPaletteOpen(false)} />}
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
    }).then(ok => { if (ok) { setSheet(undefined); openPanel('sheets') } })} />}
  </main>
}
