import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import type { AreaOutline } from '../../../shared/area.ts'
import type { Point } from './gestures.ts'
import { gridLines } from './geometry.ts'
import type { BoardTransform, Grid, View } from './geometry.ts'

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

export class PixiBoard {
  readonly app: Application
  private world = new Container()
  private screen = new Container()
  private mapLayer = new Container()
  private areaLayer = new Graphics()
  private objectLayer = new Container()
  private tokenLayer = new Container()
  private rulerLayer = new Container()
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
    this.world.addChild(this.mapLayer, this.gridHolder, this.areaLayer, this.objectLayer, this.tokenLayer, this.rulerLayer, this.effectLayer)
    this.screen.addChild(this.boxLayer)
    app.stage.addChild(this.world, this.screen)
    app.ticker.add(() => this.step())
  }

  static async create(canvas: HTMLCanvasElement, size: Point) {
    const app = new Application()
    await app.init({
      canvas, width: Math.max(1, size.x), height: Math.max(1, size.y),
      resolution: Math.min(window.devicePixelRatio || 1, 1.5), autoDensity: false,
      antialias: true, background: '#1d1714', preference: 'webgl'
    })
    return new PixiBoard(app)
  }

  destroy() {
    for (const texture of this.textures.values()) texture.destroy(false)
    this.textures.clear()
    this.app.destroy({ removeView: false }, { children: true })
  }

  resize(size: Point) {
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
    if (h >= 18 && w >= 18) {
      body.addChild(new Graphics().rect(2, Math.max(2, h - 16), w - 4, Math.min(h - 4, 14)).fill({ color: '#150e0b', alpha: .93 }))
      const label = new Text({ text: item.name, style: { fontFamily: sans, fontSize: 11, fill: ink }, resolution: this.textResolution })
      label.anchor.set(.5)
      label.position.set(w / 2, h - 9)
      if (label.width > w - 7) label.scale.set((w - 7) / label.width)
      body.addChild(label)
    }
    if (item.selected) view.addChild(new Graphics().rect(1, 1, w - 2, h - 2).stroke({ width: 3 / this.detail, color: '#e0b878' }))
    if (item.hp && w > 16) view.addChild(hpBar(5, 5, w - 10, item.hp, this.detail))
    return view
  }

  setTokens(list: TokenLook[], dragging: Set<string>) {
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
    for (const [id, motion] of this.motion) {
      const entry = this.tokens.get(id)
      if (!entry) continue
      const at = this.cellToWorld(this.currentCell(motion, now))
      entry.view.position.set(at.x, at.y)
    }
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
