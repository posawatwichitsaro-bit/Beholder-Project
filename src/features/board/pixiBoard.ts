import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import type { AreaOutline } from '../../../shared/area.ts'
import type { Point } from './gestures.ts'
import { gridLines } from './geometry.ts'
import { BoardEffects } from './effects.ts'
import type { Outcome } from './effects.ts'
import type { BoardTransform, Grid, View } from './geometry.ts'
import type { LightSource, Wall } from '../../../shared/vision.ts'

/**
 * What the fog shows, by cell ("x,y"): `visible` cells are clear (lighter in `dimmed`, grey in
 * `darkvision`), `explored` ones show the map faintly, everything else is black.
 * `walls`, `doors` and `lights` are drawn for the DM; players see only doors they know of.
 */
export type VisionLook = {
  fog?: { visible: Set<string>; dimmed: Set<string>; darkvision: Set<string>; explored: Set<string>; opaque: boolean }
  walls: Wall[]; showWalls: boolean
  doors: Wall[]
  lights: LightSource[]
  darkness?: { dark: string[]; magic: string[] }
  /** Points of a wall being drawn (cells), and the pointer, while the DM draws. */
  drawing?: Point[]; cursor?: Point
}

/**
 * The board drawn with PixiJS 8 (WebGL, with Pixi's own canvas fallback).
 * React keeps all state and hit testing; this class only mirrors it:
 *
 *   stage
 *   ├── world      camera: position = camera, scale = zoom (panning moves only this)
 *   │   ├── map
 *   │   ├── areas  templates and the drop cell
 *   │   ├── objects
 *   │   ├── tokens one container per token, rebuilt only when its look changes
 *   │   ├── ruler
 *   │   └── effects
 *   └── screen     grid lines, selection and calibration boxes (screen pixels)
 */
export type HpLook = { hp: number; maxHp: number; temp?: number; foe?: boolean }
export type TokenLook = {
  id: string; x: number; y: number; span: number; name: string; initials: string
  portrait?: HTMLImageElement; monsterArt: boolean
  ring: string; ringWidth: number; current: boolean; main: boolean; faint: boolean
  hp?: HpLook; marks: string[]
}
export type ObjectLook = {
  id: string; x: number; y: number; width: number; height: number; name: string
  color: string; picture?: HTMLImageElement; contained: boolean; faded: boolean; selected: boolean; hp?: HpLook
}
export type Rect = { x: number; y: number; width: number; height: number }
export type Overlay = {
  areas: { shape: AreaOutline; color: string }[]
  dropCell?: Point
  ruler?: { from: Point; to: Point; feet: number }
  selection?: Rect
  calibration?: Rect
}

const serif = '"Cormorant Garamond", Sarabun, serif'
const sans = 'Sarabun, system-ui, sans-serif'
const ink = '#f6e7cc'

/**
 * "?renderer=canvas" (or webgl / webgpu) in the page address forces Pixi's backend: a way out on a
 * machine whose GPU driver misbehaves, and how the tests check the canvas fallback.
 */
function forcedRenderer() {
  const value = new URLSearchParams(location.search).get('renderer')
  return value === 'canvas' || value === 'webgl' || value === 'webgpu' ? value : undefined
}

export class PixiBoard {
  readonly app: Application
  // A render group: panning and zooming change only its transform; the drawing commands inside stay cached.
  private world = new Container({ isRenderGroup: true })
  private screen = new Container()
  private mapLayer = new Container()
  private areaLayer = new Graphics()
  private terrainLayer = new Graphics()
  private objectLayer = new Container()
  private tokenLayer = new Container()
  private rulerLayer = new Container()
  private fogLayer = new Container()
  private fogBorder = new Graphics()
  private fogSprite?: Sprite
  private fogCanvas = document.createElement('canvas')
  private wallLayer = new Graphics()
  readonly effectLayer = new Container()
  private gridLayer = new Graphics()
  private boxLayer = new Graphics()
  private mapSprite?: Sprite
  private textures = new Map<HTMLImageElement, Texture>()
  private tokens = new Map<string, { view: Container; look: string }>()
  private objects = new Map<string, { view: Container; look: string }>()
  private grid: Grid = { cell: 48, originX: 0, originY: 0 }
  private view: View = { camera: { x: 0, y: 0 }, zoom: 1 }
  /** Where tokens are drawn now and where they are heading (cell coordinates), for the move tween. */
  private motion = new Map<string, { from: Point; to: Point; start: number }>()
  private reduceMotion = false
  /** The zoom that line widths and text are built for; it follows the view only once a zoom settles. */
  private detail = 1
  private textResolution = 2

