import type { Actor, Scene, Sheet, Token } from './model.ts'
import { sizes } from './model.ts'
import { hasCondition } from './effects.ts'

/**
 * Walls, doors, light and sight on one scene (0.09). Everything is in grid
 * cells: a wall runs between two cell-corner points, a creature sees from the
 * middle of its token, and a cell counts as seen when its middle is.
 *
 *   sight polygon   rays from the eye to every wall end; closed doors block, open ones don't
 *   light level     the scene's ambient light, raised by light sources (walls block light too),
 *                   lowered by painted darkness; magical darkness ignores light and Darkvision
 *   seen            in the sight polygon, within vision range, and not dark — or dark but
 *                   inside Darkvision range (Darkvision sees darkness as dim light)
 *
 * The server runs this to decide which tokens a player is sent; the board runs
 * the same code to draw the fog, so what is drawn matches what is sent.
 */
export type Point = { x: number; y: number }
export type Door = { open: boolean; locked?: boolean; dc?: number; tried?: string[]; secret?: boolean }
export type Wall = { id: string; a: Point; b: Point; door?: Door }
export type LightSource = { id: string; x: number; y: number; bright: number; dim: number; on: boolean }
export type Ambient = 'day' | 'dusk' | 'night' | 'cave'
export type SceneVision = {
  enabled: boolean; ambient: Ambient
  walls?: Wall[]; lights?: LightSource[]
  /** Painted darkness, as "x,y" cell keys: plain darkness, and magical darkness (no light, no Darkvision). */
  darkness?: string[]; magicDarkness?: string[]
  /** Cells each player has seen before ("x,y"), by member id. */
  explored?: Record<string, string[]>
}
/** What a creature sees with: range and Darkvision in feet (undefined range = as far as walls allow), and a carried light. */
export type ActorVision = { range?: number; darkvision?: number; light?: { bright: number; dim: number; on: boolean } }
export type Level = 'bright' | 'dim' | 'dark'

export const ambientLevel: Record<Ambient, Level> = { day: 'bright', dusk: 'dim', night: 'dark', cave: 'dark' }
export const ambientLabels: Record<Ambient, string> = { day: 'กลางวัน', dusk: 'โพล้เพล้', night: 'กลางคืน', cave: 'ในถ้ำ' }
export const feetPerCell = 5
/** "As far as walls allow" still stops somewhere: 60 squares (300 ft) around each eye. */
export const maxSight = 60
export const key = (x: number, y: number) => x + ',' + y

/** SRD 5.2.1 species with Darkvision (feet). */
export const speciesDarkvision: Record<string, number> = { Dragonborn: 60, Dwarf: 120, Elf: 60, Gnome: 60, Orc: 120, Tiefling: 60 }

