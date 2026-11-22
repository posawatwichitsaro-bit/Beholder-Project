import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { sizes } from '../shared/model.ts'
import type { Scene, Snapshot, Token } from '../shared/model.ts'

type Point = { x: number; y: number }
type Props = {
  room: Snapshot; scene: Scene; selected: string; select: (id: string) => void
  move: (token: Token, position: Point) => void; place?: (position: Point) => void
}
const palette = ['#d2a557', '#83b6aa', '#bba3d4', '#d68878']

export function Board({ room, scene, selected, select, move, place }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ x: 640, y: 480 })
  const [camera, setCamera] = useState({ x: 36, y: 36 })
  const [zoom, setZoom] = useState(1)
  const [map, setMap] = useState<HTMLImageElement>()
  const [tool, setTool] = useState<'token' | 'pan' | 'measure'>('token')
  const [draft, setDraft] = useState<{ tokenId: string; point: Point }>()
  const [ruler, setRuler] = useState<{ from: Point; to: Point }>()
  const gesture = useRef<{ from: Point; camera: Point; token?: Token; position?: Point; measure?: boolean; changed?: boolean } | null>(null)

  useEffect(() => {
    const element = canvas.current!
    const observer = new ResizeObserver(([entry]) => setSize({ x: entry.contentRect.width, y: entry.contentRect.height }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    setMap(undefined)
    if (!scene.map) return
    const image = new Image()
    image.onload = () => setMap(image)
    image.src = '/api/rooms/' + room.id + '/maps/' + scene.map.id
    return () => { image.onload = null }
  }, [room.id, scene.map?.id])

  const grid = scene.cell * zoom
  const origin = { x: camera.x + scene.originX * zoom, y: camera.y + scene.originY * zoom }
  const pixel = (point: Point): Point => ({ x: origin.x + point.x * grid, y: origin.y + point.y * grid })
  const cell = (point: Point, step = 1): Point => ({
    x: Math.floor((point.x - origin.x) / grid / step) * step,
    y: Math.floor((point.y - origin.y) / grid / step) * step
  })
  const creature = (token: Token) => room.publicActors.find(actor => actor.id === token.actorId)
  function span(token: Token) { return sizes[creature(token)?.size ?? 'Medium'] }
  const current = scene.combat?.order[scene.combat.turn]?.actorId

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
    for (const [index, token] of scene.tokens.entries()) {
      const position = pixel(draft?.tokenId === token.id ? draft.point : token)
      const width = grid * span(token)
      const radius = width * .42
      const x = position.x + width / 2
      const y = position.y + width / 2
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fillStyle = '#1b2424'
      ctx.fill()
      ctx.strokeStyle = current === token.actorId ? '#ffdda1' : palette[index % palette.length]
      ctx.lineWidth = selected === token.actorId ? 4 : 2
      ctx.stroke()
      ctx.fillStyle = '#f4ead3'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '600 ' + Math.max(7, Math.min(width / 3, 25)) + 'px system-ui'
      ctx.fillText(creature(token)?.name.slice(0, 2).toUpperCase() ?? '?', x, y)
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
  }, [size, map, camera, zoom, grid, scene, room.publicActors, selected, draft, ruler])

  function pointer(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  function down(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 && event.button !== 1) return
    const point = pointer(event)
    const token = [...scene.tokens].reverse().find(token => {
      const at = pixel(token)
      const width = span(token) * grid
      return point.x >= at.x && point.x < at.x + width && point.y >= at.y && point.y < at.y + width
    })
    if (place && tool === 'token' && event.button === 0) { place(cell(point)); return }
    const measure = tool === 'measure' && event.button === 0
    if (measure) setRuler({ from: cell(point), to: cell(point) })
    else setRuler(undefined)
    if (token && tool === 'token' && event.button === 0) {
      select(token.actorId)
      if (room.me.role !== 'dm' && !room.actors.some(actor => actor.id === token.actorId)) return
    }
    gesture.current = { from: point, camera, measure, token: tool === 'token' && event.button === 0 ? token : undefined }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function drag(event: PointerEvent<HTMLCanvasElement>) {
    const action = gesture.current
    if (!action) return
    const point = pointer(event)
    const dx = point.x - action.from.x
    const dy = point.y - action.from.y
    if (action.measure) { setRuler({ from: cell(action.from), to: cell(point) }); return }
    if (!action.changed && Math.hypot(dx, dy) < 4) return
    action.changed = true
    if (action.token) {
      const step = span(action.token) === .5 ? .5 : 1
      action.position = {
        x: action.token.x + Math.round(dx / grid / step) * step,
        y: action.token.y + Math.round(dy / grid / step) * step
      }
      setDraft({ tokenId: action.token.id, point: action.position })
    } else setCamera({ x: action.camera.x + dx, y: action.camera.y + dy })
  }
  function up() {
    const action = gesture.current
    if (action?.token && action.position) move(action.token, action.position)
    gesture.current = null
    setDraft(undefined)
  }

  return <section className="board">
    <canvas ref={canvas} aria-label="กระดานแผนที่" onPointerDown={down} onPointerMove={drag} onPointerUp={up}
      onPointerCancel={() => { gesture.current = null; setDraft(undefined) }} />
    <div className="board-tools">
      <button aria-pressed={tool === 'token'} onClick={() => setTool('token')}>Token</button>
      <button aria-pressed={tool === 'pan'} onClick={() => setTool('pan')}>เลื่อน</button>
      <button aria-pressed={tool === 'measure'} onClick={() => setTool('measure')}>วัดระยะ</button>
      <button aria-label="ซูมออก" onClick={() => setZoom(value => Math.max(.3, value / 1.2))}>−</button>
      <button onClick={() => { setZoom(1); setCamera({ x: 36, y: 36 }) }}>{Math.round(zoom * 100)}%</button>
      <button aria-label="ซูมเข้า" onClick={() => setZoom(value => Math.min(4, value * 1.2))}>+</button>
    </div>
    {place && <div className="placing">คลิกช่องเพื่อวาง Token</div>}
    <div className="scale">1 ช่อง · 5 ฟุต</div>
  </section>
}