  /** Grid lines sit over the map and under the pieces, but are drawn in screen pixels (crisp 1 px at any zoom). */
  private gridHolder = new Container()

  private constructor(app: Application) {
    this.app = app
    this.gridHolder.addChild(this.gridLayer)
    this.fogLayer.addChild(this.fogBorder)
    this.world.addChild(this.mapLayer, this.gridHolder, this.terrainLayer, this.areaLayer, this.objectLayer, this.tokenLayer, this.fogLayer, this.wallLayer, this.rulerLayer, this.effectLayer)
    this.screen.addChild(this.boxLayer)
    app.stage.addChild(this.world, this.screen)
    this.effects = new BoardEffects(this.effectLayer)
    // Render on demand: Pixi normally draws every frame; here a frame is drawn only after a change,
    // while a token glides or while an effect plays. An idle board then costs nothing (battery on phones).
    app.ticker.remove(app.render, app)
    app.ticker.add(() => {
      const moving = this.step()
      const playing = this.effects.playing > 0
      this.effects.step()
      if (this.dirty || moving || playing) {
        this.dirty = false
        app.render()
      }
    })
  }

  private dirty = true
  /** Ask for one frame (the next tick draws it). */
  invalidate() { this.dirty = true }

  private effects: BoardEffects

  static async create(canvas: HTMLCanvasElement, size: Point) {
    const app = new Application()
    await app.init({
      canvas, width: Math.max(1, size.x), height: Math.max(1, size.y),
      resolution: Math.min(window.devicePixelRatio || 1, 1.5), autoDensity: false,
      antialias: true, background: '#1d1714', preference: forcedRenderer() ?? 'webgl'
    })
    return new PixiBoard(app)
  }

  destroy() {
    this.effects.clear()
    for (const texture of this.textures.values()) texture.destroy(false)
    this.textures.clear()
    this.app.destroy({ removeView: false }, { children: true })
  }

  resize(size: Point) {
    this.dirty = true
    this.app.renderer.resize(Math.max(1, size.x), Math.max(1, size.y))
  }

  setMotionPreference(reduce: boolean) { this.reduceMotion = reduce }

  /** Rebuild-free zooming: pieces scale with the camera, and are redrawn sharp for `zoom` once it settles. */
  setDetail(zoom: number) {
    this.detail = zoom
    this.textResolution = Math.min(6, Math.max(2, Math.ceil(zoom * (window.devicePixelRatio || 1) * 1.5)))
  }

  /** Camera, zoom and grid: moves the world and redraws the screen-space grid lines only. */
  setView(view: View, grid: Grid, transform: BoardTransform, showGrid: boolean, hasMap: boolean, screen: Point) {
    this.dirty = true
    this.view = view
    this.grid = grid
    this.world.position.set(view.camera.x, view.camera.y)
    this.world.scale.set(view.zoom)
    // The grid holder lives in the world for draw order, so undo the camera for screen-pixel lines.
    const holder = this.gridHolder
    holder.position.set(-view.camera.x / view.zoom, -view.camera.y / view.zoom)
    holder.scale.set(1 / view.zoom)
    const g = this.gridLayer.clear()
    if (!showGrid) return
    const { xs, ys } = gridLines(transform, screen)
    for (const x of xs) g.moveTo(Math.round(x) + .5, 0).lineTo(Math.round(x) + .5, screen.y)
    for (const y of ys) g.moveTo(0, Math.round(y) + .5).lineTo(screen.x, Math.round(y) + .5)
    g.stroke(hasMap ? { width: 1, color: '#140d0a', alpha: .6 } : { width: 1, color: '#f5e3c0', alpha: .11 })
  }

