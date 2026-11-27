import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { Crosshair, Grid3x3, Maximize, Minus, MousePointer2, MoreHorizontal, Plus, Ruler } from 'lucide-react'
import { damageKinds, sizes } from '../../../shared/model.ts'
import { areaContains, areaOutline, validArea } from '../../../shared/area.ts'
import type { Area, AreaKind, AreaOutline } from '../../../shared/area.ts'
import { tokenColor, tokenInitials } from './tokenAppearance.ts'
import { newStrikes } from './strikes.ts'
import type { Strike } from './strikes.ts'
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
import { isMonsterArt, sceneArtByImage } from '../../../shared/catalogArt.ts'

type Action = { label: string; run: () => void; disabled?: boolean }
type Props = {
  room: Snapshot; scene: Scene; selected: string; targetId?: string; select: (id: string) => void
  move: (tokenIds: string[], delta: Point) => void; place?: (position: Point) => void
  copy: (tokenIds: string[], objectIds: string[]) => void
  paste: (position?: Point) => void
  placementLabel?: string
  mainTokenId?: string
  actions: (token: Token | undefined, position: Point, object?: SceneObject) => Action[]
  focus?: { actorId: string; sequence: number }; areaKind?: AreaKind; preview?: Area; onArea?: (area: Area) => void
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
}
const objectColors = { container: '#6e5432', prop: '#4b5e58', structure: '#5c5a66', item: '#6a5470' }
type Mode = 'pan' | 'measure' | 'select' | 'move' | 'area' | 'object' | 'calibrate'
type Gesture = {
  from: Point; camera: Point; mode: Mode; tokens: Token[]; delta?: Point
  moved: boolean; token?: Token; object?: SceneObject
}
const bounds = (from: Point, to: Point) => ({
  x: Math.min(from.x, to.x), y: Math.min(from.y, to.y),
  width: Math.abs(from.x - to.x), height: Math.abs(from.y - to.y)
})
function hpBar(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, hp: number, maxHp: number, temp = 0, foe = false) {
  const ratio = Math.max(0, Math.min(1, hp / maxHp))
  ctx.fillStyle = '#120b09'
  ctx.fillRect(x - 1, y - 1, width + 2, 7)
  ctx.fillStyle = '#3a1c16'
  ctx.fillRect(x, y, width, 5)
  ctx.fillStyle = ratio > .5 ? (foe ? '#c0503a' : '#6aae58') : ratio > .25 ? '#d0902a' : '#e0473a'
  ctx.fillRect(x, y, width * ratio, 5)
  if (temp > 0) {
    ctx.fillStyle = '#8fb0e0'
    ctx.fillRect(x, y + 5, width * Math.min(1, temp / maxHp), 2)
  }
}
function drawContained(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight)
  const w = image.naturalWidth * scale
  const h = image.naturalHeight * scale
  ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h)
}
const editableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && Boolean(target.closest('input,select,textarea,[contenteditable]'))