/** A creature's vision: what the DM set, else Darkvision from its species or its stat block ("Darkvision 60 ft."). */
export function visionOf(sheet: Pick<Sheet, 'kind' | 'characterDetails' | 'monsterReference'> & { vision?: ActorVision }): ActorVision {
  const set = sheet.vision ?? {}
  if (set.darkvision !== undefined) return set
  const species = sheet.characterDetails?.species?.split(/[\s(·,]/)[0]
  const fromSpecies = species ? speciesDarkvision[species] : undefined
  const fromBlock = Number(/Darkvision\s+(\d+)\s*ft/i.exec(sheet.monsterReference?.statBlock ?? '')?.[1] ?? 0) || undefined
  const darkvision = fromSpecies ?? fromBlock
  return darkvision ? { ...set, darkvision } : set
}

/** Walls that block sight and light right now: every plain wall, and doors that are shut. */
export function blockers(walls: Wall[] = []) {
  return walls.filter(wall => !wall.door || !wall.door.open)
}

type Segment = { a: Point; b: Point }

/** Where a ray from `o` in direction `d` first meets a segment (distance along the ray), or Infinity. */
function hit(o: Point, d: Point, s: Segment) {
  const ex = s.b.x - s.a.x
  const ey = s.b.y - s.a.y
  const denom = d.x * ey - d.y * ex
  if (Math.abs(denom) < 1e-12) return Infinity
  const t = ((s.a.x - o.x) * ey - (s.a.y - o.y) * ex) / denom
  const u = ((s.a.x - o.x) * d.y - (s.a.y - o.y) * d.x) / denom
  return t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity
}

/**
 * Everything visible from `eye` within `radius` cells, as a polygon (cell
 * coordinates, sorted by angle). Rays go to every wall end within reach, a
 * hair either side, plus a ring so open ground ends in a circle.
 */
export function sightPolygon(eye: Point, radius: number, walls: Segment[]): Point[] {
  const near = walls.filter(wall => segmentDistance(eye, wall) <= radius)
  const angles: number[] = []
  for (const wall of near) for (const end of [wall.a, wall.b]) {
    const angle = Math.atan2(end.y - eye.y, end.x - eye.x)
    angles.push(angle - 1e-4, angle, angle + 1e-4)
  }
  for (let index = 0; index < 48; index++) angles.push(-Math.PI + index / 48 * Math.PI * 2)
  angles.sort((a, b) => a - b)
  return angles.map(angle => {
    const d = { x: Math.cos(angle), y: Math.sin(angle) }
    let t = radius
    for (const wall of near) t = Math.min(t, hit(eye, d, wall))
    return { x: eye.x + d.x * t, y: eye.y + d.y * t }
  })
}

function segmentDistance(p: Point, s: Segment) {
  const ex = s.b.x - s.a.x
  const ey = s.b.y - s.a.y
  const length = ex * ex + ey * ey || 1
  const t = Math.max(0, Math.min(1, ((p.x - s.a.x) * ex + (p.y - s.a.y) * ey) / length))
  return Math.hypot(p.x - (s.a.x + t * ex), p.y - (s.a.y + t * ey))
}

export function inside(polygon: Point[], p: Point) {
  let result = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result
  }
  return result
}

type Lit = { center: Point; bright: number; dim: number; polygon: Point[] }

/** Light sources on the scene: placed lights that are on, and lights carried by tokens. Radii in cells. */
export function lightsOf(scene: Pick<Scene, 'tokens'> & { vision?: SceneVision }, actors: Pick<Actor, 'id' | 'size'>[], visionById: (id: string) => ActorVision): Lit[] {
  const walls = blockers(scene.vision?.walls)
  const lit: Lit[] = []
  const add = (center: Point, brightFeet: number, dimFeet: number) => {
    const bright = brightFeet / feetPerCell
    const dim = dimFeet / feetPerCell
    if (bright + dim <= 0) return
    lit.push({ center, bright, dim, polygon: sightPolygon(center, bright + dim, walls) })
  }
  for (const light of scene.vision?.lights ?? []) if (light.on) add({ x: light.x, y: light.y }, light.bright, light.dim)
  for (const token of scene.tokens) {
    const carried = visionById(token.actorId).light
    const actor = actors.find(item => item.id === token.actorId)
    if (carried?.on && actor) add(tokenCenter(token, actor), carried.bright, carried.dim)
  }
  return lit
}

export const tokenCenter = (token: Pick<Token, 'x' | 'y'>, actor: Pick<Actor, 'size'>) => {
  const span = sizes[actor.size]
  return { x: token.x + span / 2, y: token.y + span / 2 }
}

/** The light level of a cell (its middle). */
export function levelAt(cell: Point, vision: SceneVision, lights: Lit[]): Level {
  const k = key(cell.x, cell.y)
  if (vision.magicDarkness?.includes(k)) return 'dark'
  let level: Level = vision.darkness?.includes(k) ? 'dark' : ambientLevel[vision.ambient]
  const p = { x: cell.x + .5, y: cell.y + .5 }
  for (const light of lights) {
    if (level === 'bright') break
    const distance = Math.hypot(p.x - light.center.x, p.y - light.center.y)
    if (distance > light.bright + light.dim || !inside(light.polygon, p)) continue
    level = distance <= light.bright ? 'bright' : level === 'dark' ? 'dim' : level
  }
  return level
}