  setMap(image?: HTMLImageElement) {
    this.dirty = true
    this.mapSprite?.destroy()
    this.mapSprite = undefined
    if (!image) return
    this.mapSprite = new Sprite(this.texture(image))
    this.mapLayer.addChild(this.mapSprite)
  }

  private texture(image: HTMLImageElement) {
    let texture = this.textures.get(image)
    if (!texture) {
      texture = Texture.from(image)
      this.textures.set(image, texture)
    }
    return texture
  }

  private cellToWorld(point: Point) {
    return { x: this.grid.originX + point.x * this.grid.cell, y: this.grid.originY + point.y * this.grid.cell }
  }

  setObjects(list: ObjectLook[]) {
    this.dirty = true
    const keep = new Set(list.map(item => item.id))
    for (const [id, entry] of this.objects) if (!keep.has(id)) { entry.view.destroy({ children: true }); this.objects.delete(id) }
    list.forEach((item, index) => {
      const look = lookKey(item, this.detail)
      let entry = this.objects.get(item.id)
      if (!entry || entry.look !== look) {
        entry?.view.destroy({ children: true })
        entry = { view: this.drawObject(item), look }
        this.objects.set(item.id, entry)
      }
      if (entry.view.parent !== this.objectLayer || this.objectLayer.getChildIndex(entry.view) !== index) this.objectLayer.addChildAt(entry.view, Math.min(index, this.objectLayer.children.length))
      const at = this.cellToWorld(item)
      entry.view.position.set(at.x, at.y)
    })
  }

  private drawObject(item: ObjectLook) {
    const cell = this.grid.cell
    const w = item.width * cell
    const h = item.height * cell
    const view = new Container()
    const body = new Container()
    body.alpha = item.faded ? .38 : .92
    view.addChild(body)
    if (item.contained && item.picture) body.addChild(contain(new Sprite(this.texture(item.picture)), item.picture, 2, 2, Math.max(1, w - 4), Math.max(1, h - 4)))
    else {
      body.addChild(new Graphics().rect(2, 2, w - 4, h - 4).fill(item.color))
      if (item.picture) {
        const sprite = new Sprite(this.texture(item.picture))
        sprite.position.set(2, 2)
        sprite.setSize(Math.max(1, w - 4), Math.max(1, h - 4))
        body.addChild(sprite)
      }
    }
    if (h * this.detail >= 18 && w * this.detail >= 18) {
      body.addChild(new Graphics().rect(2, Math.max(2, h - 16), w - 4, Math.min(h - 4, 14)).fill({ color: '#150e0b', alpha: .93 }))
      const label = new Text({ text: item.name, style: { fontFamily: sans, fontSize: 11, fill: ink }, resolution: this.textResolution })
      label.anchor.set(.5)
      label.position.set(w / 2, h - 9)
      if (label.width > w - 7) label.scale.set((w - 7) / label.width)
      body.addChild(label)
    }
    if (item.selected) view.addChild(new Graphics().rect(1, 1, w - 2, h - 2).stroke({ width: 3 / this.detail, color: '#e0b878' }))
    if (item.hp && w * this.detail > 16) view.addChild(hpBar(5, 5, w - 10, item.hp, this.detail))
    return view
  }

  setTokens(list: TokenLook[], dragging: Set<string>) {
    this.dirty = true
    const keep = new Set(list.map(item => item.id))
    for (const [id, entry] of this.tokens) if (!keep.has(id)) { entry.view.destroy({ children: true }); this.tokens.delete(id); this.motion.delete(id) }
    const now = performance.now()
    list.forEach((item, index) => {
      const look = lookKey(item, this.detail)
      let entry = this.tokens.get(item.id)
      if (!entry || entry.look !== look) {
        const previous = entry?.view
        entry = { view: this.drawToken(item), look }
        if (previous) { entry.view.position.copyFrom(previous.position); previous.destroy({ children: true }) }
        this.tokens.set(item.id, entry)
      }
      if (this.tokenLayer.children[index] !== entry.view) this.tokenLayer.addChildAt(entry.view, Math.min(index, this.tokenLayer.children.length))
      // A token that moved (not one the user is dragging right now) glides to its new square.
      const target = { x: item.x, y: item.y }
      const motion = this.motion.get(item.id)
      if (!motion || dragging.has(item.id) || this.reduceMotion) this.motion.set(item.id, { from: target, to: target, start: now })
      else if (motion.to.x !== target.x || motion.to.y !== target.y) this.motion.set(item.id, { from: this.currentCell(motion, now), to: target, start: now })
    })
    this.step()
  }

