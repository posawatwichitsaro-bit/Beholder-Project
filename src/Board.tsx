import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { damageKinds, sizes } from '../shared/model.ts'
import { areaContains, areaOutline, validArea } from '../shared/area.ts'
import type { Area, AreaKind, AreaOutline } from '../shared/area.ts'
import type { Scene, SceneObject, Snapshot, Token } from '../shared/model.ts'

type Point = { x: number; y: number }
type Action = { label: string; run: () => void; disabled?: boolean }
type Props = {
  room: Snapshot; scene: Scene; selected: string; targetId?: string; select: (id: string) => void
  move: (tokenIds: string[], delta: Point) => void; place?: (position: Point) => void
  actions: (token: Token | undefined, position: Point, object?: SceneObject) => Action[]
  focus?: { actorId: string; sequence: number }; areaKind?: AreaKind; preview?: Area; onArea?: (area: Area) => void
}
const palette = ['#d2a557', '#83b6aa', '#bba3d4', '#d68878']
const objectColors = { container: '#775c31', prop: '#4b6661', structure: '#636978', item: '#74658e' }
type Gesture = { from: Point; camera: Point; mode: 'pan' | 'measure' | 'select' | 'move' | 'area'; tokens: Token[]; delta?: Point }
const bounds = (from: Point, to: Point) => ({
  x: Math.min(from.x, to.x), y: Math.min(from.y, to.y),
  width: Math.abs(from.x - to.x), height: Math.abs(from.y - to.y)
})
function hpBar(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, hp: number, maxHp: number, temp = 0) {
  const ratio = Math.max(0, Math.min(1, hp / maxHp))
  ctx.fillStyle = '#111616'
  ctx.fillRect(x - 1, y - 1, width + 2, 7)
  ctx.fillStyle = '#422b29'
  ctx.fillRect(x, y, width, 5)
  ctx.fillStyle = ratio > .5 ? '#80c69a' : ratio > .25 ? '#e2b66d' : '#e47767'
  ctx.fillRect(x, y, width * ratio, 5)
  if (temp > 0) {
    ctx.fillStyle = '#81bbd7'
    ctx.fillRect(x, y + 5, width * Math.min(1, temp / maxHp), 2)
  }
}

