export type HpSide = 'ally' | 'foe'
export type HpTone = 'ally' | 'foe' | 'warn' | 'critical' | 'down'

/**
 * Colour band for a health bar. Above half: the side's own colour, so friend
 * and foe stay distinct at a glance; at or below half: warning; at or below a
 * quarter: critical; at zero: down.
 */
export function hpTone(hp: number, max: number, side: HpSide): HpTone {
  if (max <= 0 || hp <= 0) return 'down'
  const ratio = hp / max
  if (ratio <= 0.25) return 'critical'
  if (ratio <= 0.5) return 'warn'
  return side
}

/** Fill width in percent, clamped to 0–100. */
export function hpPercent(hp: number, max: number) {
  if (max <= 0) return 0
  return Math.max(0, Math.min(100, Math.round(hp / max * 100)))
}

export const hpToneColor: Record<HpTone, string> = {
  ally: 'var(--bh-hp-ally)',
  foe: 'var(--bh-hp-foe)',
  warn: 'var(--bh-hp-warn)',
  critical: 'var(--bh-hp-critical)',
  down: 'transparent'
}