  private currentCell(motion: { from: Point; to: Point; start: number }, now: number) {
    const t = Math.min(1, (now - motion.start) / moveMs)
    const eased = 1 - Math.pow(1 - t, 3)
    return { x: motion.from.x + (motion.to.x - motion.from.x) * eased, y: motion.from.y + (motion.to.y - motion.from.y) * eased }
  }

  /** Every frame: tweened token positions. Nothing else changes per frame unless an effect is playing. */
  private step() {
    const now = performance.now()
    let moving = false
    for (const [id, motion] of this.motion) {
      const entry = this.tokens.get(id)
      if (!entry) continue
      if (now - motion.start < moveMs + 20 && (motion.from.x !== motion.to.x || motion.from.y !== motion.to.y)) moving = true
      const at = this.cellToWorld(this.currentCell(motion, now))
      entry.view.position.set(at.x, at.y)
    }
    return moving
  }

  /** World position of a token's centre right now (mid-tween included), for effects. */
  tokenCenter(id: string) {
    const entry = this.tokens.get(id)
    const motion = this.motion.get(id)
    if (!entry || !motion) return undefined
    const at = this.cellToWorld(this.currentCell(motion, performance.now()))
    const half = entry.view.label ? Number(entry.view.label) * this.grid.cell / 2 : this.grid.cell / 2
    return { x: at.x + half, y: at.y + half, radius: half * .84 }
  }

  private drawToken(item: TokenLook) {
    const width = this.grid.cell * item.span
    const radius = width * .42
    const c = width / 2
    const zoom = this.detail
    const view = new Container()
    view.label = String(item.span)
    view.alpha = item.faint ? .42 : 1
    const ready = item.portrait && item.portrait.complete && item.portrait.naturalWidth
    if (ready && item.monsterArt) view.addChild(contain(new Sprite(this.texture(item.portrait!)), item.portrait!, 0, 0, width, width))
    else view.addChild(new Graphics().circle(c, c, radius).fill('#2a1f18'))
    if (ready && !item.monsterArt) {
      const image = item.portrait!
      const sprite = new Sprite(this.texture(image))
      const edge = Math.min(image.naturalWidth, image.naturalHeight)
      const scale = 2 * radius / edge
      sprite.scale.set(scale)
      sprite.position.set(c - image.naturalWidth * scale / 2, c - image.naturalHeight * scale / 2)
      const mask = new Graphics().circle(c, c, radius).fill('#fff')
      sprite.mask = mask
      view.addChild(sprite, mask)
    }
    view.addChild(new Graphics().circle(c, c, radius).stroke({ width: item.ringWidth / zoom, color: item.ring }))
    if (item.current) {
      const glow = new Graphics()
      for (const [extra, alpha] of [[9, .12], [7, .22], [5, .6]] as const) glow.circle(c, c, radius + extra / zoom).stroke({ width: 3 / zoom, color: '#ff8a3d', alpha })
      view.addChild(glow)
    }
    if (item.main) view.addChild(new Graphics().circle(c, c, radius + 3 / zoom).stroke({ width: 1.5 / zoom, color: '#ffd08a' }))
    if (!ready) {
      const initials = new Text({ text: item.initials, style: { fontFamily: serif, fontWeight: '700', fontSize: Math.max(7 / zoom, Math.min(width / 3, 25 / zoom)), fill: '#fbefd8' }, resolution: this.textResolution })
      initials.anchor.set(.5)
      initials.position.set(c, c)
      view.addChild(initials)
    }
    if (item.hp && width * zoom >= 16) view.addChild(hpBar(c - radius, c + radius - 4 / zoom, 2 * radius, item.hp, zoom))
    if (item.marks.length && width * zoom >= 20) {
      // Leather-and-brass marks above the token: the most limiting conditions, then "+N".
      const size = Math.max(11, Math.min(18, width * zoom / 3.2)) / zoom
      const gap = 2 / zoom
      const total = item.marks.length * size + (item.marks.length - 1) * gap
      let x = c - total / 2
      const y = c - radius - size * .6
      for (const mark of item.marks) {
        view.addChild(new Graphics().roundRect(x, y - size / 2, size, size, size * .25)
          .fill(mark === '!' ? '#9e3b3b' : mark.startsWith('+') ? '#3a2b20' : '#2a1f18')
          .stroke({ width: 1.25 / zoom, color: '#c79a5b' }))
        const text = new Text({ text: mark, style: { fontFamily: sans, fontWeight: '700', fontSize: size * .55, fill: ink }, resolution: this.textResolution })
        text.anchor.set(.5)
        text.position.set(x + size / 2, y + .5 / zoom)
        view.addChild(text)
        x += size + gap
      }
    }
    return view
  }

