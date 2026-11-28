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
export type ActorVision = { range?: number; darkvision?: number; light?: { bright: number; dim: number; on: boolean; cone?: boolean } }
export type Level = 'bright' | 'dim' | 'dark'

export const ambientLevel: Record<Ambient, Level> = { day: 'bright', dusk: 'dim', night: 'dark', cave: 'dark' }
export const ambientLabels: Record<Ambient, string> = { day: 'กลางวัน', dusk: 'โพล้เพล้', night: 'กลางคืน', cave: 'ในถ้ำ' }
export const feetPerCell = 5
/** "As far as walls allow" still stops somewhere: 60 squares (300 ft) around each eye. */
export const maxSight = 60
export const key = (x: number, y: number) => x + ',' + y

/** SRD 5.2.1 light sources that can be lit from a bag: bright / dim feet. A Bullseye Lantern shines in a Cone (0.14) the way its carrier faces. */
export const itemLights: Record<string, { bright: number; dim: number; cone?: boolean }> = {
  'srd-5.2.1:equipment:candle': { bright: 5, dim: 5 },
  'srd-5.2.1:equipment:lamp': { bright: 15, dim: 30 },
  'srd-5.2.1:equipment:torch': { bright: 20, dim: 20 },
  'srd-5.2.1:equipment:lantern-hooded': { bright: 30, dim: 30 },
  'srd-5.2.1:equipment:lantern-bullseye': { bright: 60, dim: 60, cone: true }
}
/** The brightest burning item a creature carries, if any. */
export function litItem(inventory: { ref?: string; lit?: boolean }[] = []) {
  let best: { bright: number; dim: number; cone?: boolean } | undefined
  for (const item of inventory) {
    const light = item.lit && item.ref ? itemLights[item.ref] : undefined
    if (light && (!best || light.bright + light.dim > best.bright + best.dim)) best = light
  }
  return best
}

/** SRD 5.2.1 species with Darkvision (feet). */
export const speciesDarkvision: Record<string, number> = { Dragonborn: 60, Dwarf: 120, Elf: 60, Gnome: 60, Orc: 120, Tiefling: 60 }