export function Board({ room, scene, selected, targetId, select, move, place, actions, focus, areaKind, preview, onArea }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ x: 640, y: 480 })
  const [camera, setCamera] = useState({ x: 36, y: 36 })
  const [zoom, setZoom] = useState(1)
  const [map, setMap] = useState<HTMLImageElement>()
  const [tool, setTool] = useState<'token' | 'measure'>('token')
  const [group, setGroup] = useState<string[]>([])
  const [draft, setDraft] = useState<{ tokenIds: string[]; delta: Point }>()
  const [selection, setSelection] = useState<{ from: Point; to: Point }>()
  const [areaDraft, setAreaDraft] = useState<Area>()
  const [ruler, setRuler] = useState<{ from: Point; to: Point }>()
  const [menu, setMenu] = useState<{ pixel: Point; cell: Point; token?: Token; object?: SceneObject }>()
  const menuRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const images = useRef(new Map<string, HTMLImageElement>())
  const [imageRevision, repaintImages] = useState(0)
  const placing = Boolean(place)
  useEffect(() => { if (placing) setTool('token') }, [placing])

  useEffect(() => {
    const element = canvas.current!
    const observer = new ResizeObserver(([entry]) => setSize({ x: entry.contentRect.width, y: entry.contentRect.height }))
    observer.observe(element)
    const zoomWheel = (event: WheelEvent) => {
      event.preventDefault()
      const bounds = element.getBoundingClientRect()
      zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, { x: event.clientX - bounds.left, y: event.clientY - bounds.top })
    }
    const keyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
        document.querySelector('.scrim, .table-drawer:not([hidden])') ||
        (event.target instanceof HTMLElement && event.target.closest('input,select,textarea,button,[contenteditable]'))) return
      if (event.key.toLowerCase() === 'r') setTool('measure')
      if (event.key.toLowerCase() === 'v') setTool('token')
      if (event.key === 'Escape') setGroup([])
    }
    element.addEventListener('wheel', zoomWheel, { passive: false })
    window.addEventListener('keydown', keyDown)
    return () => {
      observer.disconnect()
      element.removeEventListener('wheel', zoomWheel)
      window.removeEventListener('keydown', keyDown)
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

  const grid = scene.cell * zoom
  const origin = { x: camera.x + scene.originX * zoom, y: camera.y + scene.originY * zoom }
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
  useEffect(() => {
    setEffectTime(Date.now())
    const timer = setTimeout(() => setEffectTime(Date.now()), 1500)
    return () => clearTimeout(timer)
  }, [scene.areaEffect?.at])
  function zoomAt(factor: number, at: Point) {
    const previous = transform.current
    const next = Math.max(.08, Math.min(4, previous.zoom * factor))
    const scale = next / previous.zoom
    view({ x: at.x - (at.x - previous.camera.x) * scale, y: at.y - (at.y - previous.camera.y) * scale }, next)
  }
  function fit() {
    if (!map) { view({ x: 36, y: 36 }, 1); return }
    const next = Math.max(.08, Math.min(4, (size.x - 48) / map.width, (size.y - 96) / map.height))
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

  useEffect(() => {
    const element = canvas.current!
    const ctx = element.getContext('2d')!
    const ratio = window.devicePixelRatio || 1
    element.width = Math.floor(size.x * ratio)
    element.height = Math.floor(size.y * ratio)
    ctx.scale(ratio, ratio)
    ctx.fillStyle = '#222929'
    ctx.fillRect(0, 0, size.x, size.y)
    if (map) ctx.drawImage(map, camera.x, camera.y, map.width * zoom, map.height * zoom)
    const wrap = (value: number) => ((value % grid) + grid) % grid
    ctx.beginPath()
    ctx.strokeStyle = map ? '#111b1baa' : '#42504c'
    for (let x = wrap(origin.x); x < size.x; x += grid) { ctx.moveTo(x, 0); ctx.lineTo(x, size.y) }
    for (let y = wrap(origin.y); y < size.y; y += grid) { ctx.moveTo(0, y); ctx.lineTo(size.x, y) }
    ctx.stroke()
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
    for (const object of scene.objects ?? []) {
      const at = pixel(object)
      const width = object.width * grid
      const height = object.height * grid
      const destroyed = object.kind === 'structure' && object.hp <= 0
      const picture = object.image && images.current.get(object.image)
      ctx.save()
      ctx.globalAlpha = destroyed ? .38 : .9
      ctx.fillStyle = objectColors[object.kind]
      ctx.fillRect(at.x + 2, at.y + 2, width - 4, height - 4)
      if (picture && picture.complete && picture.naturalWidth) ctx.drawImage(picture, at.x + 2, at.y + 2, width - 4, height - 4)
      ctx.fillStyle = '#171e1eee'
      ctx.fillRect(at.x + 2, at.y + Math.max(2, height - 16), width - 4, Math.min(height - 4, 14))
      ctx.fillStyle = '#fff1d8'
      ctx.font = '11px system-ui'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      if (height >= 18 && width >= 18) ctx.fillText(object.name, at.x + width / 2, at.y + height - 9, width - 7)
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
      ctx.fillStyle = '#1b2424'
      ctx.fill()
      const portrait = actor?.portrait && images.current.get(actor.portrait)
      if (portrait && portrait.complete && portrait.naturalWidth) {
        const edge = Math.min(portrait.naturalWidth, portrait.naturalHeight)
        ctx.save()
        ctx.clip()
        ctx.drawImage(portrait, (portrait.naturalWidth - edge) / 2, (portrait.naturalHeight - edge) / 2, edge, edge,
          x - radius, y - radius, 2 * radius, 2 * radius)
        ctx.restore()
      }
      const affected = outline && areaContains(outline, { x: token.x + span(token) / 2, y: token.y + span(token) / 2 })
      ctx.strokeStyle = affected || targetId === token.actorId ? '#ff9e88' : group.includes(token.id) ? '#91d3f2' : current === token.actorId ? '#ffdda1' : palette[index % palette.length]
      ctx.lineWidth = affected || targetId === token.actorId || group.includes(token.id) || selected === token.actorId ? 4 : 2
      ctx.stroke()
      ctx.fillStyle = '#f4ead3'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '600 ' + Math.max(7, Math.min(width / 3, 25)) + 'px system-ui'
      if (!portrait || !portrait.complete || !portrait.naturalWidth) ctx.fillText(actor?.name.slice(0, 2).toUpperCase() ?? '?', x, y)
      if (actor && width >= 16) hpBar(ctx, x - radius, y + radius - 4, 2 * radius, actor.hp, actor.maxHp, actor.tempHp)
    }
    if (ruler) {
      const center = (point: Point) => pixel({ x: point.x + .5, y: point.y + .5 })
      const start = center(ruler.from)
      const end = center(ruler.to)
      const feet = 5 * Math.max(Math.abs(ruler.from.x - ruler.to.x), Math.abs(ruler.from.y - ruler.to.y))
      ctx.strokeStyle = '#ffd38b'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
      ctx.stroke()
      ctx.fillStyle = '#182020'
      ctx.fillRect(end.x + 8, end.y - 30, 72, 25)
      ctx.fillStyle = '#ffd38b'
      ctx.textAlign = 'left'
      ctx.font = '14px system-ui'
      ctx.fillText(feet + ' ฟุต', end.x + 15, end.y - 17)
    }
    if (selection) {
      const rect = bounds(selection.from, selection.to)
      ctx.fillStyle = '#91d3f233'
      ctx.strokeStyle = '#91d3f2'
      ctx.lineWidth = 1
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
    }
  }, [size, map, camera, zoom, grid, scene, room.publicActors, selected, targetId, draft, ruler, group, selection, imageRevision, outline, effectTime])

  function pointer(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  function down(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 && event.button !== 1) return
    const point = pointer(event)
    const token = tokenAt(point)
    const pan = event.button === 1
    if (pan) event.preventDefault()
    if (areaKind && !pan && !place) {
      gesture.current = { from: point, camera, mode: 'area', tokens: [] }
      setAreaDraft({ kind: areaKind, from: areaPoint(point), to: areaPoint(point) })
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (place && tool === 'token' && !pan) { place(cell(point)); return }
    const measure = tool === 'measure' && !pan
    if (measure) setRuler({ from: cell(point), to: cell(point) })
    else setRuler(undefined)
    if (token && !measure && !pan) {
      select(token.actorId)
      if (!canMove(token)) return
    }
    const mode = pan ? 'pan' : measure ? 'measure' : token ? 'move' : 'select'
    const tokens = mode === 'move' && token
      ? group.includes(token.id) ? scene.tokens.filter(item => group.includes(item.id) && canMove(item)) : [token]
      : []
    if (mode === 'move' && token && !group.includes(token.id)) setGroup([token.id])
    gesture.current = { from: point, camera, mode, tokens }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function canMove(token: Token) {
    return room.me.role === 'dm' || room.actors.some(actor => actor.id === token.actorId)
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
  function drag(event: PointerEvent<HTMLCanvasElement>) {
    const action = gesture.current
    if (!action) return
    const point = pointer(event)
    const dx = point.x - action.from.x
    const dy = point.y - action.from.y
    if (action.mode === 'area' && areaKind) setAreaDraft({ kind: areaKind, from: areaPoint(action.from), to: areaPoint(point) })
    else if (action.mode === 'measure') setRuler({ from: cell(action.from), to: cell(point) })
    else if (action.mode === 'select') setSelection({ from: action.from, to: point })
    else if (action.mode === 'move') {
      const step = action.tokens.every(token => span(token) === .5) ? .5 : 1
      action.delta = { x: Math.round(dx / grid / step) * step, y: Math.round(dy / grid / step) * step }
      setDraft({ tokenIds: action.tokens.map(token => token.id), delta: action.delta })
    } else view({ x: action.camera.x + dx, y: action.camera.y + dy }, zoom)
  }
  function up(event: PointerEvent<HTMLCanvasElement>) {
    const action = gesture.current
    if (action?.mode === 'area' && areaKind) {
      const area = { kind: areaKind, from: areaPoint(action.from), to: areaPoint(pointer(event)) }
      if (validArea(area)) onArea?.(area)
      setAreaDraft(undefined)
    } else if (action?.mode === 'move' && action.delta && (action.delta.x || action.delta.y)) {
      move(action.tokens.map(token => token.id), action.delta)
    } else if (action?.mode === 'select') {
      const rect = bounds(action.from, pointer(event))
      const found = rect.width > 3 && rect.height > 3 ? scene.tokens.filter(token => {
        const at = pixel(token)
        const width = span(token) * grid
        return canMove(token) && at.x < rect.x + rect.width && at.x + width > rect.x && at.y < rect.y + rect.height && at.y + width > rect.y
      }).slice(0, 100) : []
      setGroup(found.map(token => token.id))
      select(found[0]?.actorId ?? '')
    }
    gesture.current = null
    setDraft(undefined)
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
  return <section className="board">
    <canvas ref={canvas} className={areaKind ? 'drawing-aoe' : undefined} tabIndex={0} aria-label="กระดานแผนที่" onPointerDown={down} onPointerMove={drag} onPointerUp={up}
      onContextMenu={event => {
        event.preventDefault()
        const bounds = event.currentTarget.getBoundingClientRect()
        const point = event.clientX || event.clientY ? { x: event.clientX - bounds.left, y: event.clientY - bounds.top } : center
        const token = tokenAt(point)
        if (token) select(token.actorId)
        setMenu({ pixel: point, cell: cell(point), token, object: token ? undefined : objectAt(point) })
      }}
      onPointerCancel={() => { gesture.current = null; setDraft(undefined); setSelection(undefined); setAreaDraft(undefined) }} />
    {(scene.damageEvents ?? []).filter(event => Date.now() - event.at < 2400).map(event => {
      const token = scene.tokens.find(item => item.actorId === event.actorId)
      if (!token) return null
      const position = pixel({ x: token.x + span(token) / 2, y: token.y })
      const [label, color] = damageKinds[event.kind]
      return <span key={event.id} className="floating-damage" style={{ left: position.x, top: position.y, color }}
        aria-label={'เสีย HP ' + event.amount + ' · ' + label}>−{event.amount}</span>
    })}
    <div className="board-tools">
      <button aria-pressed={tool === 'token'} onClick={() => setTool('token')}>เลือก Token</button>
      <button aria-pressed={tool === 'measure'} onClick={() => setTool('measure')}>วัดระยะ</button>
      <button aria-label="ซูมออก" onClick={() => zoomAt(1 / 1.2, center)}>−</button>
      <button aria-label="พอดีกระดาน" onClick={fit}>{Math.round(zoom * 100)}%</button>
      <button aria-label="ซูมเข้า" onClick={() => zoomAt(1.2, center)}>+</button>
      <button aria-label="คำสั่งกระดาน" onClick={() => {
        const token = scene.tokens.find(item => item.actorId === selected)
        setMenu({ pixel: center, cell: cell(center), token })
      }}>⋯</button>
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
    {place && <div className="placing">คลิกช่องเพื่อวาง Token</div>}
    {group.length > 1 && <div className="selection-count" role="status">เลือก {group.length} Token</div>}
    <div className="scale">1 ช่อง · 5 ฟุต</div>
  </section>
}