  /** Area templates, the drop cell, the ruler (world) and selection boxes (screen). */
  setOverlay(overlay: Overlay) {
    this.dirty = true
    const zoom = this.view.zoom
    const cell = this.grid.cell
    const g = this.areaLayer.clear()
    for (const { shape, color } of overlay.areas) {
      if ('radius' in shape) {
        const at = this.cellToWorld(shape.center)
        g.circle(at.x, at.y, shape.radius * cell)
      } else g.poly(shape.points.flatMap(point => { const at = this.cellToWorld(point); return [at.x, at.y] }))
      g.fill({ color, alpha: .27 }).stroke({ width: 2 / zoom, color })
    }
    if (overlay.dropCell) {
      const at = this.cellToWorld(overlay.dropCell)
      g.rect(at.x, at.y, cell, cell).fill({ color: '#e0b878', alpha: .2 }).stroke({ width: 2 / zoom, color: '#e0b878' })
    }
    this.rulerLayer.removeChildren().forEach(child => child.destroy({ children: true }))
    if (overlay.ruler) {
      const start = this.cellToWorld({ x: overlay.ruler.from.x + .5, y: overlay.ruler.from.y + .5 })
      const end = this.cellToWorld({ x: overlay.ruler.to.x + .5, y: overlay.ruler.to.y + .5 })
      const label = new Text({ text: overlay.ruler.feet + ' ฟุต', style: { fontFamily: sans, fontSize: 14, fill: '#ffd08a' }, resolution: 2 })
      label.scale.set(1 / zoom)
      label.position.set(end.x + 15 / zoom, end.y - 25 / zoom)
      this.rulerLayer.addChild(
        new Graphics().moveTo(start.x, start.y).lineTo(end.x, end.y).stroke({ width: 2 / zoom, color: '#ffd08a' })
          .rect(end.x + 8 / zoom, end.y - 30 / zoom, 72 / zoom, 25 / zoom).fill('#211814'),
        label)
    }
    const box = this.boxLayer.clear()
    if (overlay.calibration) {
      const r = overlay.calibration
      box.rect(r.x, r.y, r.width, r.height).fill({ color: '#e0b878', alpha: .2 }).stroke({ width: 2, color: '#ffd08a' })
    }
    if (overlay.selection) {
      const r = overlay.selection
      box.rect(r.x, r.y, r.width, r.height).fill({ color: '#9fc4f0', alpha: .2 }).stroke({ width: 1, color: '#9fc4f0' })
    }
  }

  /** An attack between two tokens: a melee swing when adjacent, a bolt from farther away. Skipped when motion is reduced. */
  strike(fromId: string, toId: string, ranged: boolean, outcome: Outcome) {
    if (this.reduceMotion) return
    this.dirty = true
    const from = this.tokenCenter(fromId)
    const to = this.tokenCenter(toId)
    if (!from || !to) return
    if (ranged) this.effects.ranged(from, to, outcome, 1 / this.view.zoom)
    else this.effects.melee(from, to, outcome, 1 / this.view.zoom)
  }

  /** A spell area going off: flash, spreading ring and embers (kept even with reduced motion: it shows who was caught). */
  areaBurst(shape: AreaOutline, color: string) {
    this.effects.area(shape, color, point => this.cellToWorld(point), this.grid.cell, 1 / this.view.zoom)
  }