export function Board({ room, scene, selected, targetId, select, move, copy, paste, place, placementLabel, mainTokenId, actions, focus, areaKind, preview, onArea, drop, moveObject, calibrate, gridOverride, quickHp }: Props) {
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
  const [menu, setMenu] = useState<{ pixel: Point; cell: Point; token?: Token; object?: SceneObject }>()
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
      if (event.key === 'Escape') { setGroup([]); setObjectGroup([]); setSelectedObject(undefined); setRuler(undefined) }
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
  useEffect(() => {
    setMap(undefined)
    if (!scene.map) return
    const image = new Image()
    image.onload = () => setMap(image)
    image.src = '/api/rooms/' + room.id + '/maps/' + scene.map.id
    return () => { image.onload = null }
  }, [room.id, scene.map?.id])
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
  const grid = gridCell * zoom
  const origin = { x: camera.x + (gridOverride?.originX ?? scene.originX) * zoom, y: camera.y + (gridOverride?.originY ?? scene.originY) * zoom }
  const pixel = (point: Point): Point => ({ x: origin.x + point.x * grid, y: origin.y + point.y * grid })
  const cell = (point: Point, step = 1): Point => ({
    x: Math.floor((point.x - origin.x) / grid / step) * step,
    y: Math.floor((point.y - origin.y) / grid / step) * step
  })
  const areaPoint = (point: Point): Point => ({
    x: Math.round((point.x - origin.x) / grid * 2) / 2,
    y: Math.round((point.y - origin.y) / grid * 2) / 2
  })
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
  const [effectTime, setEffectTime] = useState(Date.now)
  const toolsMovable = useMovable('board-tools')
  // Attack animations: a slash for melee, a bolt for ranged, played once per new attack roll.
  const seenRolls = useRef<Set<string> | undefined>(undefined)
  const [strikes, setStrikes] = useState<Strike[]>([])
  useEffect(() => {
    if (!seenRolls.current) { seenRolls.current = new Set(room.rolls.map(roll => roll.id)); return }
    const fresh = newStrikes(room.rolls, scene.tokens, scene.id, seenRolls.current, Date.now(), span)
    if (!fresh.length) return
    setStrikes(current => [...current, ...fresh])
    const timer = setTimeout(() => setStrikes(current => current.filter(strike => !fresh.includes(strike))), 1100)
    return () => clearTimeout(timer)
  }, [room.rolls])
  useEffect(() => {
    setEffectTime(Date.now())
    const timer = setTimeout(() => setEffectTime(Date.now()), 1500)
    return () => clearTimeout(timer)
  }, [scene.areaEffect?.at])
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

  useEffect(() => {
    const element = canvas.current!
    const ctx = element.getContext('2d')!
    const ratio = window.devicePixelRatio || 1
    element.width = Math.floor(size.x * ratio)
    element.height = Math.floor(size.y * ratio)
    ctx.scale(ratio, ratio)
    ctx.fillStyle = '#1d1714'
    ctx.fillRect(0, 0, size.x, size.y)
    if (map) ctx.drawImage(map, camera.x, camera.y, map.width * zoom, map.height * zoom)
    const wrap = (value: number) => ((value % grid) + grid) % grid
    if (showGrid) {
      ctx.beginPath()
      ctx.strokeStyle = map ? '#140d0a99' : '#f5e3c01c'
      for (let x = wrap(origin.x); x < size.x; x += grid) { ctx.moveTo(x, 0); ctx.lineTo(x, size.y) }
      for (let y = wrap(origin.y); y < size.y; y += grid) { ctx.moveTo(0, y); ctx.lineTo(size.x, y) }
      ctx.stroke()
    }
    function drawArea(shape: AreaOutline, color: string) {
      ctx.save()
      ctx.beginPath()
      if ('radius' in shape) {
        const point = pixel(shape.center)
        ctx.arc(point.x, point.y, shape.radius * grid, 0, 2 * Math.PI)
      } else {
        for (const [index, point] of shape.points.entries()) {
          const at = pixel(point)
          if (index === 0) ctx.moveTo(at.x, at.y)
          else ctx.lineTo(at.x, at.y)
        }
        ctx.closePath()
      }
      ctx.fillStyle = color + '45'
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
    if (scene.areaEffect && effectTime - scene.areaEffect.at < 1450) drawArea(areaOutline(scene.areaEffect.area), damageKinds[scene.areaEffect.kind][1])
    if (outline) drawArea(outline, '#ffb384')
    if (dropCell) {
      const at = pixel(dropCell)
      ctx.save()
      ctx.fillStyle = '#e0b87833'
      ctx.strokeStyle = '#e0b878'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.fillRect(at.x, at.y, grid, grid)
      ctx.strokeRect(at.x + 1, at.y + 1, grid - 2, grid - 2)
      ctx.restore()
    }
    for (const object of scene.objects ?? []) {
      const shift = objectDraft?.id === object.id ? objectDraft.delta : { x: 0, y: 0 }
      const at = pixel({ x: object.x + shift.x, y: object.y + shift.y })
      const width = object.width * grid
      const height = object.height * grid
      const destroyed = object.kind === 'structure' && object.hp <= 0
      const picture = object.image && images.current.get(object.image)
      ctx.save()
      ctx.globalAlpha = destroyed ? .38 : .92
      if (object.image && sceneArtByImage(object.image) && picture && picture.complete && picture.naturalWidth) {
        drawContained(ctx, picture, at.x + 2, at.y + 2, Math.max(1, width - 4), Math.max(1, height - 4))
      } else {
        ctx.fillStyle = objectColors[object.kind]
        ctx.fillRect(at.x + 2, at.y + 2, width - 4, height - 4)
        if (picture && picture.complete && picture.naturalWidth) ctx.drawImage(picture, at.x + 2, at.y + 2, width - 4, height - 4)
      }
      ctx.fillStyle = '#150e0bee'
      ctx.fillRect(at.x + 2, at.y + Math.max(2, height - 16), width - 4, Math.min(height - 4, 14))
      ctx.fillStyle = '#f6e7cc'
      ctx.font = '11px Sarabun, system-ui'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      if (height >= 18 && width >= 18) ctx.fillText(object.name, at.x + width / 2, at.y + height - 9, width - 7)
      if (selectedObject === object.id || objectGroup.includes(object.id)) {
        ctx.globalAlpha = 1
        ctx.strokeStyle = '#e0b878'
        ctx.lineWidth = 3
        ctx.strokeRect(at.x + 1, at.y + 1, width - 2, height - 2)
      }
      ctx.restore()
      if (object.kind === 'structure' && !destroyed && width > 16) hpBar(ctx, at.x + 5, at.y + 5, width - 10, object.hp, object.maxHp)
    }
    for (const [index, token] of scene.tokens.entries()) {
      const delta = draft?.tokenIds.includes(token.id) ? draft.delta : undefined
      const position = pixel({ x: token.x + (delta?.x ?? 0), y: token.y + (delta?.y ?? 0) })
      const actor = creature(token)
      const width = grid * span(token)
      const radius = width * .42
      const x = position.x + width / 2
      const y = position.y + width / 2
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      const portrait = actor?.portrait && images.current.get(actor.portrait)
      const ready = portrait && portrait.complete && portrait.naturalWidth
      if (ready && actor?.portrait && isMonsterArt(actor.portrait)) {
        drawContained(ctx, portrait, position.x, position.y, width, width)
      } else {
        ctx.fillStyle = '#2a1f18'
        ctx.fill()
      }
      if (ready && actor?.portrait && !isMonsterArt(actor.portrait)) {
        const edge = Math.min(portrait.naturalWidth, portrait.naturalHeight)
        ctx.save()
        ctx.clip()
        ctx.drawImage(portrait, (portrait.naturalWidth - edge) / 2, (portrait.naturalHeight - edge) / 2, edge, edge,
          x - radius, y - radius, 2 * radius, 2 * radius)
        ctx.restore()
      }
      const affected = outline && areaContains(outline, { x: token.x + span(token) / 2, y: token.y + span(token) / 2 })
      ctx.strokeStyle = affected || targetId === token.actorId ? '#ff9e88' : group.includes(token.id) ? '#9fc4f0' : current === token.actorId ? '#ffd08a' : selected === token.actorId ? '#e0b878' : tokenColor(index)
      ctx.lineWidth = affected || targetId === token.actorId || group.includes(token.id) || selected === token.actorId ? 4 : 2
      ctx.stroke()
      if (current === token.actorId) {
        ctx.save()
        ctx.beginPath()
        ctx.arc(x, y, radius + 5, 0, Math.PI * 2)
        ctx.strokeStyle = '#ff8a3d99'
        ctx.lineWidth = 3
        ctx.shadowColor = '#ff8a3d'
        ctx.shadowBlur = 12
        ctx.stroke()
        ctx.restore()
      }
      if (mainTokenId === token.id) {
        ctx.beginPath()
        ctx.arc(x, y, radius + 3, 0, Math.PI * 2)
        ctx.strokeStyle = '#ffd08a'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      ctx.fillStyle = '#fbefd8'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '700 ' + Math.max(7, Math.min(width / 3, 25)) + 'px "Cormorant Garamond", Sarabun, serif'
      if (!portrait || !portrait.complete || !portrait.naturalWidth) ctx.fillText(actor ? tokenInitials(actor.name) : '?', x, y)
      if (actor && width >= 16) hpBar(ctx, x - radius, y + radius - 4, 2 * radius, actor.hp, actor.maxHp, actor.tempHp, actor.kind === 'monster')
      const conditions = actor ? rankConditions(activeConditions(actor)) : []
      const waiting = actor?.effects?.some(effect => effect.pending)
      if ((conditions.length || waiting) && width >= 20) {
        // Leather-and-brass marks above the token: the two most limiting conditions, then "+N".
        // Zoomed far out there is only room for one mark with the count.
        const size = Math.max(11, Math.min(18, width / 3.2))
        const room = width >= 40 ? 2 : 1
        const marks = conditions.slice(0, room).map(item => conditionGlyph(item.name))
        if (conditions.length > room) marks.push('+' + (conditions.length - room))
        if (waiting) marks.unshift('!')
        const gap = 2
        const total = marks.length * size + (marks.length - 1) * gap
        let mx = x - total / 2
        const my = y - radius - size * .6
        ctx.font = '700 ' + Math.round(size * .55) + 'px Sarabun, system-ui'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        for (const mark of marks) {
          ctx.beginPath()
          ctx.roundRect(mx, my - size / 2, size, size, size * .25)
          ctx.fillStyle = mark === '!' ? '#9e3b3b' : mark.startsWith('+') ? '#3a2b20' : '#2a1f18'
          ctx.fill()
          ctx.strokeStyle = '#c79a5b'
          ctx.lineWidth = 1.25
          ctx.stroke()
          ctx.fillStyle = '#f6e7cc'
          ctx.fillText(mark, mx + size / 2, my + .5)
          mx += size + gap
        }
      }
    }
    if (ruler) {
      const center = (point: Point) => pixel({ x: point.x + .5, y: point.y + .5 })
      const start = center(ruler.from)
      const end = center(ruler.to)
      const feet = 5 * Math.max(Math.abs(ruler.from.x - ruler.to.x), Math.abs(ruler.from.y - ruler.to.y))
      ctx.strokeStyle = '#ffd08a'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
      ctx.stroke()
      ctx.fillStyle = '#211814'
      ctx.fillRect(end.x + 8, end.y - 30, 72, 25)
      ctx.fillStyle = '#ffd08a'
      ctx.textAlign = 'left'
      ctx.font = '14px Sarabun, system-ui'
      ctx.fillText(feet + ' ฟุต', end.x + 15, end.y - 17)
    }
    if (calibration) {
      const rect = bounds(calibration.from, calibration.to)
      ctx.save()
      ctx.fillStyle = '#e0b87833'
      ctx.strokeStyle = '#ffd08a'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
      ctx.restore()
    }
    if (selection) {
      const rect = bounds(selection.from, selection.to)
      ctx.fillStyle = '#9fc4f033'
      ctx.strokeStyle = '#9fc4f0'
      ctx.lineWidth = 1
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
    }
  }, [size, map, camera, zoom, grid, scene, room.publicActors, selected, targetId, mainTokenId, draft, objectDraft, selectedObject, objectGroup, ruler, group, selection, imageRevision, outline, effectTime, dropCell, calibration, showGrid])

  function pointer(event: { clientX: number; clientY: number; currentTarget: Element }) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  function canMove(token: Token) {
    return dm || room.actors.some(actor => actor.id === token.actorId)
  }
  function objectAt(point: Point) {
    return [...(scene.objects ?? [])].reverse().find(object => {
      const at = pixel(object)
      return point.x >= at.x && point.x < at.x + object.width * grid && point.y >= at.y && point.y < at.y + object.height * grid
    })
  }
  function tokenAt(point: Point) {
    return [...scene.tokens].reverse().find(token => {
      const at = pixel(token)
      const width = span(token) * grid
      return point.x >= at.x && point.x < at.x + width && point.y >= at.y && point.y < at.y + width
    })
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
      setAreaDraft({ kind: areaKind, from: areaPoint(point), to: areaPoint(point) })
      return
    }
    if (calibrate && !pan) {
      gesture.current = { from: point, camera, mode: 'calibrate', tokens: [], moved: false }
      setCalibration({ from: point, to: point })
      return
    }
    if (place && tool === 'token' && !pan) { place(cell(point)); return }
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
    if (!pointers.current.has(event.pointerId)) return
    const point = pointer(event)
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
    if (action.mode === 'area' && areaKind) setAreaDraft({ kind: areaKind, from: areaPoint(action.from), to: areaPoint(point) })
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
    if (action?.mode === 'area' && areaKind) {
      const area = { kind: areaKind, from: areaPoint(action.from), to: areaPoint(pointer(event)) }
      if (validArea(area)) onArea?.(area)
      setAreaDraft(undefined)
    } else if (action?.mode === 'move' && action.delta && (action.delta.x || action.delta.y)) {
      move(action.tokens.map(token => token.id), action.delta)
    } else if (action?.mode === 'object' && action.object && action.delta && (action.delta.x || action.delta.y)) {
      moveObject?.(action.object.id, { x: action.object.x + action.delta.x, y: action.object.y + action.delta.y })
    } else if (action?.mode === 'calibrate' && calibrate) {
      const rect = bounds(action.from, pointer(event))
      const view = transform.current
      if (rect.width > 4 && rect.height > 4) calibrate({ x: (rect.x - view.camera.x) / view.zoom, y: (rect.y - view.camera.y) / view.zoom, width: rect.width / view.zoom, height: rect.height / view.zoom })
      setCalibration(undefined)
    } else if (action?.mode === 'select') {
      const rect = bounds(action.from, pointer(event))
      const intersects = (piece: Point, width: number, height: number) => {
        const at = pixel(piece)
        return rect.width > 3 && rect.height > 3 && at.x < rect.x + rect.width && at.x + width * grid > rect.x &&
          at.y < rect.y + rect.height && at.y + height * grid > rect.y
      }
      const found = scene.tokens.filter(token => intersects(token, span(token), span(token))).slice(0, 100)
      const objects = (scene.objects ?? []).filter(object => intersects(object, object.width, object.height)).slice(0, 100 - found.length)
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
  const boardActions: Action[] = menu ? [
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
    <canvas ref={canvas} className={(areaKind || calibrate ? 'drawing-aoe' : '') + (panning ? ' panning' : '') + (tool === 'measure' ? ' measuring' : '')}
      tabIndex={0} aria-label="กระดานแผนที่" onPointerDown={down} onPointerMove={drag} onPointerUp={up}
      onContextMenu={event => {
        event.preventDefault()
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
    {strikes.map(strike => {
      const from = scene.tokens.find(token => token.id === strike.from)
      const to = scene.tokens.find(token => token.id === strike.to)
      if (!from || !to) return null
      const a = pixel({ x: from.x + span(from) / 2, y: from.y + span(from) / 2 })
      const b = pixel({ x: to.x + span(to) / 2, y: to.y + span(to) / 2 })
      const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI
      const style = { left: a.x, top: a.y, '--dx': (b.x - a.x) + 'px', '--dy': (b.y - a.y) + 'px', '--angle': angle + 'deg', '--reach': grid * .6 + 'px' } as CSSProperties
      return strike.ranged
        ? <span key={strike.id} className="strike-bolt" data-outcome={strike.outcome} style={style} aria-hidden="true" />
        : <span key={strike.id} className="strike-slash" data-outcome={strike.outcome} style={{ ...style, left: b.x, top: b.y }} aria-hidden="true" />
    })}
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
      <span className="board-tools-sep" aria-hidden="true" />
      <button aria-label="ซูมออก" title="ซูมออก (ล้อเมาส์ หรือหยิกสองนิ้ว)" onClick={() => zoomAt(1 / 1.2, center)}><Minus size={16} aria-hidden="true" /></button>
      <button aria-label="พอดีกระดาน" title="พอดีกระดาน" className="board-zoom" onClick={fit}>{Math.round(zoom * 100)}%</button>
      <button aria-label="ซูมเข้า" title="ซูมเข้า" onClick={() => zoomAt(1.2, center)}><Plus size={16} aria-hidden="true" /></button>
      <button aria-label="คำสั่งกระดาน" title="คำสั่งของ Token ที่เลือก หรือของกระดาน" onClick={() => {
        const token = scene.tokens.find(item => item.actorId === selected)
        setMenu({ pixel: center, cell: cell(center), token })
      }}><MoreHorizontal size={16} aria-hidden="true" /></button>
    </div>
    {menu && <div className="context-popover" ref={menuRef} aria-label="คำสั่งตามตำแหน่ง" role="group"
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeMenu() } }}>
      <strong>{menu.token ? creature(menu.token)?.name ?? 'Token' : menu.object?.name ?? 'กระดาน'}</strong>
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
      </span>
      {quickHp && barActor && <form className="quick-hp" onSubmit={async event => {
        event.preventDefault()
        const field = event.currentTarget.elements.namedItem('hp') as HTMLInputElement
        if (await quickHp(barActor.id, field.value)) field.value = ''
      }}><input name="hp" aria-label={'ปรับ HP ของ ' + barActor.name} placeholder="±HP" inputMode="numeric" title="ใส่ 8 เพื่อรักษา หรือ -15 เพื่อลด HP แล้วกด Enter" /></form>}
      {barActions.map(action => <button key={action.label} type="button" disabled={action.disabled} onClick={action.run}>{action.label}</button>)}
    </div>}
    {place && <div className="placing">{placementLabel ?? 'คลิกช่องเพื่อวาง Token'}</div>}
    {selectionCount > 1 && <div className="selection-count" role="status">เลือก {selectionCount} {objectGroup.length ? 'ชิ้น' : 'Token'}</div>}
    <div className="scale">1 ช่อง · 5 ฟุต</div>
  </section>
}
