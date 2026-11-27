import { Container, Graphics } from 'pixi.js'
import type { AreaOutline } from '../../../shared/area.ts'

/**
 * Short attack and spell effects drawn inside the board (world coordinates),
 * so they pan and zoom with it. Each effect owns one Graphics that is redrawn
 * every frame until it finishes, then removes itself.
 *
 *   melee  · an arc sweeps across the target, sparks on a hit
 *   ranged · a bolt flies from attacker to target, then bursts (grey fizzle on a miss)
 *   area   · the template flashes in its damage colour and fades, with rising embers
 */
export type Outcome = 'hit' | 'miss' | 'critical'
type Live = { start: number; duration: number; draw: (g: Graphics, t: number) => void; g: Graphics }

const palette = {
  hit: { core: '#fff3e0', glow: '#ff9e5a' },
  critical: { core: '#ffe9a8', glow: '#ff6a3a' },
  miss: { core: '#cfd6dc', glow: '#8f9aa3' }
}
const ease = (t: number) => 1 - Math.pow(1 - t, 3)

export class BoardEffects {
  private live: Live[] = []
  constructor(private layer: Container) {}

  get playing() { return this.live.length }

  private add(duration: number, draw: Live['draw']) {
    const g = new Graphics()
    this.layer.addChild(g)
    this.live.push({ start: performance.now(), duration, draw, g })
  }

  /** Advance every effect; called from the renderer's ticker. */
  step(now = performance.now()) {
    this.live = this.live.filter(effect => {
      const t = (now - effect.start) / effect.duration
      if (t >= 1) { effect.g.destroy(); return false }
      effect.draw(effect.g.clear(), Math.max(0, t))
      return true
    })
  }

  clear() {
    for (const effect of this.live) effect.g.destroy()
    this.live = []
  }

  /** A melee swing: an arc around the target, turning with the direction of the attack. */
  melee(from: { x: number; y: number }, to: { x: number; y: number; radius: number }, outcome: Outcome, scale: number) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x)
    const colors = palette[outcome]
    const reach = to.radius * 1.35
    const width = (outcome === 'critical' ? 6 : 4) * scale
    const sparks = outcome === 'miss' ? [] : burstSparks(outcome === 'critical' ? 14 : 8)
    this.add(520, (g, t) => {
      const sweep = ease(Math.min(1, t / .7))
      const start = angle - 2.45 + sweep * 2.8
      const alpha = t < .3 ? t / .3 : 1 - (t - .3) / .7
      g.arc(to.x, to.y, reach, start - .9, start).stroke({ width: width * 2.2, color: colors.glow, alpha: alpha * .35 })
      g.arc(to.x, to.y, reach, start - .9, start).stroke({ width, color: colors.core, alpha })
      if (t > .35) drawSparks(g, sparks, to, to.radius * 1.6, (t - .35) / .65, colors.glow, scale)
    })
  }

  /** A ranged shot: a bolt travels, then bursts on the target (or fizzles grey on a miss). */
  ranged(from: { x: number; y: number }, to: { x: number; y: number; radius: number }, outcome: Outcome, scale: number) {
    const colors = palette[outcome]
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy) || 1
    const ux = dx / length
    const uy = dy / length
    const tail = 26 * scale
    const sparks = burstSparks(outcome === 'critical' ? 16 : outcome === 'miss' ? 5 : 10)
    this.add(900, (g, t) => {
      const fly = Math.min(1, t / .5)
      if (fly < 1) {
        const head = { x: from.x + dx * ease(fly), y: from.y + dy * ease(fly) }
        g.moveTo(head.x - ux * tail, head.y - uy * tail).lineTo(head.x, head.y).stroke({ width: 8 * scale, color: colors.glow, alpha: .35 })
        g.moveTo(head.x - ux * tail, head.y - uy * tail).lineTo(head.x, head.y).stroke({ width: 3 * scale, color: colors.core })
      } else {
        const burst = (t - .5) / .5
        g.circle(to.x, to.y, to.radius * (.4 + burst * 1.2)).fill({ color: colors.glow, alpha: (1 - burst) * (outcome === 'miss' ? .25 : .5) })
        drawSparks(g, sparks, to, to.radius * 1.8, burst, colors.core, scale)
      }
    })
  }

  /** A spell area: flashes in its colour, a ring spreads from the middle, embers rise and everything fades. */
  area(shape: AreaOutline, color: string, toWorld: (point: { x: number; y: number }) => { x: number; y: number }, cell: number, scale: number) {
    const points = 'radius' in shape ? undefined : shape.points.map(toWorld)
    const center = 'radius' in shape ? toWorld(shape.center)
      : { x: points!.reduce((sum, p) => sum + p.x, 0) / points!.length, y: points!.reduce((sum, p) => sum + p.y, 0) / points!.length }
    const radius = 'radius' in shape ? shape.radius * cell
      : Math.max(...points!.map(p => Math.hypot(p.x - center.x, p.y - center.y)))
    const embers = Array.from({ length: 18 }, () => ({ x: (Math.random() * 2 - 1) * radius * .8, y: (Math.random() * 2 - 1) * radius * .8, rise: .4 + Math.random() * .6 }))
    this.add(1450, (g, t) => {
      const alpha = t < .15 ? t / .15 : 1 - (t - .15) / .85
      if (points) g.poly(points.flatMap(p => [p.x, p.y]))
      else g.circle(center.x, center.y, radius)
      g.fill({ color, alpha: .45 * alpha }).stroke({ width: 2 * scale, color, alpha })
      g.circle(center.x, center.y, radius * ease(Math.min(1, t * 1.6))).stroke({ width: 3 * scale, color: '#fff3e0', alpha: alpha * .5 })
      for (const ember of embers) {
        g.circle(center.x + ember.x, center.y + ember.y - t * ember.rise * cell * 1.5, 2.2 * scale).fill({ color: '#ffd08a', alpha })
      }
    })
  }
}

type Spark = { angle: number; speed: number }
function burstSparks(count: number): Spark[] {
  return Array.from({ length: count }, (_, index) => ({ angle: index / count * Math.PI * 2 + Math.random() * .5, speed: .6 + Math.random() * .4 }))
}
function drawSparks(g: Graphics, sparks: Spark[], at: { x: number; y: number }, reach: number, t: number, color: string, scale: number) {
  const out = ease(t)
  for (const spark of sparks) {
    const r = reach * out * spark.speed
    g.circle(at.x + Math.cos(spark.angle) * r, at.y + Math.sin(spark.angle) * r, 2.4 * scale * (1 - t)).fill({ color, alpha: 1 - t })
  }
}