  /**
   * Fog, walls, doors, lights and painted darkness. The fog is a small canvas
   * with one pixel per cell, stretched over the board with smooth filtering,
   * so its edges fade over half a square.
   */
  setVision(look: VisionLook) {
    this.dirty = true
    const cell = this.grid.cell
    const zoom = this.view.zoom
    const fog = look.fog
    this.fogSprite?.destroy({ texture: true, textureSource: true })
    this.fogSprite = undefined
    this.fogBorder.clear()
    if (fog) {
      // The fogged region: every cell anyone knows of, plus a margin; outside it, solid black.
      const cells = [...fog.visible, ...fog.explored].map(item => item.split(',').map(Number))
      const xs = cells.map(([x]) => x)
      const ys = cells.map(([, y]) => y)
      const margin = 4
      const minX = (xs.length ? Math.min(...xs) : 0) - margin
      const minY = (ys.length ? Math.min(...ys) : 0) - margin
      const width = (xs.length ? Math.max(...xs) : 0) + margin - minX + 1
      const height = (ys.length ? Math.max(...ys) : 0) + margin - minY + 1
      const canvas = this.fogCanvas
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      const image = ctx.createImageData(width, height)
      const unknown = fog.opaque ? 255 : 150
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const k = (minX + x) + ',' + (minY + y)
        const alpha = fog.visible.has(k) ? (fog.darkvision.has(k) ? 120 : fog.dimmed.has(k) ? 70 : 0)
          : fog.explored.has(k) ? 170 : unknown
        const at = (y * width + x) * 4
        image.data[at] = fog.darkvision.has(k) ? 24 : 11
        image.data[at + 1] = fog.darkvision.has(k) ? 26 : 8
        image.data[at + 2] = fog.darkvision.has(k) ? 30 : 6
        image.data[at + 3] = alpha
      }
      ctx.putImageData(image, 0, 0)
      const texture = Texture.from(canvas, true)
      texture.source.scaleMode = 'linear'
      const sprite = new Sprite(texture)
      // One texel per cell: texel centres land on cell centres, so the blend between two cells crosses their shared edge.
      sprite.scale.set(cell)
      sprite.position.set(this.grid.originX + minX * cell, this.grid.originY + minY * cell)
      this.fogLayer.addChild(sprite)
      this.fogSprite = sprite
      const left = this.grid.originX + minX * cell
      const top = this.grid.originY + minY * cell
      this.fogBorder.rect(-100000, -100000, 200000, 200000).fill({ color: '#0b0806', alpha: unknown / 255 })
        .rect(left, top, width * cell, height * cell).cut()
    }
    const g = this.wallLayer.clear()
    const at = (point: Point) => ({ x: this.grid.originX + point.x * cell, y: this.grid.originY + point.y * cell })
    if (look.darkness) {
      for (const [list, color, alpha] of [[look.darkness.dark, '#1a1030', .45], [look.darkness.magic, '#3a0a4a', .6]] as const) {
        for (const item of list) {
          const [x, y] = item.split(',').map(Number)
          const p = at({ x, y })
          g.rect(p.x, p.y, cell, cell)
        }
        if (list.length) g.fill({ color, alpha })
      }
    }
    if (look.showWalls) for (const wall of look.walls) {
      if (wall.door) continue
      const a = at(wall.a)
      const b = at(wall.b)
      g.moveTo(a.x, a.y).lineTo(b.x, b.y)
    }
    if (look.showWalls && look.walls.some(wall => !wall.door)) g.stroke({ width: 4 / zoom, color: '#e0b878', alpha: .85, cap: 'round' })
    for (const door of look.doors) {
      const a = at(door.a)
      const b = at(door.b)
      const state = door.door!
      const color = state.secret ? '#a070d0' : state.locked ? '#d04a3a' : state.open ? '#7fc06a' : '#c08a4a'
      if (state.open) {
        // An open door: two short posts at the ends of the doorway.
        const dx = (b.x - a.x) * .18
        const dy = (b.y - a.y) * .18
        g.moveTo(a.x, a.y).lineTo(a.x + dx, a.y + dy).moveTo(b.x, b.y).lineTo(b.x - dx, b.y - dy).stroke({ width: 6 / zoom, color, cap: 'round' })
      } else g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 7 / zoom, color, cap: 'round' })
      g.circle((a.x + b.x) / 2, (a.y + b.y) / 2, 5 / zoom).fill(color)
    }
    for (const light of look.lights) {
      const p = { x: this.grid.originX + light.x * cell, y: this.grid.originY + light.y * cell }
      if (light.on) g.circle(p.x, p.y, (light.bright / 5) * cell).stroke({ width: 1.5 / zoom, color: '#ffd08a', alpha: .5 })
      g.circle(p.x, p.y, 8 / zoom).fill({ color: light.on ? '#ffb347' : '#5a4a3a' }).stroke({ width: 2 / zoom, color: '#2a1f18' })
    }
    if (look.drawing?.length) {
      const points = [...look.drawing, ...(look.cursor ? [look.cursor] : [])].map(at)
      g.moveTo(points[0].x, points[0].y)
      for (const p of points.slice(1)) g.lineTo(p.x, p.y)
      g.stroke({ width: 3 / zoom, color: '#ffd08a', alpha: .9 })
      for (const p of points) g.circle(p.x, p.y, 4 / zoom).fill('#ffd08a')
    }
  }

  /** Difficult Terrain: a faint hatch (three diagonal strokes) on each square, plus squares being painted. */
  setTerrain(cells: string[]) {
    this.dirty = true
    const g = this.terrainLayer.clear()
    const cell = this.grid.cell
    for (const item of cells) {
      const [x, y] = item.split(',').map(Number)
      const left = this.grid.originX + x * cell
      const top = this.grid.originY + y * cell
      g.rect(left, top, cell, cell).fill({ color: '#8a6d3b', alpha: .12 })
      for (const t of [.25, .5, .75]) g.moveTo(left + cell * t, top).lineTo(left, top + cell * t).moveTo(left + cell, top + cell * t).lineTo(left + cell * t, top + cell)
    }
    if (cells.length) g.stroke({ width: 1.5 / this.view.zoom, color: '#c9a66b', alpha: .45 })
  }

  /** Release images the board no longer shows. */
  prune(inUse: Set<HTMLImageElement>) {
    for (const [image, texture] of this.textures) if (!inUse.has(image)) { texture.destroy(false); this.textures.delete(image) }
  }
}