/** A creature's vision: what the DM set, else Darkvision from its species or its stat block ("Darkvision 60 ft."). */
export function visionOf(sheet: Pick<Sheet, 'kind' | 'characterDetails' | 'monsterReference'> & { vision?: ActorVision }): ActorVision {
  const set = sheet.vision ?? {}
  const burning = litItem((sheet as { inventory?: { ref?: string; lit?: boolean }[] }).inventory)
  const own = set.light?.on ? set.light : undefined
  const light = burning && (!own || burning.bright + burning.dim > own.bright + own.dim) ? { ...burning, on: true } : set.light
  if (light !== set.light) return visionOf({ ...sheet, vision: { ...set, light } } as typeof sheet)
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

/**
 * A sight polygon with its eye and vertex angles, for a fast inside test: the
 * polygon is star-shaped around the eye, so a point is inside when it is on the
 * eye's side of the one edge whose angles bracket it (a binary search, not a walk round every edge).
 */
export type Star = { eye: Point; points: Point[]; angles: number[] }
export function star(eye: Point, radius: number, walls: Segment[]): Star {
  const points = sightPolygon(eye, radius, walls)
  return { eye, points, angles: points.map(p => Math.atan2(p.y - eye.y, p.x - eye.x)) }
}
export function insideStar(shape: Star, p: Point) {
  const { eye, points, angles } = shape
  const n = points.length
  if (n < 3) return false
  const angle = Math.atan2(p.y - eye.y, p.x - eye.x)
  let lo = 0
  let hi = n
  while (lo < hi) { const mid = (lo + hi) >> 1; if (angles[mid] <= angle) lo = mid + 1; else hi = mid }
  const a = points[(lo - 1 + n) % n]
  const b = points[lo % n]
  // Same side of edge a→b as the eye (or on it) means inside.
  const side = (q: Point) => (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)
  const sp = side(p)
  const se = side(eye)
  return sp === 0 || Math.sign(sp) === Math.sign(se)
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

/** A light on the scene; `cone` limits it to directions within `half` radians of `facing` (radians, 0 = east). */
type Lit = { center: Point; bright: number; dim: number; polygon: Star; cone?: { facing: number; half: number } }

/** An SRD Cone is as wide as it is long at its far end: half its angle is atan(1/2), about 26.6°. */
export const coneHalfAngle = Math.atan(.5)
/** Snap a direction (dx, dy in cells) to the nearest of 8 facings, in degrees; undefined for no movement. */
export function facingOf(dx: number, dy: number) {
  if (!dx && !dy) return undefined
  return ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * 45) % 360 + 360) % 360
}
/** Whether a point is inside a light's cone (always true for a round light). */
export function inCone(light: Pick<Lit, 'center' | 'cone'>, p: Point) {
  if (!light.cone) return true
  const angle = Math.atan2(p.y - light.center.y, p.x - light.center.x)
  const gap = Math.abs(((angle - light.cone.facing) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI)
  return gap <= light.cone.half + 1e-9
}

/** Light sources on the scene: placed lights that are on, and lights carried by tokens. Radii in cells. */
export function lightsOf(scene: Pick<Scene, 'tokens'> & { vision?: SceneVision }, actors: Pick<Actor, 'id' | 'size'>[], visionById: (id: string) => ActorVision): Lit[] {
  const walls = blockers(scene.vision?.walls)
  const lit: Lit[] = []
  const add = (center: Point, brightFeet: number, dimFeet: number, cone?: Lit['cone']) => {
    const bright = brightFeet / feetPerCell
    const dim = dimFeet / feetPerCell
    if (bright + dim <= 0) return
    lit.push({ center, bright, dim, polygon: star(center, bright + dim, walls), ...(cone ? { cone } : {}) })
  }
  for (const light of scene.vision?.lights ?? []) if (light.on) add({ x: light.x, y: light.y }, light.bright, light.dim)
  for (const token of scene.tokens) {
    const carried = visionById(token.actorId).light
    const actor = actors.find(item => item.id === token.actorId)
    if (carried?.on && actor) add(tokenCenter(token, actor), carried.bright, carried.dim,
      carried.cone ? { facing: (token.facing ?? 0) * Math.PI / 180, half: coneHalfAngle } : undefined)
  }
  return lit
}

export const tokenCenter = (token: Pick<Token, 'x' | 'y'>, actor: Pick<Actor, 'size'>) => {
  const span = sizes[actor.size]
  return { x: token.x + span / 2, y: token.y + span / 2 }
}

type Dark = { dark: Set<string>; magic: Set<string> }
const cellSets = new WeakMap<string[], Set<string>>()
const none = new Set<string>()
/** A painted list as a set, cached per array (commands replace the arrays, so a change is never stale). */
function asSet(list?: string[]) {
  if (!list) return none
  let set = cellSets.get(list)
  if (!set) cellSets.set(list, set = new Set(list))
  return set
}
const darkOf = (vision: SceneVision): Dark => ({ dark: asSet(vision.darkness), magic: asSet(vision.magicDarkness) })

/** The light level of a cell (its middle). */
export function levelAt(cell: Point, vision: SceneVision, lights: Lit[]): Level {
  const k = key(cell.x, cell.y)
  const { dark, magic } = darkOf(vision)
  if (magic.has(k)) return 'dark'
  let level: Level = dark.has(k) ? 'dark' : ambientLevel[vision.ambient]
  const p = { x: cell.x + .5, y: cell.y + .5 }
  for (const light of lights) {
    if (level === 'bright') break
    const distance = Math.hypot(p.x - light.center.x, p.y - light.center.y)
    if (distance > light.bright + light.dim || !inCone(light, p) || !insideStar(light.polygon, p)) continue
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
  const polygon = star(eye, reach + .01, blockers(vision.walls))
  const magic = darkOf(vision).magic
  for (let y = Math.floor(eye.y - reach); y <= Math.ceil(eye.y + reach); y++) {
    for (let x = Math.floor(eye.x - reach); x <= Math.ceil(eye.x + reach); x++) {
      const p = { x: x + .5, y: y + .5 }
      const distance = Math.hypot(p.x - eye.x, p.y - eye.y)
      if (distance > reach) continue
      // Light first (cheap): a dark cell out of Darkvision range is unseen whatever the walls do.
      const k = key(x, y)
      const level = levelAt({ x, y }, vision, lights)
      if (level === 'dark' && (magic.has(k) || distance > darkvision)) continue
      // The eye's own square is always seen, even when the middle of a Large token sits on a corner.
      if (distance > .75 && !insideStar(polygon, p)) continue
      if (level === 'dark') into.darkvision.add(k)
      else if (level === 'dim') into.dimmed.add(k)
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