export type Seen = { visible: Set<string>; dimmed: Set<string>; darkvision: Set<string> }

/**
 * Cells one creature sees. `visible` is every seen cell; `dimmed` the seen cells
 * in dim light; `darkvision` the dark ones seen only through Darkvision (drawn grey).
 */
export function seenBy(eye: Point, sight: ActorVision, vision: SceneVision, lights: Lit[], into: Seen = { visible: new Set(), dimmed: new Set(), darkvision: new Set() }) {
  const reach = Math.min(maxSight, sight.range !== undefined ? sight.range / feetPerCell : maxSight)
  const darkvision = (sight.darkvision ?? 0) / feetPerCell
  const polygon = sightPolygon(eye, reach + .01, blockers(vision.walls))
  const magic = new Set(vision.magicDarkness ?? [])
  for (let y = Math.floor(eye.y - reach); y <= Math.ceil(eye.y + reach); y++) {
    for (let x = Math.floor(eye.x - reach); x <= Math.ceil(eye.x + reach); x++) {
      const p = { x: x + .5, y: y + .5 }
      const distance = Math.hypot(p.x - eye.x, p.y - eye.y)
      // The eye's own square is always seen, even when the middle of a Large token sits on a corner.
      if (distance > reach || (distance > .75 && !inside(polygon, p))) continue
      const k = key(x, y)
      const level = levelAt({ x, y }, vision, lights)
      if (level === 'dark') {
        if (magic.has(k) || distance > darkvision) continue
        into.darkvision.add(k)
      } else if (level === 'dim') into.dimmed.add(k)
      into.visible.add(k)
    }
  }
  return into
}

/** Whether a token shows on someone's view: any square under it is seen. */
export function tokenSeen(token: Pick<Token, 'x' | 'y'>, span: number, visible: Set<string>) {
  const cells = Math.max(1, Math.ceil(span))
  for (let dy = 0; dy < cells; dy++) for (let dx = 0; dx < cells; dx++) {
    if (visible.has(key(Math.floor(token.x) + dx, Math.floor(token.y) + dy))) return true
  }
  return false
}

/**
 * What one player sees on a scene with vision on: the union of what each of
 * their own tokens sees (not temp tokens, not other players' characters).
 */
export function playerView(scene: Pick<Scene, 'tokens'> & { vision?: SceneVision }, actors: (Pick<Actor, 'id' | 'size' | 'ownerId' | 'kind' | 'characterDetails' | 'monsterReference' | 'temp' | 'conditions' | 'effects'> & { vision?: ActorVision })[], memberId: string) {
  const vision = scene.vision!
  const visionById = (id: string) => {
    const actor = actors.find(item => item.id === id)
    return actor ? visionOf(actor) : {}
  }
  const lights = lightsOf(scene, actors, visionById)
  const seen: Seen = { visible: new Set(), dimmed: new Set(), darkvision: new Set() }
  for (const token of scene.tokens) {
    const actor = actors.find(item => item.id === token.actorId)
    if (!actor || actor.ownerId !== memberId || actor.temp) continue
    // Blinded creatures see nothing (SRD); the board still shows the explored map.
    if (hasCondition(actor, 'Blinded')) continue
    seenBy(tokenCenter(token, actor), visionOf(actor), vision, lights, seen)
  }
  return seen
}

/** Doors as a player knows them: secret ones they have not been shown are plain walls. */
export function wallsForPlayer(walls: Wall[] = []): Wall[] {
  return walls.map(wall => wall.door?.secret ? { id: wall.id, a: wall.a, b: wall.b } : wall.door ? { ...wall, door: { open: wall.door.open, locked: wall.door.locked } } : wall)
}