const moveMs = 220

/** What a piece looks like, as a string: unchanged looks keep their Pixi objects. Position is left out. */
function lookKey(item: TokenLook | ObjectLook, zoom: number) {
  const { x: _x, y: _y, ...rest } = item
  const images = 'portrait' in rest ? rest.portrait : 'picture' in rest ? rest.picture : undefined
  return JSON.stringify(rest, (key, value) => key === 'portrait' || key === 'picture' ? undefined : value)
    + '|' + (images ? images.src + ':' + images.naturalWidth : '') + '|' + Math.round(zoom * 16)
}

function contain(sprite: Sprite, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight)
  sprite.scale.set(scale)
  sprite.position.set(x + (width - image.naturalWidth * scale) / 2, y + (height - image.naturalHeight * scale) / 2)
  return sprite
}

function hpBar(x: number, y: number, width: number, hp: HpLook, zoom: number) {
  const ratio = Math.max(0, Math.min(1, hp.hp / hp.maxHp))
  const unit = 1 / zoom
  const g = new Graphics()
    .rect(x - unit, y - unit, width + 2 * unit, 7 * unit).fill('#120b09')
    .rect(x, y, width, 5 * unit).fill('#3a1c16')
  if (ratio > 0) g.rect(x, y, width * ratio, 5 * unit).fill(ratio > .5 ? (hp.foe ? '#c0503a' : '#6aae58') : ratio > .25 ? '#d0902a' : '#e0473a')
  if ((hp.temp ?? 0) > 0) g.rect(x, y + 5 * unit, width * Math.min(1, hp.temp! / hp.maxHp), 2 * unit).fill('#8fb0e0')
  return g
}
