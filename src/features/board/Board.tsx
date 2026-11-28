import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { Crosshair, Grid3x3, Maximize, Minus, MousePointer2, MoreHorizontal, Plus, Ruler } from 'lucide-react'
import { damageKinds, sizes } from '../../../shared/model.ts'
import { areaContains, areaOutline, sizedArea, validArea } from '../../../shared/area.ts'
import type { Area, AreaKind, AreaOutline } from '../../../shared/area.ts'
import { tokenColor, tokenInitials } from './tokenAppearance.ts'
import { newStrikes } from './strikes.ts'
import type { Scene, SceneObject, Snapshot, Token } from '../../../shared/model.ts'
import { clampZoom, dragThreshold, holdToSelectMs, longPressMs, pinchView, wheelIntent, zoomAround } from './gestures.ts'
import type { Point } from './gestures.ts'
import { carriesToken, readTokenDrag } from './tokenDrag.ts'
import { conditionGlyph, rankConditions } from '../../../shared/conditions.ts'
import { activeConditions } from '../../../shared/effects.ts'
import type { TokenDragPayload } from './tokenDrag.ts'
import { usePrefs } from '../../state/prefs.ts'
import { MoveHandle, useMovable } from '../../ui/index.ts'
import { ConditionBadges } from '../combat/ConditionBadges.tsx'
import { rollMenuProps } from '../../ui/index.ts'
import type { Odds, RollMode } from '../../../shared/advantage.ts'
import { hasCondition } from '../../../shared/effects.ts'
import { isMonsterArt, sceneArtByImage } from '../../../shared/catalogArt.ts'
import { boardTransform, bounds, pieceAt, piecesIn, rulerFeet } from './geometry.ts'
import { VisionToolbar } from './VisionToolbar.tsx'
import { doorAt, knownDoor, lightAt, snapCorner, strokeCells, wallAt, wallEdit, wallEndAt, wallsIn } from './visionTools.ts'
import type { VisionTool, WallGrab } from './visionTools.ts'
import { playerView } from '../../../shared/vision.ts'
import type { Wall } from '../../../shared/vision.ts'
import { Eye as EyeIcon } from 'lucide-react'
import { feetMoved, moveCost, speedNow, speedReasons } from '../../../shared/movement.ts'
import { parseConditions, srdConditions } from '../../../shared/conditions.ts'
import { TurnChips } from '../combat/TurnChips.tsx'
import type { ObjectLook, PixiBoard, TokenLook } from './pixiBoard.ts'

/** A token-bar / context command. `roll` makes it a d20 roll with a right-click menu for Advantage or Disadvantage. */
type Action = { label: string; run: () => void; disabled?: boolean; roll?: (mode: RollMode) => void; odds?: () => Odds | undefined }
type Props = {
  room: Snapshot; scene: Scene; selected: string; targetId?: string; select: (id: string) => void
  move: (tokenIds: string[], delta: Point) => void; place?: (position: Point) => void
  copy: (tokenIds: string[], objectIds: string[]) => void
  paste: (position?: Point) => void
  placementLabel?: string
  mainTokenId?: string
  actions: (token: Token | undefined, position: Point, object?: SceneObject) => Action[]
  focus?: { actorId: string; sequence: number }; areaKind?: AreaKind; preview?: Area; onArea?: (area: Area) => void
  /** A spell's fixed template size in squares: the drag only aims it. */
  areaSize?: number
  /** Shown at the top while a spell's template is being placed. */
  areaLabel?: string
  /** A sheet or monster card dropped on a cell. */
  drop?: (payload: TokenDragPayload, cell: Point) => void
  /** DM dragged an object to a new cell. */
  moveObject?: (objectId: string, position: Point) => void
  /** Grid calibration: the next drag draws a box over map cells and reports it in map pixels. */
  calibrate?: (rect: { x: number; y: number; width: number; height: number }) => void
  /** DM: a ±HP field in the token bar (8 heals, -15 damages). */
  quickHp?: (actorId: string, text: string) => Promise<boolean>
  /** Preview grid while calibrating (map pixels). */
  gridOverride?: { cell: number; originX: number; originY: number }
  /** Sends a command for this scene: vision tools, doors. */
  command?: (command: Record<string, unknown>) => Promise<boolean>
  /** A token of yours dropped on an enemy: attack it with your main weapon instead of moving there. */
  attackDrop?: (attackerId: string, targetId: string) => void
}
const objectColors = { container: '#6e5432', prop: '#4b5e58', structure: '#5c5a66', item: '#6a5470' }
type Mode = 'pan' | 'measure' | 'select' | 'move' | 'area' | 'object' | 'calibrate' | 'paint' | 'wall' | 'wallBox'
type Gesture = {
  from: Point; camera: Point; mode: Mode; tokens: Token[]; delta?: Point
  moved: boolean; token?: Token; object?: SceneObject
  /** Editing walls (0.14): what was grabbed, and where the pointer went down in cells. */
  wall?: WallGrab; spot?: Point
}
const editableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && Boolean(target.closest('input,select,textarea,[contenteditable]'))

