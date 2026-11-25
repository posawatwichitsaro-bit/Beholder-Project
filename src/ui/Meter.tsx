import type { CSSProperties } from 'react'
import { hpPercent, hpTone, hpToneColor } from './hp.ts'
import type { HpSide } from './hp.ts'
import type { Surface } from './Panel.tsx'

/** Health bar. Reports its value as a meter so screen readers can read HP. */
export function HpBar({ hp, max, temp = 0, side = 'ally', label, height = 8, surface = 'leather' }: {
  hp: number; max: number; temp?: number; side?: HpSide; label: string; height?: number; surface?: Surface
}) {
  const percent = hpPercent(hp, max)
  const tempPercent = temp > 0 ? Math.min(100 - percent, hpPercent(temp, max)) : 0
  const tone = hpTone(hp, max, side)
  return <span className="bh-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.max(0, hp)}
    aria-valuetext={`${Math.max(0, hp)} / ${max} HP` + (temp > 0 ? ` · Temp ${temp}` : '')}
    data-surface={surface} data-tone={tone} style={{ '--_h': height + 'px' } as CSSProperties}>
    <span className="bh-meter-fill" style={{ width: percent + '%', '--_fill': hpToneColor[tone] } as CSSProperties} />
    {tempPercent > 0 && <span className="bh-meter-temp" style={{ left: percent + '%', width: tempPercent + '%' }} />}
  </span>
}
