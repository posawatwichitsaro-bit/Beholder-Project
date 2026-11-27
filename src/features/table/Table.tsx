import { useEffect, useReducer, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { blankSheet, objectDefinition, objectLabels, objectOwner, tokenRoleLabels } from '../../../shared/model.ts'
import type { Actor, InventoryItem, ObjectDefinition, Roll, Scene, Sheet, Snapshot, Template, TokenRole } from '../../../shared/model.ts'
import type { Area, AreaKind } from '../../../shared/area.ts'
import { AccountPanel } from '../account/AccountPanel.tsx'
import { MonsterManual } from '../manual/MonsterManual.tsx'
import { ItemCatalogPicker } from '../items/ItemCatalogPicker.tsx'
import { loadMonsterCatalog } from '../manual/catalog.ts'
import { upgradeFromSrd } from '../../../shared/monsterManual.ts'
import { Board } from '../board/Board.tsx'
import { CombatPanel } from '../combat/CombatPanel.tsx'
import { DamageTypeSelect } from '../combat/CombatEffects.tsx'
import { InitiativeBar, TurnBanner } from '../combat/InitiativeBar.tsx'
import { DamageQueue } from '../combat/DamageQueue.tsx'
import { EffectsPanel, PendingSaves } from '../combat/EffectsPanel.tsx'
import { EncounterEnd } from '../combat/EncounterEnd.tsx'
import { SheetEditor } from '../sheets/SheetEditor.tsx'
import { ActorActions } from '../sheets/ActorActions.tsx'
import { SheetView } from '../sheets/SheetView.tsx'
import { CharacterWizard } from '../sheets/CharacterWizard.tsx'
import { AdventureLog } from '../dice/AdventureLog.tsx'
import { DiceReveal } from '../dice/DiceReveal.tsx'
import { DiceRoller } from '../dice/DiceRoller.tsx'
import { usePrefs } from '../../state/prefs.ts'
import { PersonalLibrary } from '../library/PersonalLibrary.tsx'
import { ObjectEditor, ObjectActions } from '../objects/Objects.tsx'
import { LootDialog } from '../objects/Inventory.tsx'
import { SceneForm, SceneOperationForm } from '../scenes/SceneForms.tsx'
import type { SceneOperation } from '../scenes/SceneForms.tsx'
import { ScenePanel } from '../scenes/ScenePanel.tsx'
import { GridCalibrator } from '../scenes/GridCalibrator.tsx'
import type { GridFit, MapRect } from '../scenes/gridFit.ts'
import { ManageScreen } from '../manage/ManageScreen.tsx'
import { SettingsPanel } from '../help/SettingsPanel.tsx'
import { Tour } from '../help/Tour.tsx'
import { tokenDragProps } from '../board/tokenDrag.ts'
import type { TokenDragPayload, TokenSource } from '../board/tokenDrag.ts'
import type { AccountProps } from '../entry/Entry.tsx'
import { HudTopBar } from '../shell/HudTopBar.tsx'
import { PanelRail } from '../shell/PanelRail.tsx'
import { Dock } from '../shell/Dock.tsx'
import { CommandPalette } from '../shell/CommandPalette.tsx'
import type { PaletteCommand } from '../shell/commands.ts'
import { dockReducer, emptyDock } from '../shell/dock.ts'
import { groupLabels, panelById, panelForShortcut, panelsFor } from '../shell/panelRegistry.ts'
import type { PanelId, Role } from '../shell/panelRegistry.ts'
import { api, json } from '../../lib/api.ts'
import { EmptyState, MoveHandle, useMovable } from '../../ui/index.ts'
import { readHpChange } from '../combat/hpChange.ts'
import { currentRoom, roomPath, useRoomStore } from '../../state/roomStore.ts'
import { refreshRoom, useRoomConnection } from '../../state/connection.ts'
import { sendCommand } from '../../state/useCommand.ts'
import type { Command } from '../../state/useCommand.ts'

type Point = { x: number; y: number }
type TokenPlacement = { sceneId: string; source: TokenSource; role?: TokenRole }
const arrowSteps: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }
}
/** The closest living creature on the other side from whoever's turn it is: the DM's default target. */
function nearestFoe(room: Snapshot, scene?: Scene) {
  const fight = scene?.combat
  const actingId = fight?.order[fight.turn]?.actorId
  const acting = room.publicActors.find(item => item.id === actingId)
  const from = scene?.tokens.find(token => token.actorId === actingId)
  if (!scene || !acting || !from) return undefined
  return scene.tokens.flatMap(token => {
    const other = room.publicActors.find(item => item.id === token.actorId)
    return other && other.hp > 0 && (other.kind === 'monster') !== (acting.kind === 'monster')
      ? [{ id: other.id, distance: Math.max(Math.abs(token.x - from.x), Math.abs(token.y - from.y)) }] : []
  }).sort((a, b) => a.distance - b.distance)[0]?.id
}
const signedBonus = (value: number) => (value >= 0 ? '+' : '') + value
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
  // Shown only when a command takes a moment, so quick clicks don't flicker.
  const pendingCount = useRoomStore(state => state.pending)
  const [sending, setSending] = useState(0)
  useEffect(() => {
    if (!pendingCount) { setSending(0); return }
    const timer = setTimeout(() => setSending(useRoomStore.getState().pending), 350)
    return () => clearTimeout(timer)
  }, [pendingCount])
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
  const [conditionTarget, setConditionTarget] = useState<string>()
  const [objectImport, setObjectImport] = useState<{ sceneId: string; point: Point }>()
  const [objectTarget, setObjectTarget] = useState<string>()
  const [lootTarget, setLootTarget] = useState<string>()
  const [hideTray, setHideTray] = useState(false)
  const [placementPoint, setPlacementPoint] = useState<Point>()
  const [focusScene, setFocusScene] = useState('')
  const [selected, setSelected] = useState('')
  /** The token picked on the board. Separate from `selected` (the sheet shown) so clicking an enemy keeps your own sheet open. */
  const [boardSelected, setBoardSelected] = useState('')
  /** A player's attack target, set by clicking a creature on the board or picking it on the sheet. */
  const [attackTarget, setAttackTarget] = useState('')
  const [modal, setModal] = useState<'createScene' | { sceneId: string }>()
  const [sceneOperation, setSceneOperation] = useState<SceneOperation>()
  const [sheet, setSheet] = useState<{ initial: Sheet; actor?: Actor; template?: Template; asTemplate?: boolean; report?: string[] }>()
  const [wizard, setWizard] = useState(false)
  const [tokenPlacement, setPlacing] = useState<TokenPlacement>()
  const [objectPlacement, setObjectPlacement] = useState<{ sceneId: string; definition: ObjectDefinition }>()
  /** A catalog item waiting for a click on the map (anyone; it lands as a temp item). */
  const [itemPlacement, setItemPlacement] = useState<{ sceneId: string; item: Omit<InventoryItem, 'id'> }>()
  const [combatTarget, setCombatTarget] = useState('')
  const [cameraFocus, setCameraFocus] = useState<{ actorId: string; sequence: number }>()
  const [areaKind, setAreaKind] = useState<AreaKind>()
  const [areaPreview, setAreaPreview] = useState<Area>()
  const [amounts, setAmounts] = useState<Record<string, number>>({})
  const [older, setOlder] = useState<Roll[]>([])
  const [historyEnded, setHistoryEnded] = useState(false)
  const [saveProficiency, setSaveProficiency] = useState<Record<string, boolean>>({})
  const [calibrating, setCalibrating] = useState<{ sceneId: string; rect?: MapRect }>()
  const [gridPreview, setGridPreview] = useState<GridFit>()
  const [manageOpen, setManageOpen] = useState(false)
  const [touring, setTouring] = useState(false)
  const trayMovable = useMovable('dice-tray')
  const copyingBoard = useRef<Promise<boolean>>(undefined)
  const dm = room.me.role === 'dm'
  const role: Role = dm ? 'dm' : 'player'
  const published = room.scenes.find(item => item.id === room.activeSceneId)
  const scene = (dm && focusScene ? room.scenes.find(item => item.id === focusScene) : undefined) ?? published
  const placingObject = objectPlacement?.sceneId === scene?.id ? objectPlacement?.definition : undefined
  const placing = tokenPlacement?.sceneId === scene?.id ? tokenPlacement : undefined
  const placingItem = itemPlacement && itemPlacement.sceneId === scene?.id ? itemPlacement.item : undefined
  const mainToken = !dm ? scene?.tokens.find(token => token.role === 'character' && room.actors.some(actor => actor.id === token.actorId)) : undefined
  const editingScene = typeof modal === 'object' ? room.scenes.find(item => item.id === modal.sceneId) : undefined
  const actor = room.actors.find(item => item.id === selected)
  const hpActor = room.actors.find(item => item.id === hpTarget)
  const conditionCreature = room.publicActors.find(item => item.id === conditionTarget)
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
  // Notices fade after a few seconds; errors stay until dismissed.
  useEffect(() => {
    if (!notice || error) return
    const timer = setTimeout(() => { if (!useRoomStore.getState().error) useRoomStore.getState().setNotice('') }, 6000)
    return () => clearTimeout(timer)
  }, [notice, error])
  // First visit as this role on this device: show the tour once.
  useEffect(() => { if (!usePrefs.getState().tourSeen[role]) setTouring(true) }, [role])
  function endTour() {
    setTouring(false)
    usePrefs.getState().update({ tourSeen: { ...usePrefs.getState().tourSeen, [role]: true } })
  }

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
  const ownedHere = !dm ? room.actors.filter(item => scene?.tokens.some(token => token.actorId === item.id)) : []
  const attacker = ownedHere.find(item => item.id === combat?.order[combat.turn]?.actorId)
    ?? ownedHere.find(item => item.id === mainToken?.actorId) ?? ownedHere[0]
  function attackWith(target: string, weaponIndex?: number) {
    if (!attacker) return
    setAttackTarget(target)
    void commandHere({ type: 'sheetRoll', rollType: 'attack', actorId: attacker.id, targetId: target, weaponIndex })
  }
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
    setObjectTarget(undefined); setLootTarget(undefined); setObjectImport(undefined); setObjectPlacement(undefined); setItemPlacement(undefined)
  }
  function clearArea() { setAreaKind(undefined); setAreaPreview(undefined) }
  useEffect(() => { setOlder([]); setHistoryEnded(false) }, [room.activeSceneId])
  useEffect(() => { setCombatTarget(nearestFoe(room, scene) ?? ''); clearArea() }, [scene?.id, combat?.round, combat?.turn])
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
        setItemPlacement(undefined)
        setPlacementPoint(undefined)
        clearArea()
        setCalibrating(undefined)
        setGridPreview(undefined)
        return
      }
      if (typingTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return
      if (shortcutState.current.role === 'dm' && event.key.toLowerCase() === 'm') {
        event.preventDefault()
        setManageOpen(true)
        return
      }
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
  function copyBoard(tokenIds: string[], objectIds: string[]) {
    clearMessages()
    copyingBoard.current = api<{ copied: number; skipped: number }>(base + '/clipboard', json({ sceneId: scene?.id, tokenIds, objectIds }))
      .then(({ copied, skipped }) => {
        setNotice('คัดลอก ' + copied + ' ชิ้น' + (skipped ? ' · ข้าม ' + skipped + ' ชิ้น' : ''))
        return true
      })
      .catch(problem => {
        setError(problem instanceof Error ? problem.message : 'คัดลอกไม่สำเร็จ')
        return false
      })
  }
  async function pasteBoard(position?: Point) {
    if (!position) { setNotice('ชี้เมาส์บนกระดานก่อนวาง'); return }
    if (copyingBoard.current && !await copyingBoard.current) return
    const ok = await commandHere({ type: 'pasteBoard', ...position })
    if (ok) setNotice('วางสำเนา Temp แล้ว')
  }
  function showActor(id: string) {
    setSelected(id)
    setBoardSelected(id)
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
  const placeToken = async (value: TokenPlacement, point: Point) => {
    const ok = await send({ type: 'place', sceneId: value.sceneId, ...value.source, kind: 'sheet' in value.source ? value.source.sheet.kind : undefined, role: value.role, ...point })
    if (ok && value.role === 'companion') setNotice('วางเป็น Companion Token แล้ว · เปลี่ยนเป็นตัวหลักได้จากแถบคำสั่งของ Token')
    return ok
  }
  /** A player's first character in a scene becomes their main token; later ones are companions. */
  function placementFor(source: TokenSource, name?: string, ownerId = room.me.id): TokenPlacement | undefined {
    if (!scene) return undefined
    return { sceneId: scene.id, source, role: name !== undefined ? hasMain(ownerId) ? 'companion' : 'character' : undefined }
  }
  function chooseToken(source: TokenSource, name?: string, ownerId = room.me.id) {
    const placement = placementFor(source, name, ownerId)
    if (placement) beginPlace(placement)
  }
  function dropToken(payload: TokenDragPayload, point: Point) {
    const placement = placementFor(payload.source, payload.name, payload.ownerId)
    if (!placement) return
    setPlacing(undefined)
    setPlacementPoint(undefined)
    void placeToken(placement, point)
  }
  /** Bring room monster templates up to the current SRD sheets (only ones that match an SRD monster). */
  async function upgradeTemplates(list: Template[]) {
    try {
      const catalog = await loadMonsterCatalog()
      let done = 0
      for (const template of list) {
        const sheet = upgradeFromSrd(template.sheet, catalog)
        if (sheet && await send({ type: 'template', templateId: template.id, sheet })) done++
      }
      setNotice(done ? 'อัปเดตจาก SRD แล้ว ' + done + ' ต้นแบบ' : 'ไม่พบต้นแบบที่ตรงกับมอนสเตอร์ใน SRD')
    } catch (error) { setError((error as Error).message) }
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

  async function uploadMap(target: Scene, file: File) {
    try {
      await api(base + '/scenes/' + target.id + '/map', { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      await refresh()
      closePanels()
    } catch (error) { setError((error as Error).message) }
  }
  /** Line the grid up on the map: show the scene, close panels so the map is free, and wait for a drag. */
  function beginCalibration(target: Scene) {
    switchView(target.id)
    closePanels()
    setManageOpen(false)
    setGridPreview(undefined)
    setCalibrating({ sceneId: target.id })
  }
  function endCalibration() { setCalibrating(undefined); setGridPreview(undefined) }
  const calibratingScene = dm && calibrating?.sceneId === scene?.id ? scene : undefined

  const bodies: Record<PanelId, () => ReactNode> = {
    scenes: () => <ScenePanel room={room} scene={scene} send={send} commandHere={commandHere} switchView={switchView}
 createScene={() => setModal('createScene')} editGrid={item => setModal({ sceneId: item.id })}
      calibrateGrid={beginCalibration} copyScene={item => setSceneOperation({ mode: 'copy', scene: item })}
      deleteScene={item => setSceneOperation({ mode: 'delete', scene: item })} uploadMap={uploadMap}
      inviteLink={inviteLink} dmInviteLink={dmInviteLink} copyInvite={() => void copyInvite()} />,
    objects: () => <>
      <div className="section-head"><h2>Object ในฉาก</h2>{dm && scene && <button onClick={() => setObjectImport({ sceneId: scene.id, point: { x: 2, y: 2 } })}>นำเข้า Object</button>}</div>
      <button className="library-shortcut" onClick={openObjectLibrary}>เปิดคลัง Object ส่วนตัว</button>
      {!scene?.objects?.length && <EmptyState title="ยังไม่มี Object ในฉาก"
        hint={dm ? 'คลิกขวาที่ช่องบนกระดานแล้วเลือก “นำเข้า Object ที่นี่” หรือวางจากคลังส่วนตัว' : 'กล่อง ประตู และสิ่งของที่ DM วางในฉากจะแสดงที่นี่'} />}
      {scene?.objects?.map(item => <button className="scene-item" key={item.id} onClick={() => setObjectTarget(item.id)}>
        <span>{item.name}</span><small>{objectLabels[item.kind]}</small>
      </button>)}
    </>,
    sheets: () => <>
      {placementPoint && <p className="feedback">เลือกชีตหรือมอนสเตอร์เพื่อวางที่ช่อง {placementPoint.x}, {placementPoint.y}</p>}
      <div className="section-head"><h2>ชีต</h2><div className="inline">
        <button onClick={() => { setLibrarySection('sheets'); openPanel('library') }}>เปิดคลังชีต</button>
        <button onClick={() => setWizard(true)}>+ ตัวละคร</button>
      </div></div>
      {!room.actors.length && <EmptyState title="ยังไม่มีชีตในห้อง"
        hint={dm ? 'สร้างมอนสเตอร์จาก “+ ต้นแบบ” ด้านล่าง หรือค้นใน Monster Manual (N)' : 'กด “+ ตัวละคร” เพื่อสร้างทีละขั้น หรือเปิดคลังชีตเพื่อใช้ตัวละครเดิม'} />}
      {room.actors.map(item => {
        const token = scene?.tokens.find(token => token.actorId === item.id)
        const roleLabel = token?.role && tokenRoleLabels[token.role]
        return <div className="actor-item" key={item.id}
          {...(scene && !token ? tokenDragProps({ source: { actorId: item.id }, name: item.kind === 'pc' ? item.name : undefined, ownerId: item.ownerId }) : {})}>
          <button className={selected === item.id ? 'selected' : ''} aria-label={item.name} aria-description={roleLabel}
            onClick={() => showActor(item.id)}>{item.name}{roleLabel && <small className="actor-token-role" aria-hidden="true">{roleLabel}</small>}</button>
          {scene && <button aria-label={'วาง ' + item.name} disabled={Boolean(token)}
            onClick={() => chooseToken({ actorId: item.id }, item.kind === 'pc' ? item.name : undefined, item.ownerId)}>วาง</button>}
        </div>
      })}
      {dm && <><div className="section-head"><h2>มอนสเตอร์</h2><div className="inline">
        {room.templates.length > 0 && <button title="ดึงค่าสเตตัส เซฟ สกิล การโจมตี และภาพล่าสุดจาก SRD · ชื่อและของที่ตั้งไว้ยังอยู่ · Token ที่วางแล้วไม่เปลี่ยน"
          onClick={() => void upgradeTemplates(room.templates)}>อัปเดตทั้งหมดจาก SRD</button>}
        <button onClick={() => setSheet({ initial: blankSheet('monster'), asTemplate: true })}>+ ต้นแบบ</button></div></div>
        {!room.templates.length && <EmptyState title="ยังไม่มีต้นแบบมอนสเตอร์" hint="ค้นจาก Monster Manual (N) แล้วบันทึกเป็นต้นแบบ หรือกด “+ ต้นแบบ” เพื่อเขียนเอง" />}
        {room.templates.map(item => <div className="actor-item" key={item.id} {...(scene ? tokenDragProps({ source: { templateId: item.id } }) : {})}>
          <button onClick={() => setSheet({ initial: item.sheet, template: item, asTemplate: true })}>{item.sheet.name}</button>
          <button aria-label={'อัปเดต ' + item.sheet.name + ' จาก SRD'} title="อัปเดตจาก SRD" onClick={() => void upgradeTemplates([item])}>↻</button>
          {scene && <button onClick={() => chooseToken({ templateId: item.id })}>วาง</button>}
        </div>)}</>}
    </>,
    items: () => <ItemCatalogPicker actionLabel={scene ? 'วางบนฉาก' : 'เปิดฉากก่อนวางไอเทม'} close={closePanels}
      choose={item => {
        if (!scene) return false
        setPlacing(undefined); setObjectPlacement(undefined)
        setItemPlacement({ sceneId: scene.id, item })
        closePanels()
        return true
      }} />,
    manual: () => <MonsterManual
      addTemplate={dm ? sheet => send({ type: 'template', sheet }) : undefined}
      placeMonster={scene ? sheet => chooseToken({ sheet }) : undefined}
      dragMonster={scene ? sheet => tokenDragProps({ source: { sheet } }) : undefined} />,
    library: () => <PersonalLibrary key={account?.email} useAccount={Boolean(account)} roomName={room.me.name} dm={dm} draft={libraryDraft} clearDraft={() => setLibraryDraft(undefined)}
      accountForm={<AccountPanel account={account} change={changeAccount} initialMode="register" />}
      section={librarySection} selectSection={setLibrarySection} objectDraft={objectDraft} clearObjectDraft={() => setObjectDraft(undefined)}
      placeCharacter={scene ? value => chooseToken({ sheet: value }, value.name) : undefined}
      dragCharacter={scene ? value => tokenDragProps({ source: { sheet: value }, name: value.name }) : undefined}
      placeObject={dm && scene ? definition => {
        setPlacing(undefined)
        setObjectPlacement({ sceneId: scene.id, definition })
        closePanels()
      } : undefined}
      importSheet={value => send({ type: value.kind === 'monster' ? 'template' : 'sheet', kind: value.kind, sheet: value })} />,
    account: () => <div className="account-settings"><AccountPanel account={account} change={changeAccount} /></div>,
    settings: () => <SettingsPanel role={role} replayTour={() => { closePanels(); setManageOpen(false); setTouring(true) }} />,
    combat: () => <>
      <div className="section-head"><h2>การต่อสู้</h2></div>
      {combat && <div className="encounter">
        <p>รอบ {combat.round}</p>
        {combat.order.map((entry, index) => <div key={entry.actorId} className={'turn ' + (index === combat.turn ? 'current' : '')}>
          <button onClick={() => room.actors.some(item => item.id === entry.actorId) && showActor(entry.actorId)}>{actorName(entry.actorId)}</button><b>{entry.initiative}</b>
        </div>)}
      </div>}
      {!combat && <EmptyState title="ยังไม่มีการต่อสู้ในฉากนี้" hint="เมื่อ DM เริ่มการต่อสู้ ลำดับเทิร์นจะขึ้นที่ด้านบนของกระดาน และจะมีป้ายบอกเมื่อถึงเทิร์นของคุณ" />}
    </>,
    actor: () => actor ? <SheetView key={actor.id} actor={actor} scene={scene} room={room} preferredTarget={attackTarget} chooseTarget={setAttackTarget}
      edit={() => setSheet({ initial: actor, actor })} copy={() => saveToLibrary(actor)}
      send={send} /> : <EmptyState title="ยังไม่ได้เลือกตัวละคร" hint="เลือกจากชีตในห้อง (T) หรือคลิก Token บนกระดาน" />,
    log: () => <AdventureLog room={room} send={send} />,
    dice: () => <>
      <div className="section-head"><h2>ผลทอย</h2></div>
      {dm && <div className="dice-settings">
        <label className="inline"><input type="checkbox" checked={privateRoll} onChange={event => setPrivateRoll(event.target.checked)} />ทอยลับสำหรับ DM คนนี้</label>
        {hideTray && <button onClick={() => setHideTray(false)}>แสดงถาดผลเต๋า</button>}
      </div>}
      <DiceRoller send={send} rolls={history} me={room.me.name} />
      <ol className="rolls">{[...history].reverse().map(roll => <li key={roll.id}>
        <div><small>{roll.name} · {roll.label}</small><br /><span>{roll.formula}{roll.faces.length > 0 && ' · [' + roll.faces.join(', ') + ']'}{roll.modifier ? ' ' + (roll.modifier > 0 ? '+' : '') + roll.modifier : ''}</span>
          {roll.outcome && <small> · {roll.outcome}</small>}{roll.applied === false && <small className="roll-waiting"> · รอ DM ยืนยัน</small>}</div><strong>{roll.total}</strong>
        {roll.cast && !roll.cast.resolved && !dm && room.actors.some(item => item.id === roll.targetId) && <div className="inline damage">
          <label><input type="checkbox" checked={saveProficiency[roll.id] ?? false}
            onChange={event => setSaveProficiency({ ...saveProficiency, [roll.id]: event.target.checked })} />Proficient</label>
          <button onClick={() => void commandHere({ type: 'spellSave', rollId: roll.id, proficient: saveProficiency[roll.id] })}>ทอยให้ {actorName(roll.cast.targetId)}</button>
        </div>}
        {dm && roll.targetId && roll.applied === false && <small className="pending-note">รอยืนยันในคิว “รอการตัดสิน”</small>}
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
  /** DM: player characters with a main token in another scene but none in the scene on screen. */
  const partyMissing = dm && scene ? room.actors.filter(item => item.kind === 'pc' && !scene.tokens.some(token => token.actorId === item.id)
    && room.scenes.some(other => other.id !== scene.id && other.tokens.some(token => token.actorId === item.id && token.role === 'character'))) : []
  /** Player characters with a token in the scene on screen: who a party rest covers. */
  const partyIds = room.actors.filter(item => item.kind === 'pc' && scene?.tokens.some(token => token.actorId === item.id)).map(item => item.id).slice(0, 12)
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
      { id: 'manage', label: 'เปิดห้องเก็บของ DM', group: 'DM', keywords: 'manage token item loot scene จัดการ', shortcut: 'M', run: () => setManageOpen(true) },
      ...(scene?.map ? [{ id: 'calibrate', label: 'ปรับ Grid บนภาพ', group: 'DM', keywords: 'grid calibrate align map ปรับ', run: () => beginCalibration(scene) }] : []),
      ...(partyIds.length ? [
        { id: 'short-rest-party', label: 'พักสั้นทั้งกลุ่ม (Short Rest)', group: 'DM', keywords: 'rest short party พัก', run: () => void send({ type: 'rest', actorIds: partyIds, kind: 'short' }) },
        { id: 'long-rest-party', label: 'พักยาวทั้งกลุ่ม (Long Rest)', group: 'DM', keywords: 'rest long party พัก นอน', run: () => void send({ type: 'rest', actorIds: partyIds, kind: 'long' }) }
      ] : []),
      ...(partyMissing.length ? [{ id: 'bring-party', label: 'พาผู้เล่นมาฉากนี้ (' + partyMissing.length + ')', group: 'DM', keywords: 'party move bring scene พา ย้าย กลุ่ม', run: () => void commandHere({ type: 'bringParty' }) }] : []),
      { id: 'private-roll', label: privateRoll ? 'เลิกทอยลับ' : 'ทอยลับ (เฉพาะ DM เห็น)', group: 'DM', keywords: 'private secret roll ลับ', run: () => setPrivateRoll(!privateRoll) }
    ] : []),
    { id: 'roll-d20', label: 'ทอย d20', group: 'ลูกเต๋า', keywords: 'roll dice', run: () => void send({ type: 'roll', formula: '1d20' }) },
    { id: 'sound', label: usePrefs.getState().sound ? 'ปิดเสียงลูกเต๋า' : 'เปิดเสียงลูกเต๋า', group: 'ลูกเต๋า', keywords: 'sound mute audio เสียง',
      run: () => usePrefs.getState().setSound(!usePrefs.getState().sound) },
    ...[4, 6, 8, 10, 12, 100].map(die => ({ id: 'roll-d' + die, label: 'ทอย d' + die, group: 'ลูกเต๋า', keywords: 'roll dice', run: () => void send({ type: 'roll', formula: '1d' + die }) })),
    ...(mainToken ? [{ id: 'focus-main', label: 'ไปที่ ' + actorName(mainToken.actorId), group: 'กระดาน', keywords: 'camera center main character ตัวหลัก', run: focusMain }] : []),
    ...(inviteLink ? [{ id: 'invite', label: 'คัดลอกลิงก์เชิญผู้เล่น', group: 'โต๊ะ', keywords: 'invite link share เชิญ', run: () => void copyInvite() }] : []),
    { id: 'reset-ui', label: 'รีเซ็ตตำแหน่ง UI', group: 'โต๊ะ', keywords: 'reset layout ui move position รีเซ็ต ย้าย', run: () => usePrefs.getState().update({ layout: {} }) },
    { id: 'close-panels', label: 'ปิดแผงทั้งหมด', group: 'โต๊ะ', keywords: 'close hide escape', shortcut: 'Esc', run: () => { dispatchDock({ type: 'closeAll' }); setDmCombat(false) } },
    { id: 'tour', label: 'เริ่มทัวร์แนะนำ', group: 'ช่วยเหลือ', keywords: 'tour help guide ทัวร์ ช่วยเหลือ วิธีใช้', run: () => { closePanels(); setManageOpen(false); setTouring(true) } },
    { id: 'home', label: 'กลับหน้าแรก', group: 'โต๊ะ', keywords: 'home lobby leave ออก', run: () => { location.href = '/' } }
  ]

  return <main className={'table hud' + (combatOpen ? ' with-combat' : '') + (showTurnRail ? ' in-combat' : '')}>
    <HudTopBar sceneName={scene?.name} roomName={room.name} preparing={preparing} live={Boolean(scene && scene.id === room.activeSceneId)}
      canPublish={preparing} publish={() => void commandHere({ type: 'activate' })}
      railOpen={railOpen} toggleRail={() => setRailOpen(open => !open)} openPalette={() => setPaletteOpen(true)}
      openManage={dm ? () => setManageOpen(true) : undefined} bringParty={partyMissing.length ? { names: partyMissing.map(item => item.name), run: () => void commandHere({ type: 'bringParty' }) } : undefined} online={online} me={room.me.name} dm={dm} />
    <PanelRail items={roleDefs} isPressed={isPressed} choose={choosePanel} open={railOpen} />
    <Dock items={dock.open.map(id => ({ id, title: panelById(id).label, body: bodies[id]() }))}
      pinned={dock.pinned} pin={id => dispatchDock({ type: 'pin', id })} close={id => dispatchDock({ type: 'close', id })} />
    <section className="workspace" aria-label="ฉากปัจจุบัน">
      {scene ? <Board key={scene.id} scene={scene} room={room} selected={boardSelected} targetId={combatOpen ? combatTarget : attackTarget || undefined}
        mainTokenId={mainTokenId}
        quickHp={dm ? async (actorId, text) => {
          const change = readHpChange(text)
          if (!change) { setError('ใส่ตัวเลข เช่น 8 เพื่อรักษา หรือ -15 เพื่อลด HP'); return false }
          return commandHere({ type: 'adjustHp', actorId, ...change })
        } : undefined}
        calibrate={calibratingScene ? rect => setCalibrating({ sceneId: calibratingScene.id, rect }) : undefined}
        gridOverride={calibratingScene ? gridPreview : undefined}
        focus={cameraFocus} areaKind={combatOpen ? areaKind : undefined} preview={combatOpen ? areaPreview : undefined}
        onArea={area => { setAreaPreview(area); setAreaKind(undefined) }}
        select={value => {
          if (combatOpen && combat) {
            setCombatTarget(value === combat.order[combat.turn].actorId ? '' : value)
            return
          }
          setBoardSelected(value)
          // Your own creature opens its sheet; anyone else's becomes the attack target and your sheet stays.
          if (!value || room.actors.some(item => item.id === value)) setSelected(value)
          if (value && !dm && !room.actors.some(item => item.id === value)) setAttackTarget(value)
        }}
        move={(tokenIds, delta) => void commandHere({ type: 'moveTokens', tokenIds, dx: delta.x, dy: delta.y })}
        copy={copyBoard} paste={position => void pasteBoard(position)}
        drop={dropToken}
        moveObject={(objectId, position) => void commandHere({ type: 'moveObject', objectId, ...position })}
        place={placingItem ? point => void commandHere({ type: 'placeItem', item: placingItem, ...point })
          .then(ok => { if (ok) setItemPlacement(undefined) })
          : placingObject ? point => void commandHere({ type: 'importObject', definition: placingObject, ...point })
          .then(ok => { if (ok) setObjectPlacement(undefined) })
          : placing && (point => void placeToken(placing, point).then(ok => { if (ok) setPlacing(undefined) }))}
        placementLabel={placingItem ? 'คลิกช่องเพื่อวาง ' + placingItem.name : placingObject && 'คลิกช่องเพื่อวาง ' + placingObject.name}
        actions={(token, point, object) => {
          if (object) return [
            { label: 'โต้ตอบกับ Object', run: () => setObjectTarget(object.id) },
            ...(objectOwner(object, room.members) === room.me.id ? [{
              label: object.copyShared ? 'ปิดสิทธิ์คัดลอก' : 'อนุญาตให้คนในห้องคัดลอก',
              run: () => void commandHere({ type: 'boardCopySharing', objectId: object.id, shared: !object.copyShared })
            }] : [])
          ]
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
          const foe = room.publicActors.find(item => item.id === token.actorId && item.kind === 'monster' && item.hp > 0)
          // A player attacks a monster straight from its token: main attack plus up to two more.
          const attackActions = !dm && attacker && foe ? [
            { label: 'โจมตีด้วย ' + attacker.name + ' (' + signedBonus(attacker.attack) + ')', run: () => attackWith(foe.id) },
            ...(attacker.attacks ?? []).slice(0, 2).map((attack, index) => ({
              label: attack.name + ' (' + signedBonus(attack.bonus) + ')', run: () => attackWith(foe.id, index)
            }))
          ] : []
          return [
            ...attackActions,
            ...(lootable ? [{ label: lootable.lootResult ? 'ดูผลค้นศพ' : 'ค้นศพ / Loot', run: () => setLootTarget(token.actorId) }] : []),
            ...(accessible ? [{ label: 'เปิดชีต', run: () => showActor(accessible.id) }] : []),
            { label: 'Condition', run: () => setConditionTarget(token.actorId) },
            ...(accessible?.ownerId === room.me.id && token.role !== 'character' ? [{
              label: token.copyShared ? 'ปิดสิทธิ์คัดลอก' : 'อนุญาตให้คนในห้องคัดลอก',
              run: () => void commandHere({ type: 'boardCopySharing', tokenId: token.id, shared: !token.copyShared })
            }] : []),
            ...(accessible?.kind === 'pc' && !accessible.temp && token.role ? [{
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
        : <div className="empty">{dm
          ? <EmptyState title="สร้างฉากเพื่อเริ่มจัดกระดาน" hint="ตั้งชื่อฉาก อัปโหลดแผนที่ แล้ววาง Token ผู้เล่นและมอนสเตอร์จาก Monster Manual">
              <button className="primary" onClick={() => setModal('createScene')}>สร้างฉาก</button>
            </EmptyState>
          : <EmptyState title="รอ DM เปิดฉาก" hint="ระหว่างนี้สร้างตัวละครไว้ก่อนได้ พอ DM เปิดฉากแล้วค่อยลากลงกระดาน">
              <button className="primary" onClick={() => setWizard(true)}>สร้างตัวละคร</button>
            </EmptyState>}</div>}
      {(placing || placingObject || placingItem) && <button className="cancel-placement" onClick={() => { setPlacing(undefined); setObjectPlacement(undefined); setItemPlacement(undefined) }}>ยกเลิกการวาง</button>}
      {!placing && !placingObject && !placingItem && <div className="board-status">
        {mainToken && <button className="main-token-control" title="คลิกเพื่อไปที่ตัวละครหลัก" onClick={focusMain}>
          <kbd>↑ ↓ ← →</kbd><span>{actorName(mainToken.actorId)}</span>
        </button>}
        {combat ? <button onClick={() => choosePanel('combat')}>รอบ {combat.round} · {turnName}</button>
          : dm && scene?.tokens.length ? <button onClick={() => choosePanel('combat')}>เตรียมการต่อสู้</button> : null}
      </div>}
      {(!dm || !hideTray) && <aside className="dice-tray" aria-label="ถาดผลเต๋า" {...trayMovable}>
        <header><MoveHandle id="dice-tray" label="ถาดผลเต๋า" /><button onClick={() => choosePanel('dice')}>ผลทอยของโต๊ะ</button>
          {dm && <button aria-label="ปิดถาดผลเต๋าของฉัน" onClick={() => setHideTray(true)}>×</button>}</header>
        {recentRolls.length ? <ol aria-live="polite">{recentRolls.map(roll => <li key={roll.id}>
          <span><b>{roll.name}</b> · {roll.label}{roll.privateTo ? ' · ลับ' : ''}{roll.outcome ? ' · ' + roll.outcome : ''}{roll.applied === false ? ' · รอ DM ยืนยัน' : ''}</span><strong>{roll.total}</strong>
        </li>)}</ol> : <p>ยังไม่มีการทอย · กด D เพื่อเปิดลูกเต๋า</p>}
      </aside>}
      <DiceReveal rolls={room.rolls} />
      {scene && showTurnRail && <InitiativeBar scene={scene} room={room} send={commandHere} focus={actorId => {
        if (menuOpen) closePanels()
        setCameraFocus(current => ({ actorId, sequence: (current?.sequence ?? 0) + 1 }))
      }} />}
      {scene?.combat && scene.id === room.activeSceneId && <TurnBanner scene={scene} room={room} send={commandHere} />}
      <DamageQueue room={room} send={send} />
      <EncounterEnd scene={scene} />
      <PendingSaves room={room} send={commandHere} />
      {calibratingScene && <GridCalibrator key={calibratingScene.id} scene={calibratingScene} rect={calibrating?.rect} preview={setGridPreview} cancel={endCalibration}
        save={async fit => {
          const ok = await send({ type: 'scene', sceneId: calibratingScene.id, name: calibratingScene.name, ...fit })
          if (ok) { endCalibration(); setNotice('บันทึก Grid ของ ' + calibratingScene.name + ' แล้ว') }
          return ok
        }} />}
    </section>
    {combatOpen && <CombatPanel key={scene?.id} room={room} scene={scene} targetId={combatTarget} setTarget={setCombatTarget}
      shape={areaKind} preview={areaPreview} clearArea={clearArea}
      chooseArea={kind => { setAreaPreview(undefined); setAreaKind(kind) }}
      send={commandHere} close={() => setDmCombat(false)}
      advanced={(acting, target) => <ActorActions key={acting.id} actor={acting} room={room} scene={scene} send={commandHere} combatTarget={target} />} />}
    {sending && <div className="send-status" aria-live="polite">กำลังส่ง…{sending > 1 ? ` (${sending})` : ''}</div>}
    {(error || notice) && <div className="toast" role={error ? 'alert' : 'status'}>{error || notice}<button aria-label="ปิดข้อความ" onClick={clearMessages}>×</button></div>}
    {manageOpen && dm && <ManageScreen room={room} send={send} close={() => setManageOpen(false)}
      openSheet={target => { setManageOpen(false); showActor(target.id) }}
      goTo={(sceneId, actorId) => {
        setManageOpen(false)
        switchView(sceneId)
        setSelected(actorId)
        setCameraFocus(current => ({ actorId, sequence: (current?.sequence ?? 0) + 1 }))
      }}
      viewScene={sceneId => { setManageOpen(false); switchView(sceneId) }}
      copyScene={item => setSceneOperation({ mode: 'copy', scene: item })}
      deleteScene={item => setSceneOperation({ mode: 'delete', scene: item })} />}
    {touring && <Tour key={role} role={role} close={endTour} />}
    {conditionCreature && <EffectsPanel key={conditionCreature.id} room={room} creature={conditionCreature} send={commandHere} close={() => setConditionTarget(undefined)}
      sources={(dm ? room.publicActors : room.actors).filter(item => scene?.tokens.some(token => token.actorId === item.id)).map(item => ({ id: item.id, name: item.name }))} />}
    {paletteOpen && <CommandPalette commands={paletteCommands} close={() => setPaletteOpen(false)} />}
    {(modal === 'createScene' || editingScene) && <SceneForm scene={editingScene} save={send} cancel={() => setModal(undefined)} />}
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
      const text = String(form.get('amount'))
      if (form.get('mode') === 'temp') {
        const amount = readHpChange(text)?.amount
        if (amount && await commandHere({ type: 'adjustHp', actorId: hpActor.id, amount, mode: 'temp' })) setHpTarget(undefined)
        return
      }
      const change = readHpChange(text)
      if (!change) { setError('ใส่ตัวเลข เช่น 8 เพื่อรักษา หรือ -15 เพื่อลด HP'); return }
      if (await commandHere({ type: 'adjustHp', actorId: hpActor.id, ...change, damageKind: form.get('damageKind') })) setHpTarget(undefined)
    }}>
      <header><h2>ปรับ HP · {hpActor.name}</h2><button type="button" aria-label="ปิด" onClick={() => setHpTarget(undefined)}>×</button></header>
      <p>HP {hpActor.hp}/{hpActor.maxHp} · Temp HP {hpActor.tempHp}</p>
      <label>จำนวน (ใส่ 8 = รักษา · -15 = ลด HP)<input aria-label="จำนวน" name="amount" inputMode="numeric" autoFocus required placeholder="เช่น -15 หรือ 8" /></label>
      <label>ประเภทเมื่อเป็นความเสียหาย<DamageTypeSelect /></label>
      <label>การปรับ<select name="mode"><option value="auto">เพิ่ม/ลด HP ตามเครื่องหมาย</option><option value="temp">ตั้ง Temporary HP</option></select></label>
      <footer><button type="button" onClick={() => setHpTarget(undefined)}>ยกเลิก</button><button className="primary">ยืนยันการปรับ HP</button></footer>
    </form></div>}
    {wizard && <CharacterWizard close={() => setWizard(false)}
      save={async value => {
        const ok = await send({ type: 'sheet', kind: 'pc', sheet: value })
        if (ok) { setNotice('สร้าง ' + value.name + ' แล้ว · ลากชื่อจากชีตในห้องลงกระดานเพื่อวาง'); openPanel('sheets') }
        return ok
      }}
      openEditor={(initial, report) => { setWizard(false); setSheet({ initial: initial ?? blankSheet(), report }) }} />}
    {sheet && <SheetEditor initial={sheet.initial} editInventory={!sheet.actor} report={sheet.report} copy={sheet.template ? () => { saveToLibrary(sheet.template!.sheet); setSheet(undefined) } : undefined}
      cancel={() => setSheet(undefined)} save={value => void send({
      type: sheet.asTemplate ? 'template' : 'sheet', actorId: sheet.actor?.id, templateId: sheet.template?.id, kind: value.kind, sheet: value
    }).then(ok => { if (ok) { setSheet(undefined); openPanel('sheets') } })} />}
  </main>
}