export function Board({ room, scene, selected, targetId, select, move, copy, paste, place, placementLabel, mainTokenId, actions, focus, areaKind, areaSize, areaLabel, preview, onArea, drop, moveObject, calibrate, gridOverride, quickHp, command, attackDrop }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ x: 640, y: 480 })
  const [camera, setCamera] = useState({ x: 36, y: 36 })
  const [zoom, setZoom] = useState(1)
  const [map, setMap] = useState<HTMLImageElement>()
  const [tool, setTool] = useState<'token' | 'measure'>('token')
  const [group, setGroup] = useState<string[]>([])
  const [objectGroup, setObjectGroup] = useState<string[]>([])
  const [draft, setDraft] = useState<{ tokenIds: string[]; delta: Point }>()
  const [objectDraft, setObjectDraft] = useState<{ id: string; delta: Point }>()
  const [selectedObject, setSelectedObject] = useState<string>()
  const [selection, setSelection] = useState<{ from: Point; to: Point }>()
  const [calibration, setCalibration] = useState<{ from: Point; to: Point }>()
  const [areaDraft, setAreaDraft] = useState<Area>()
  const [ruler, setRuler] = useState<{ from: Point; to: Point }>()
  const [dropCell, setDropCell] = useState<Point>()
  const [panning, setPanning] = useState(false)
  const [menu, setMenu] = useState<{ pixel: Point; cell: Point; token?: Token; object?: SceneObject; door?: Wall }>()
  const menuRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const mouse = useRef<Point>(undefined)
  const pinch = useRef<{ a: Point; b: Point; ids: [number, number]; camera: Point; zoom: number } | null>(null)
  const longPress = useRef<ReturnType<typeof setTimeout>>(undefined)
  const spaceHeld = useRef(false)
  const images = useRef(new Map<string, HTMLImageElement>())
  const [imageRevision, repaintImages] = useState(0)
  const placing = Boolean(place)
  // Vision (DM): the toolbar, the active tool, a wall being drawn, darkness being painted, and "see as" a player.
  const [visionOpen, setVisionOpen] = useState(false)
  const [visionTool, setVisionTool] = useState<VisionTool>()
  const [drawing, setDrawing] = useState<Point[]>([])
  const [cursor, setCursor] = useState<Point>()
  const [painting, setPainting] = useState<Set<string>>()
  const [viewAs, setViewAs] = useState('')
  // Editing walls (0.14): the selected walls, the walls as they would be mid-drag, and a selection box in cells.
  const [wallSel, setWallSel] = useState<string[]>([])
  const [wallDraft, setWallDraft] = useState<{ id: string; a: Point; b: Point }[]>()
  const [wallBox, setWallBox] = useState<{ from: Point; to: Point }>()
  useEffect(() => { if (visionTool !== 'select') { setWallSel([]); setWallDraft(undefined); setWallBox(undefined) } }, [visionTool])
  useEffect(() => { if (!visionOpen) { setVisionTool(undefined); setViewAs('') } }, [visionOpen])
  useEffect(() => { setDrawing([]); setCursor(undefined) }, [visionTool])
  useEffect(() => { if (placing) setTool('token') }, [placing])

  useEffect(() => {
    const element = canvas.current!
    const observer = new ResizeObserver(([entry]) => setSize({ x: entry.contentRect.width, y: entry.contentRect.height }))
    observer.observe(element)
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const intent = wheelIntent(event)
      if (intent.kind === 'pan') {
        const previous = transform.current
        view({ x: previous.camera.x + intent.dx, y: previous.camera.y + intent.dy }, previous.zoom)
      } else zoomAt(intent.factor, { x: event.clientX - rect.left, y: event.clientY - rect.top })
    }
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === ' ' && !editableTarget(event.target) && !event.repeat) {
        spaceHeld.current = true
        setPanning(true)
        if (event.target === element || event.target === document.body) event.preventDefault()
      }
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('.scrim') || editableTarget(event.target)) return
      if (event.key.toLowerCase() === 'r') setTool('measure')
      if (event.key.toLowerCase() === 'v') setTool('token')
      if (event.key.toLowerCase() === 'g') usePrefs.getState().update({ showGrid: !usePrefs.getState().showGrid })
      if (event.key === 'Escape') { setGroup([]); setObjectGroup([]); setSelectedObject(undefined); setRuler(undefined); setDrawing([]) }
    }
    const keyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') { spaceHeld.current = false; setPanning(false) }
    }
    element.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    return () => {
      observer.disconnect()
      element.removeEventListener('wheel', wheel)
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      clearTimeout(longPress.current)
    }
  }, [])
  // 0.14: on a vision scene a player's map comes back with unseen squares painted black by the server,
  // so it is fetched again as they explore: at most every 2 seconds, keeping the old picture until the new one loads.
  const maskedMap = room.me.role !== 'dm' && scene.vision?.enabled === true
  const known = maskedMap ? (scene.view?.explored.length ?? 0) + ':' + (scene.view?.visible.length ?? 0) : ''
  const [mapVersion, setMapVersion] = useState(known)
  const lastMapLoad = useRef(0)
  useEffect(() => {
    if (known === mapVersion) return
    const wait = Math.max(0, lastMapLoad.current + 2000 - Date.now())
    const timer = setTimeout(() => setMapVersion(known), wait)
    return () => clearTimeout(timer)
  }, [known, mapVersion])
  useEffect(() => { setMap(undefined) }, [room.id, scene.map?.id])
  useEffect(() => {
    if (!scene.map) return
    lastMapLoad.current = Date.now()
    const image = new Image()
    image.onload = () => setMap(image)
    image.src = '/api/rooms/' + room.id + '/maps/' + scene.map.id + (maskedMap ? '?seen=' + encodeURIComponent(mapVersion) : '')
    return () => { image.onload = null }
  }, [room.id, scene.map?.id, maskedMap, mapVersion])
  useEffect(() => {
    const sources = new Set([
      ...room.publicActors.map(actor => actor.portrait),
      ...(scene.objects ?? []).map(object => object.image)
    ].filter((value): value is string => Boolean(value)))
    for (const [source, picture] of images.current) {
      if (!sources.has(source)) { picture.onload = null; images.current.delete(source) }
    }
    for (const source of sources) {
      if (images.current.has(source)) continue
      const picture = new Image()
      picture.onload = () => repaintImages(value => value + 1)
      images.current.set(source, picture)
      picture.src = source
    }
  }, [room.publicActors, scene.objects])
  useEffect(() => () => {
    for (const picture of images.current.values()) picture.onload = null
    images.current.clear()
  }, [])

  const gridCell = gridOverride?.cell ?? scene.cell
  // Calibration always shows the grid: it is what the DM is lining up.
  const gridPref = usePrefs(state => state.showGrid)
  const showGrid = gridPref || Boolean(calibrate)
  const gridSpec = { cell: gridCell, originX: gridOverride?.originX ?? scene.originX, originY: gridOverride?.originY ?? scene.originY }
  const transformNow = boardTransform({ camera, zoom }, gridSpec)
  const grid = transformNow.size
  const { pixel, cell, areaPoint } = transformNow
  const creature = (token: Token) => room.publicActors.find(actor => actor.id === token.actorId)
  function span(token: Token) { return sizes[creature(token)?.size ?? 'Medium'] }
  const current = scene.combat?.order[scene.combat.turn]?.actorId
  const dm = room.me.role === 'dm'

  const transform = useRef({ camera, zoom })
  function view(nextCamera: Point, nextZoom: number) {
    transform.current = { camera: nextCamera, zoom: nextZoom }
    setCamera(nextCamera)
    setZoom(nextZoom)
  }
  useEffect(() => {
    if (!focus) return
    const token = scene.tokens.find(item => item.actorId === focus.actorId)
    if (!token) return
    const half = span(token) / 2
    view({ x: size.x / 2 - (scene.originX + (token.x + half) * scene.cell) * zoom,
      y: size.y / 2 - (scene.originY + (token.y + half) * scene.cell) * zoom }, zoom)
  }, [focus])
  const activeArea = areaDraft ?? preview
  const outline = activeArea && validArea(activeArea) ? areaOutline(activeArea) : undefined
  const toolsMovable = useMovable('board-tools')
  // Attack animations: a slash for melee, a bolt for ranged, played once per new attack roll.
  const seenRolls = useRef<Set<string> | undefined>(undefined)
  useEffect(() => {
    if (!seenRolls.current) { seenRolls.current = new Set(room.rolls.map(roll => roll.id)); return }
    const fresh = newStrikes(room.rolls, scene.tokens, scene.id, seenRolls.current, Date.now(), span)
    for (const strike of fresh) pixi.current?.strike(strike.from, strike.to, strike.ranged, strike.outcome)
  }, [room.rolls])
  // A spell area that just went off bursts once on the board (not again after a reload).
  const seenArea = useRef<number | undefined>(undefined)
  function zoomAt(factor: number, at: Point) {
    const previous = transform.current
    const next = clampZoom(previous.zoom * factor)
    view(zoomAround(previous.camera, previous.zoom, next, at), next)
  }
  function fit() {
    if (!map) { view({ x: 36, y: 36 }, 1); return }
    const next = clampZoom(Math.min((size.x - 48) / map.width, (size.y - 96) / map.height))
    view({ x: (size.x - map.width * next) / 2, y: (size.y - map.height * next) / 2 }, next)
  }
  function closeMenu() {
    setMenu(undefined)
    canvas.current?.focus({ preventScroll: true })
  }
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return
    const element = menuRef.current
    element.style.left = Math.max(8, Math.min(menu.pixel.x, size.x - element.offsetWidth - 8)) + 'px'
    element.style.top = Math.max(8, Math.min(menu.pixel.y, size.y - element.offsetHeight - 8)) + 'px'
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  }, [menu, size])
  useEffect(() => {
    if (!menu) return
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(undefined)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [menu])
  // A selected object that left the scene is no longer selected.
  useEffect(() => {
    if (selectedObject && !scene.objects?.some(object => object.id === selectedObject)) setSelectedObject(undefined)
  }, [scene.objects, selectedObject])

  // The Pixi renderer: created once per canvas, then fed the view, the pieces and the overlays separately,
  // so panning and zooming only move the camera container.
  const pixi = useRef<PixiBoard>(undefined)
  const [ready, setReady] = useState(false)
  const reduceMotion = usePrefs(state => state.reduceMotion)
  // Zooming scales the pieces on the GPU; their lines and text are rebuilt for the new zoom once it settles.
  const [detailZoom, setDetailZoom] = useState(1)
  useEffect(() => {
    // Detail steps of about 26 % (2^⅓): small zoom changes, or zooming back, never rebuild the pieces.
    const timer = setTimeout(() => setDetailZoom(2 ** (Math.round(Math.log2(zoom) * 3) / 3)), 160)
    return () => clearTimeout(timer)
  }, [zoom])
  useEffect(() => {
    let cancelled = false
    let created: PixiBoard | undefined
    // PixiJS loads with the first board, not with the lobby.
    import('./pixiBoard.ts').then(({ PixiBoard }) => PixiBoard.create(canvas.current!, size)).then(board => {
      if (cancelled) { board.destroy(); return }
      created = board
      pixi.current = board
      Object.assign(window, { beholderBoard: board })
      setReady(true)
    }).catch(error => console.error('board renderer', error))
    return () => {
      cancelled = true
      created?.destroy()
      pixi.current = undefined
    }
  }, [])
  useEffect(() => { if (ready) pixi.current!.resize(size) }, [ready, size])
  useEffect(() => {
    if (ready) pixi.current!.setMotionPreference(reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [ready, reduceMotion])
  useEffect(() => {
    if (ready) pixi.current!.setView({ camera, zoom }, gridSpec, transformNow, showGrid, Boolean(map), size)
  }, [ready, camera, zoom, size, gridSpec.cell, gridSpec.originX, gridSpec.originY, showGrid, map])
  useEffect(() => { if (ready) pixi.current!.setMap(map) }, [ready, map])
  useEffect(() => {
    if (!ready) return
    const preview = painting && visionTool === 'terrain' ? [...painting] : []
    const cleared = painting && visionTool === 'terrainClear' ? painting : undefined
    pixi.current!.setTerrain([...(scene.terrain ?? []).filter(cell => !cleared?.has(cell)), ...preview])
  }, [ready, scene.terrain, painting, visionTool, detailZoom, gridSpec.cell, gridSpec.originX, gridSpec.originY])
  useEffect(() => {
    const effect = scene.areaEffect
    if (!ready || !effect || seenArea.current === effect.at) return
    const fresh = seenArea.current !== undefined || Date.now() - effect.at < 1500
    seenArea.current = effect.at
    if (fresh) pixi.current!.areaBurst(areaOutline(effect.area), damageKinds[effect.kind][1])
  }, [ready, scene.areaEffect?.at])
  useEffect(() => {
    if (!ready) return
    const board = pixi.current!
    board.setDetail(detailZoom)
    const ready2 = (picture?: HTMLImageElement) => picture && picture.complete && picture.naturalWidth ? picture : undefined
    const objects: ObjectLook[] = (scene.objects ?? []).map(object => {
      const shift = objectDraft?.id === object.id ? objectDraft.delta : { x: 0, y: 0 }
      const picture = ready2(object.image ? images.current.get(object.image) : undefined)
      return {
        id: object.id, x: object.x + shift.x, y: object.y + shift.y, width: object.width, height: object.height, name: object.name,
        color: objectColors[object.kind], picture, contained: Boolean(object.image && sceneArtByImage(object.image)),
        faded: object.kind === 'structure' && object.hp <= 0, selected: selectedObject === object.id || objectGroup.includes(object.id),
        hp: object.kind === 'structure' && object.hp > 0 ? { hp: object.hp, maxHp: object.maxHp } : undefined
      }
    })
    const tokens: TokenLook[] = scene.tokens.map((token, index) => {
      const delta = draft?.tokenIds.includes(token.id) ? draft.delta : undefined
      const actor = creature(token)
      const affected = Boolean(outline && areaContains(outline, { x: token.x + span(token) / 2, y: token.y + span(token) / 2 }))
      const conditions = actor ? rankConditions(activeConditions(actor)) : []
      const waiting = actor?.effects?.some(effect => effect.pending)
      // The two most limiting conditions as marks, then "+N"; zoomed far out only one fits.
      const room = gridCell * detailZoom * span(token) >= 40 ? 2 : 1
      const marks = conditions.slice(0, room).map(item => conditionGlyph(item.name))
      if (conditions.length > room) marks.push('+' + (conditions.length - room))
      if (waiting) marks.unshift('!')
      const highlighted = affected || targetId === token.actorId || group.includes(token.id) || selected === token.actorId
      return {
        id: token.id, x: token.x + (delta?.x ?? 0), y: token.y + (delta?.y ?? 0), span: span(token),
        name: actor?.name ?? '?', initials: actor ? tokenInitials(actor.name) : '?',
        portrait: ready2(actor?.portrait ? images.current.get(actor.portrait) : undefined),
        monsterArt: Boolean(actor?.portrait && isMonsterArt(actor.portrait)),
        ring: affected || targetId === token.actorId ? '#ff9e88' : group.includes(token.id) ? '#9fc4f0' : current === token.actorId ? '#ffd08a' : selected === token.actorId ? '#e0b878' : tokenColor(index),
        ringWidth: highlighted ? 4 : 2, current: current === token.actorId, main: mainTokenId === token.id,
        faint: Boolean(actor && hasCondition(actor, 'Invisible')),
        hp: actor ? { hp: actor.hp, maxHp: actor.maxHp, temp: actor.tempHp, foe: actor.kind === 'monster' } : undefined, marks
      }
    })
    board.setObjects(objects)
    board.setTokens(tokens, new Set(draft?.tokenIds ?? []))
    const inUse = new Set([map, ...tokens.map(item => item.portrait), ...objects.map(item => item.picture)].filter((item): item is HTMLImageElement => Boolean(item)))
    board.prune(inUse)
  }, [ready, scene, room.publicActors, selected, targetId, mainTokenId, draft, objectDraft, selectedObject, objectGroup, group, imageRevision, outline, map, detailZoom, gridSpec.cell, gridSpec.originX, gridSpec.originY])
  useEffect(() => {
    if (!ready) return
    const areas = outline ? [{ shape: outline, color: '#ffb384' }] : []
    pixi.current!.setOverlay({
      areas, dropCell,
      ruler: ruler && { ...ruler, feet: rulerFeet(ruler.from, ruler.to) },
      selection: selection && bounds(selection.from, selection.to),
      calibration: calibration && bounds(calibration.from, calibration.to)
    })
  }, [ready, outline, dropCell, ruler, selection, calibration, Math.round(zoom * 16), gridSpec.cell, gridSpec.originX, gridSpec.originY])

  // Doors this seat can click: all of them for the DM, known ones for players (seen or explored, never secret).
  const knownCells = new Set([...(scene.view?.visible ?? []), ...(scene.view?.explored ?? [])])
  const knownDoors = (scene.vision?.walls ?? []).filter(wall => wall.door && (dm || !scene.vision?.enabled || knownDoor(wall, knownCells)))
  /** A player opens or shuts a door with their selected token, else their main token, else any token of theirs here. */
  async function useDoor(wall: Wall) {
    if (!command || !wall.door) return
    if (dm) return command({ type: 'doorSettings', wallId: wall.id, door: { open: !wall.door.open } })
    const mine = scene.tokens.filter(token => room.actors.some(actor => actor.id === token.actorId))
    const actorId = mine.find(token => token.actorId === selected)?.actorId ?? mine.find(token => token.id === mainTokenId)?.actorId ?? mine[0]?.actorId
    if (!actorId) return
    return command(wall.door.locked ? { type: 'pickDoor', wallId: wall.id, actorId } : { type: 'door', wallId: wall.id, actorId, open: !wall.door.open })
  }
  useEffect(() => {
    if (!ready) return
    const vision = scene.vision
    const player = !dm && vision?.enabled && scene.view
    const watched = dm && viewAs && vision?.enabled ? playerView(scene, room.actors, viewAs) : undefined
    const fog = player ? {
      visible: new Set(scene.view!.visible), dimmed: new Set(scene.view!.dimmed), darkvision: new Set(scene.view!.darkvision),
      explored: new Set(scene.view!.explored), opaque: true
    } : watched ? { ...watched, explored: new Set(vision?.explored?.[viewAs] ?? []), opaque: false } : undefined
    const draftById = new Map((wallDraft ?? []).map(wall => [wall.id, wall]))
    const shown = (list: Wall[]) => wallDraft ? list.map(wall => draftById.has(wall.id) ? { ...wall, ...draftById.get(wall.id)! } : wall) : list
    pixi.current!.setVision({
      fog, walls: dm ? shown(vision?.walls ?? []) : [], showWalls: dm,
      doors: dm ? shown(knownDoors) : knownDoors,
      selectedWalls: dm ? wallSel : undefined, box: dm ? wallBox : undefined,
      lights: dm ? vision?.lights ?? [] : [],
      darkness: dm && visionOpen ? { dark: [...(vision?.darkness ?? []), ...(painting && visionTool === 'dark' ? painting : [])],
        magic: [...(vision?.magicDarkness ?? []), ...(painting && visionTool === 'magic' ? painting : [])] } : undefined,
      drawing, cursor
    })
  }, [ready, scene.vision, scene.view, scene.tokens, room.actors, viewAs, visionOpen, visionTool, painting, drawing, cursor, wallSel, wallDraft, wallBox, detailZoom, gridSpec.cell, gridSpec.originX, gridSpec.originY])

  function pointer(event: { clientX: number; clientY: number; currentTarget: Element }) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  function canMove(token: Token) {
    return dm || room.actors.some(actor => actor.id === token.actorId)
  }
  function objectAt(point: Point) {
    return pieceAt(transformNow, scene.objects ?? [], point, object => object)
  }
  function tokenAt(point: Point) {
    return pieceAt(transformNow, scene.tokens, point, token => ({ width: span(token), height: span(token) }))
  }
  function openMenuAt(point: Point) {
    const token = tokenAt(point)
    const object = token ? undefined : objectAt(point)
    if (token) {
      select(token.actorId)
      setSelectedObject(undefined)
      if (!group.includes(token.id)) { setGroup([token.id]); setObjectGroup([]) }
    } else if (object && !objectGroup.includes(object.id)) {
      select('')
      setGroup([])
      setObjectGroup([])
      setSelectedObject(object.id)
    }
    setMenu({ pixel: point, cell: cell(point), token, object })
  }
  const sized = (area: Area) => areaSize ? sizedArea(area, areaSize) : area
  function cancelGesture() {
    clearTimeout(longPress.current)
    gesture.current = null
    setDraft(undefined)
    setObjectDraft(undefined)
    setSelection(undefined)
    setAreaDraft(undefined)
  }

  function down(event: PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 1) return
    const point = pointer(event)
    pointers.current.set(event.pointerId, point)
    event.currentTarget.setPointerCapture(event.pointerId)
    // Second finger: the gesture becomes a pinch (zoom + pan).
    if (pointers.current.size === 2) {
      cancelGesture()
      const [[idA, a], [idB, b]] = [...pointers.current.entries()]
      pinch.current = { a, b, ids: [idA, idB], ...transform.current }
      return
    }
    if (pointers.current.size > 2) return
    const pan = event.button === 1 || spaceHeld.current
    if (pan) event.preventDefault()
    if (areaKind && !pan && !place) {
      gesture.current = { from: point, camera, mode: 'area', tokens: [], moved: false }
      setAreaDraft(sized({ kind: areaKind, from: areaPoint(point), to: areaPoint(point) }))
      return
    }
    if (calibrate && !pan) {
      gesture.current = { from: point, camera, mode: 'calibrate', tokens: [], moved: false }
      setCalibration({ from: point, to: point })
      return
    }
    if (place && tool === 'token' && !pan) { place(cell(point)); return }
    const spot = transformNow.at(point)
    if (dm && visionTool && command && !pan) {
      const walls = scene.vision?.walls ?? []
      if (visionTool === 'select') {
        // Grab an end, else a wall's body (Shift adds it to the selection), else start a selection box.
        const end = wallEndAt(walls, spot, wallSel)
        const hit = end ? undefined : wallAt(walls, spot)
        if (end) {
          if (!wallSel.includes(end.wallId) && !event.shiftKey) setWallSel([end.wallId])
          gesture.current = { from: point, camera, mode: 'wall', tokens: [], moved: false, wall: end, spot }
        } else if (hit) {
          const next = event.shiftKey ? wallSel.includes(hit.id) ? wallSel.filter(id => id !== hit.id) : [...wallSel, hit.id]
            : wallSel.includes(hit.id) ? wallSel : [hit.id]
          setWallSel(next)
          gesture.current = { from: point, camera, mode: 'wall', tokens: [], moved: false, wall: { kind: 'body' }, spot }
        } else {
          if (!event.shiftKey) setWallSel([])
          gesture.current = { from: point, camera, mode: 'wallBox', tokens: [], moved: false, spot }
          setWallBox({ from: spot, to: spot })
        }
        return
      }
      if (visionTool === 'wall' || visionTool === 'door') {
        const corner = snapCorner(spot, event.shiftKey)
        const last = drawing.at(-1)
        if (!last) setDrawing([corner])
        else if (last.x !== corner.x || last.y !== corner.y) {
          void command({ type: 'walls', add: [{ a: last, b: corner, door: visionTool === 'door' }] })
          setDrawing(visionTool === 'wall' ? [corner] : [])
        }
      } else if (visionTool === 'light') {
        const existing = lightAt(scene.vision?.lights ?? [], spot)
        void command(existing ? { type: 'lights', toggle: existing.id } : { type: 'lights', add: { x: Math.floor(spot.x) + .5, y: Math.floor(spot.y) + .5 } })
      } else if (visionTool === 'erase') {
        const wall = wallAt(walls, spot)
        const light = wall ? undefined : lightAt(scene.vision?.lights ?? [], spot)
        if (wall) void command({ type: 'walls', remove: [wall.id] })
        else if (light) void command({ type: 'lights', remove: light.id })
      } else {
        gesture.current = { from: point, camera, mode: 'paint', tokens: [], moved: false }
        setPainting(strokeCells(spot, spot))
      }
      return
    }
    // Doors open and shut with a click on their handle (players: the nearest of their own tokens does it).
    const door = !pan && tool === 'token' && command ? doorAt(knownDoors, spot) : undefined
    if (door) {
      void useDoor(door)
      return
    }
    const measure = tool === 'measure' && !pan
    if (measure) setRuler({ from: cell(point), to: cell(point) })
    else setRuler(undefined)
    const token = !pan && !measure ? tokenAt(point) : undefined
    const object = !pan && !measure && !token ? objectAt(point) : undefined
    let mode: Mode = pan ? 'pan' : measure ? 'measure' : 'pan'
    if (token) {
      select(token.actorId)
      setSelectedObject(undefined)
      if (!group.includes(token.id)) { setGroup([token.id]); setObjectGroup([]) }
      mode = canMove(token) ? 'move' : 'pan'
    } else if (object) {
      select('')
      setGroup([])
      setObjectGroup([])
      setSelectedObject(object.id)
      mode = (dm || object.temp) && moveObject ? 'object' : 'pan'
    } else if (!pan && !measure && event.shiftKey) mode = 'select'
    const tokens = mode === 'move' && token
      ? group.includes(token.id) ? scene.tokens.filter(item => group.includes(item.id) && canMove(item)) : [token]
      : []
    gesture.current = { from: point, camera, mode, tokens, moved: false, token, object }
    if (mode === 'pan' && !pan && !token && !object && tool === 'token' && event.pointerType !== 'touch') {
      // Press and hold on empty map, then drag: a selection box. A quick drag still pans.
      clearTimeout(longPress.current)
      longPress.current = setTimeout(() => {
        const action = gesture.current
        if (action && !action.moved && action.mode === 'pan') {
          action.mode = 'select'
          setSelection({ from: action.from, to: action.from })
        }
      }, holdToSelectMs)
    }
    if (event.pointerType === 'touch') {
      clearTimeout(longPress.current)
      longPress.current = setTimeout(() => {
        if (gesture.current && !gesture.current.moved) {
          cancelGesture()
          openMenuAt(point)
        }
      }, longPressMs)
    }
  }
  function drag(event: PointerEvent<HTMLCanvasElement>) {
    if (drawing.length) setCursor(snapCorner(transformNow.at(pointer(event)), event.shiftKey))
    if (!pointers.current.has(event.pointerId)) return
    const point = pointer(event)
    if (gesture.current?.mode === 'paint') {
      const from = transformNow.at(gesture.current.from)
      const to = transformNow.at(point)
      gesture.current.from = point
      setPainting(current => new Set([...(current ?? []), ...strokeCells(from, to)]))
      return
    }
    pointers.current.set(event.pointerId, point)
    const pinching = pinch.current
    if (pinching) {
      const a = pointers.current.get(pinching.ids[0])
      const b = pointers.current.get(pinching.ids[1])
      if (a && b) {
        const next = pinchView(pinching, a, b)
        view(next.camera, next.zoom)
      }
      return
    }
    const action = gesture.current
    if (!action) return
    const dx = point.x - action.from.x
    const dy = point.y - action.from.y
    if (!action.moved && Math.hypot(dx, dy) > dragThreshold) {
      action.moved = true
      clearTimeout(longPress.current)
    }
    if (action.mode === 'wall' && action.wall && action.spot) {
      const spot = transformNow.at(point)
      const walls = scene.vision?.walls ?? []
      // A body drag moves the walls selected when it began (the click may have just selected one).
      const grabbed = action.wall
      const selection = grabbed.kind === 'end' ? (wallSel.includes(grabbed.wallId) ? wallSel : [grabbed.wallId])
        : wallSel.length ? wallSel : (() => { const hit = wallAt(walls, action.spot!); return hit ? [hit.id] : [] })()
      setWallDraft(action.moved ? wallEdit(walls, selection, grabbed, grabbed.kind === 'end'
        ? { to: snapCorner(spot, event.shiftKey) }
        : { delta: { x: Math.round(spot.x - action.spot.x), y: Math.round(spot.y - action.spot.y) } }, event.altKey) : undefined)
      return
    }
    if (action.mode === 'wallBox' && action.spot) { setWallBox({ from: action.spot, to: transformNow.at(point) }); return }
    if (action.mode === 'area' && areaKind) setAreaDraft(sized({ kind: areaKind, from: areaPoint(action.from), to: areaPoint(point) }))
    else if (action.mode === 'measure') setRuler({ from: cell(action.from), to: cell(point) })
    else if (action.mode === 'select') setSelection({ from: action.from, to: point })
    else if (action.mode === 'calibrate') setCalibration({ from: action.from, to: point })
    else if (action.mode === 'move') {
      const step = action.tokens.every(token => span(token) === .5) ? .5 : 1
      action.delta = { x: Math.round(dx / grid / step) * step, y: Math.round(dy / grid / step) * step }
      setDraft({ tokenIds: action.tokens.map(token => token.id), delta: action.delta })
    } else if (action.mode === 'object' && action.object) {
      action.delta = { x: Math.round(dx / grid), y: Math.round(dy / grid) }
      setObjectDraft({ id: action.object.id, delta: action.delta })
    } else if (action.moved) {
      setPanning(true)
      view({ x: action.camera.x + dx, y: action.camera.y + dy }, transform.current.zoom)
    }
  }
  function up(event: PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(event.pointerId)
    clearTimeout(longPress.current)
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null
      gesture.current = null
      return
    }
    const action = gesture.current
    if (action?.mode === 'wall') {
      if (wallDraft?.length && command) void command({ type: 'walls', move: wallDraft })
      setWallDraft(undefined)
    } else if (action?.mode === 'wallBox' && wallBox) {
      const found = wallsIn(scene.vision?.walls ?? [], wallBox.from, wallBox.to).map(wall => wall.id)
      setWallSel(current => [...new Set([...current, ...found])])
      setWallBox(undefined)
    } else if (action?.mode === 'paint' && painting && command) {
      void command(visionTool === 'terrain' || visionTool === 'terrainClear'
        ? { type: 'terrain', cells: [...painting], mode: visionTool === 'terrain' ? 'difficult' : 'clear' }
        : { type: 'darkness', cells: [...painting], mode: visionTool === 'magic' ? 'magic' : visionTool === 'dark' ? 'dark' : 'clear' })
      setPainting(undefined)
    } else if (action?.mode === 'area' && areaKind) {
      const area = sized({ kind: areaKind, from: areaPoint(action.from), to: areaPoint(pointer(event)) })
      if (validArea(area)) onArea?.(area)
      setAreaDraft(undefined)
    } else if (action?.mode === 'move' && action.delta && (action.delta.x || action.delta.y)) {
      // One token of yours let go over an enemy: that is an attack, not a move (the token stays put).
      const dragged = action.tokens.length === 1 ? action.tokens[0] : undefined
      const landing = dragged && { x: dragged.x + action.delta.x + span(dragged) / 2, y: dragged.y + action.delta.y + span(dragged) / 2 }
      const foe = dragged && landing && attackDrop ? scene.tokens.find(token => token.id !== dragged.id &&
        landing.x >= token.x && landing.x < token.x + span(token) && landing.y >= token.y && landing.y < token.y + span(token) &&
        (dm || !room.actors.some(actor => actor.id === token.actorId))) : undefined
      if (dragged && foe && attackDrop) attackDrop(dragged.actorId, foe.actorId)
      else move(action.tokens.map(token => token.id), action.delta)
    } else if (action?.mode === 'object' && action.object && action.delta && (action.delta.x || action.delta.y)) {
      moveObject?.(action.object.id, { x: action.object.x + action.delta.x, y: action.object.y + action.delta.y })
    } else if (action?.mode === 'calibrate' && calibrate) {
      const rect = bounds(action.from, pointer(event))
      const view = transform.current
      if (rect.width > 4 && rect.height > 4) calibrate({ x: (rect.x - view.camera.x) / view.zoom, y: (rect.y - view.camera.y) / view.zoom, width: rect.width / view.zoom, height: rect.height / view.zoom })
      setCalibration(undefined)
    } else if (action?.mode === 'select') {
      const rect = bounds(action.from, pointer(event))
      const found = piecesIn(transformNow, scene.tokens, rect, token => ({ width: span(token), height: span(token) })).slice(0, 100)
      const objects = piecesIn(transformNow, scene.objects ?? [], rect, object => object).slice(0, 100 - found.length)
      setGroup(found.map(token => token.id))
      setObjectGroup(objects.map(object => object.id))
      setSelectedObject(found.length === 0 && objects.length === 1 ? objects[0].id : undefined)
      select(found[0]?.actorId ?? '')
    } else if (action?.mode === 'pan' && !action.moved && !action.token && !action.object && !spaceHeld.current) {
      // A click on empty map clears the selection.
      setGroup([])
      setObjectGroup([])
      setSelectedObject(undefined)
      select('')
    }
    if (!spaceHeld.current) setPanning(false)
    gesture.current = null
    setDraft(undefined)
    setObjectDraft(undefined)
    setSelection(undefined)
  }

  const center = { x: size.x / 2, y: size.y / 2 }
  const doorActions = (wall: Wall): Action[] => {
    const state = wall.door!
    const set = (door: Record<string, unknown> | null) => void command?.({ type: 'doorSettings', wallId: wall.id, door })
    return [
      { label: state.open ? 'ปิดประตู' : 'เปิดประตู', run: () => set({ open: !state.open }), disabled: state.locked },
      { label: state.locked ? 'ปลดล็อก' : 'ล็อกประตู', run: () => set({ locked: !state.locked }) },
      ...[10, 15, 20].map(dc => ({ label: 'DC สะเดาะ ' + dc + (state.dc === dc ? ' ✓' : ''), run: () => set({ dc }) })),
      { label: state.secret ? 'เปิดเผยประตูลับ' : 'ทำเป็นประตูลับ', run: () => set({ secret: !state.secret }) },
      { label: 'เปลี่ยนเป็นผนัง', run: () => set(null) }
    ]
  }
  const boardActions: Action[] = menu?.door ? doorActions(menu.door) : menu ? [
    ...actions(menu.token, menu.cell, menu.object),
    ...(menu.token || menu.object ? [] : [
      { label: 'วัดระยะ', run: () => setTool('measure') },
      { label: 'พอดีกระดาน', run: fit }
    ])
  ] : []

  // The selection bar: what you can do with the selected token or object, without a right-click.
  const selectedToken = scene.tokens.find(token => token.actorId === selected)
  const barObject = !selectedToken && selectedObject ? scene.objects?.find(object => object.id === selectedObject) : undefined
  const barTarget = selectedToken ?? barObject
  const selectionCount = group.length + objectGroup.length
  const showBar = Boolean(barTarget && !menu && !place && !areaKind && selectionCount <= 1 && !draft && !objectDraft)
  const barActions = showBar ? actions(selectedToken, selectedToken ? { x: selectedToken.x, y: selectedToken.y } : { x: barObject!.x, y: barObject!.y }, barObject) : []
  const barActor = selectedToken && creature(selectedToken)
  const barSheet = selectedToken && room.actors.find(actor => actor.id === selectedToken.actorId)
  // Movement this turn: feet used against Speed for the creature whose turn it is (shown on its bar and while dragging it).
  const encumbrance = room.settings?.encumbrance !== false
  const budget = (token: Token | undefined, extra = 0) => {
    const sheet = token && room.actors.find(actor => actor.id === token.actorId)
    if (!token || !sheet || scene.combat?.order[scene.combat.turn]?.actorId !== token.actorId) return undefined
    const used = feetMoved(scene, token.actorId) + extra
    return { used, speed: speedNow(sheet, encumbrance), reasons: speedReasons(sheet, encumbrance) }
  }
  const barBudget = budget(selectedToken)
  const dragging = draft && draft.tokenIds.length === 1 ? scene.tokens.find(token => token.id === draft.tokenIds[0]) : undefined
  const dragBudget = dragging && draft ? budget(dragging, moveCost(scene, room.actors.find(actor => actor.id === dragging.actorId), dragging, { x: dragging.x + draft.delta.x, y: dragging.y + draft.delta.y })) : undefined
  // One-click conditions on the token bar (the DM, or the token's owner).
  const [conditionsOpen, setConditionsOpen] = useState(false)
  useEffect(() => setConditionsOpen(false), [selected])
  const canCondition = Boolean(command && barSheet && (dm || barSheet.ownerId === room.me.id))
  function toggleCondition(name: string) {
    if (!barSheet || !command) return
    const list = parseConditions(barSheet.conditions)
    const has = list.some(item => item.name === name)
    void command({ type: 'conditions', actorId: barSheet.id, conditions: has ? list.filter(item => item.name !== name) : [...list, { name }] })
  }

  useEffect(() => {
    const track = (event: MouseEvent) => { mouse.current = { x: event.clientX, y: event.clientY } }
    const clear = () => { mouse.current = undefined }
    window.addEventListener('mousemove', track)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('mousemove', track)
      window.removeEventListener('blur', clear)
    }
  }, [])
  useEffect(() => {
    // Delete / Backspace removes the selected walls (capture phase, so the token shortcuts never see it).
    if (visionTool !== 'select' || !wallSel.length || !command) return
    const remove = (event: KeyboardEvent) => {
      if ((event.key !== 'Delete' && event.key !== 'Backspace') || editableTarget(event.target) || document.querySelector('.scrim')) return
      event.preventDefault()
      event.stopPropagation()
      void command({ type: 'walls', remove: wallSel })
      setWallSel([])
    }
    window.addEventListener('keydown', remove, true)
    return () => window.removeEventListener('keydown', remove, true)
  }, [visionTool, wallSel, command])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.shiftKey ||
        !(event.ctrlKey || event.metaKey) || editableTarget(event.target) || document.querySelector('.scrim') ||
        window.getSelection()?.isCollapsed === false) return
      const key = event.key.toLowerCase()
      if (key === 'c') {
        const tokenIds = group.length ? group : selectedToken && !selectedObject && !objectGroup.length ? [selectedToken.id] : []
        const objectIds = objectGroup.length ? objectGroup : selectedObject ? [selectedObject] : []
        if (!tokenIds.length && !objectIds.length) return
        event.preventDefault()
        copy(tokenIds, objectIds)
      } else if (key === 'v') {
        event.preventDefault()
        const point = mouse.current
        const element = canvas.current
        const onBoard = point && element && document.elementFromPoint(point.x, point.y) === element
        paste(onBoard ? cell(pointer({ clientX: point.x, clientY: point.y, currentTarget: element })) : undefined)
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })

  return <section className="board">
    <canvas ref={canvas} className={'board-canvas' + (areaKind || calibrate ? ' drawing-aoe' : '') + (panning ? ' panning' : '') + (tool === 'measure' ? ' measuring' : '')}
      tabIndex={0} aria-label="กระดานแผนที่" data-camera={Math.round(camera.x) + ',' + Math.round(camera.y)} data-zoom={zoom}
      data-renderer={ready ? 'pixi' : 'loading'} onPointerDown={down} onPointerMove={drag} onPointerUp={up}
      onContextMenu={event => {
        event.preventDefault()
        if (drawing.length) { setDrawing([]); setCursor(undefined); return }
        const doorHere = dm && command ? doorAt(scene.vision?.walls ?? [], transformNow.at(pointer(event))) : undefined
        if (doorHere) {
          const rect = event.currentTarget.getBoundingClientRect()
          setMenu({ pixel: { x: event.clientX - rect.left, y: event.clientY - rect.top }, cell: cell(pointer(event)), door: doorHere })
          return
        }
        cancelGesture()
        const rect = event.currentTarget.getBoundingClientRect()
        openMenuAt(event.clientX || event.clientY ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : center)
      }}
      onPointerCancel={event => { pointers.current.delete(event.pointerId); pinch.current = null; cancelGesture() }}
      onDragOver={event => {
        if (!drop || !carriesToken(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        const next = cell(pointer(event))
        setDropCell(previous => previous?.x === next.x && previous.y === next.y ? previous : next)
      }}
      onDragLeave={() => setDropCell(undefined)}
      onDrop={event => {
        setDropCell(undefined)
        const payload = drop && readTokenDrag(event)
        if (!payload) return
        event.preventDefault()
        drop(payload, cell(pointer(event)))
      }} />
    {(scene.damageEvents ?? []).filter(event => Date.now() - event.at < 2400).map(event => {
      const token = scene.tokens.find(item => item.actorId === event.actorId)
      if (!token) return null
      const position = pixel({ x: token.x + span(token) / 2, y: token.y })
      const [label, color] = damageKinds[event.kind]
      return <span key={event.id} className="floating-damage" style={{ left: position.x, top: position.y, color }}
        aria-label={'เสีย HP ' + event.amount + ' · ' + label}>−{event.amount}</span>
    })}
    <div className="board-tools" role="toolbar" aria-label="เครื่องมือกระดาน" {...toolsMovable}>
      <MoveHandle id="board-tools" label="แถบเครื่องมือกระดาน" />
      <button aria-label="เลือก Token" aria-pressed={tool === 'token'} onClick={() => setTool('token')} title="เลือกและลาก Token (V) · ลากที่ว่างเพื่อเลื่อนกระดาน · กดค้างแล้วลาก (หรือ Shift+ลาก) เพื่อครอบหลายตัว">
        <MousePointer2 size={16} aria-hidden="true" /><span className="board-tool-label">เลือก Token</span></button>
      <button aria-label="วัดระยะ" aria-pressed={tool === 'measure'} onClick={() => setTool('measure')} title="วัดระยะ (R)">
        <Ruler size={16} aria-hidden="true" /><span className="board-tool-label">วัดระยะ</span></button>
      <button aria-label="แสดง Grid" aria-pressed={gridPref} onClick={() => usePrefs.getState().update({ showGrid: !gridPref })} title="แสดงหรือซ่อนเส้น Grid (G)">
        <Grid3x3 size={16} aria-hidden="true" /></button>
      {dm && command && <button aria-label="เครื่องมือฉาก" aria-pressed={visionOpen} onClick={() => setVisionOpen(open => !open)} title="ผนัง ประตู แสง ความมืด Difficult Terrain และการมองเห็นของผู้เล่น">
        <EyeIcon size={16} aria-hidden="true" /></button>}
      <span className="board-tools-sep" aria-hidden="true" />
      <button aria-label="ซูมออก" title="ซูมออก (ล้อเมาส์ หรือหยิกสองนิ้ว)" onClick={() => zoomAt(1 / 1.2, center)}><Minus size={16} aria-hidden="true" /></button>
      <button aria-label="พอดีกระดาน" title="พอดีกระดาน" className="board-zoom" onClick={fit}>{Math.round(zoom * 100)}%</button>
      <button aria-label="ซูมเข้า" title="ซูมเข้า" onClick={() => zoomAt(1.2, center)}><Plus size={16} aria-hidden="true" /></button>
      <button aria-label="คำสั่งกระดาน" title="คำสั่งของ Token ที่เลือก หรือของกระดาน" onClick={() => {
        const token = scene.tokens.find(item => item.actorId === selected)
        setMenu({ pixel: center, cell: cell(center), token })
      }}><MoreHorizontal size={16} aria-hidden="true" /></button>
    </div>
    {dm && command && visionOpen && <VisionToolbar scene={scene} members={room.members} tool={visionTool} setTool={setVisionTool} selectedWalls={wallSel.length}
      viewAs={viewAs} setViewAs={setViewAs} command={command} />}
    {menu && <div className="context-popover" ref={menuRef} aria-label="คำสั่งตามตำแหน่ง" role="group"
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeMenu() } }}>
      <strong>{menu.door ? 'ประตู' : menu.token ? creature(menu.token)?.name ?? 'Token' : menu.object?.name ?? 'กระดาน'}</strong>
      {boardActions.map(action => <button key={action.label} disabled={action.disabled} onClick={() => {
        closeMenu()
        action.run()
      }}>{action.label}</button>)}
      <button onClick={closeMenu}>ปิดเมนูคลิกขวา</button>
    </div>}
    {showBar && barTarget && <div className="selection-bar" role="toolbar" aria-label={'คำสั่งของ ' + (barActor?.name ?? barObject?.name ?? '')}>
      <span className="selection-bar-name">
        <Crosshair size={14} aria-hidden="true" />
        <b>{barActor?.name ?? barObject?.name}</b>
        {barActor && <span className="selection-bar-hp">{barActor.hp}/{barActor.maxHp} HP{barSheet ? ' · AC ' + barSheet.ac : ''}</span>}
        {barActor && (barActor.conditions || barActor.effects?.length) ? <span className="selection-bar-conditions"><ConditionBadges creature={barActor} max={4} /></span> : null}
        {barBudget && <span className={'selection-bar-move' + (barBudget.used > barBudget.speed ? ' over' : '')} title={barBudget.reasons.join(' · ') || undefined}>
          เดินแล้ว {barBudget.used}/{barBudget.speed} ฟุต{barBudget.reasons.length ? ' · ' + barBudget.reasons[0] : ''}</span>}
      </span>
      {barSheet && (dm || barSheet.ownerId === room.me.id) && <TurnChips actor={barSheet} scene={scene} command={command} />}
      {canCondition && <button type="button" aria-pressed={conditionsOpen} onClick={() => setConditionsOpen(open => !open)}>สภาพ</button>}
      {canCondition && conditionsOpen && barSheet && <span className="selection-bar-chips" role="group" aria-label={'สภาพของ ' + barSheet.name}>
        {srdConditions.filter(name => name !== 'Exhaustion').map(name => {
          const on = parseConditions(barSheet.conditions).some(item => item.name === name)
          return <button key={name} type="button" className="bh-chip" aria-pressed={on} onClick={() => toggleCondition(name)}>{name}</button>
        })}
      </span>}
      {quickHp && barActor && <form className="quick-hp" onSubmit={async event => {
        event.preventDefault()
        const field = event.currentTarget.elements.namedItem('hp') as HTMLInputElement
        if (await quickHp(barActor.id, field.value)) field.value = ''
      }}><input name="hp" aria-label={'ปรับ HP ของ ' + barActor.name} placeholder="±HP" inputMode="numeric" title="ใส่ 8 เพื่อรักษา หรือ -15 เพื่อลด HP แล้วกด Enter" /></form>}
      {barActions.map(action => <button key={action.label} type="button" disabled={action.disabled}
        {...(action.roll ? rollMenuProps(action.roll, { odds: action.odds, title: action.label }) : {})} onClick={action.run}>{action.label}</button>)}
    </div>}
    {place && <div className="placing">{placementLabel ?? 'คลิกช่องเพื่อวาง Token'}</div>}
    {areaKind && areaLabel && !place && <div className="placing">{areaLabel}</div>}
    {dragBudget && <div className={'move-budget' + (dragBudget.used > dragBudget.speed ? ' over' : '')} role="status">
      เดิน {dragBudget.used}/{dragBudget.speed} ฟุต{dragBudget.used > dragBudget.speed ? ' · เกิน Speed' : ''}</div>}
    {selectionCount > 1 && <div className="selection-count" role="status">เลือก {selectionCount} {objectGroup.length ? 'ชิ้น' : 'Token'}</div>}
    <div className="scale">1 ช่อง · 5 ฟุต</div>
  </section>
}
