import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { chooseMode } from '../../shared/advantage.ts'
import type { Odds, RollMode } from '../../shared/advantage.ts'

/**
 * Right-click (or press and hold on a touch screen) any d20 roll button to
 * pick Normal, Advantage or Disadvantage. A plain click still rolls the way
 * the conditions say. The suggestion from the conditions is marked with why.
 */
type Open = { x: number; y: number; run: (mode: RollMode, inspired?: boolean) => void; odds?: Odds; title?: string; inspiration?: number }

let show: ((state: Open | undefined) => void) | undefined
/** Long-press opened the menu: the click that follows the finger lifting must not also roll. */
let swallowClick = false
const holdMs = 500

/** `inspiration`: the Bardic Inspiration die the roller holds; the menu then offers to add it. */
export type RollMenuOptions = { odds?: () => Odds | undefined; title?: string; inspiration?: () => number | undefined }

/** Props to spread on a roll button: `run(mode)` rolls with that mode chosen by the player. */
export function rollMenuProps(run: (mode: RollMode, inspired?: boolean) => void, options: RollMenuOptions = {}) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let start: { x: number; y: number } | undefined
  const open = (x: number, y: number) => show?.({ x, y, run, odds: options.odds?.(), title: options.title, inspiration: options.inspiration?.() })
  const cancel = () => { if (timer) clearTimeout(timer); timer = undefined }
  return {
    onContextMenu: (event: ReactMouseEvent) => {
      if ((event.currentTarget as HTMLButtonElement).disabled) return
      event.preventDefault()
      open(event.clientX, event.clientY)
    },
    onPointerDown: (event: ReactPointerEvent) => {
      if (event.pointerType === 'mouse') return
      start = { x: event.clientX, y: event.clientY }
      cancel()
      timer = setTimeout(() => { swallowClick = true; open(start!.x, start!.y) }, holdMs)
    },
    onPointerMove: (event: ReactPointerEvent) => {
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (event: ReactMouseEvent) => {
      if (!swallowClick) return
      swallowClick = false
      event.preventDefault()
      event.stopPropagation()
    }
  }
}

const modeLabels: Record<RollMode, string> = { normal: 'ปกติ', advantage: 'Advantage', disadvantage: 'Disadvantage' }

/** Mount once on the table: draws the menu wherever a roll button asked for it. */
export function RollMenuHost() {
  const [state, setState] = useState<Open>()
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    show = setState
    return () => { if (show === setState) show = undefined }
  }, [])
  useEffect(() => {
    if (!state) return
    menu.current?.querySelector<HTMLButtonElement>('[data-suggested="true"], button')?.focus()
    const close = (event: Event) => { if (!menu.current?.contains(event.target as Node)) setState(undefined) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setState(undefined) } }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', key, true) }
  }, [state])
  if (!state) return null
  const suggestion = state.odds ? chooseMode(state.odds) : undefined
  const reason = suggestion?.note.replace(/^(Advantage|Disadvantage) · /, '')
  const left = Math.max(8, Math.min(state.x, window.innerWidth - 228))
  const top = Math.max(8, Math.min(state.y, window.innerHeight - 170))
  return <div ref={menu} className="roll-menu" role="menu" aria-label={'เลือกการทอย' + (state.title ? ' · ' + state.title : '')} style={{ left, top }}>
    {(['normal', 'advantage', 'disadvantage'] as const).map(mode => {
      const suggested = suggestion?.mode === mode && Boolean(suggestion.note)
      return <button key={mode} type="button" role="menuitem" data-mode={mode} data-suggested={suggested}
        onClick={() => { setState(undefined); state.run(mode) }}>
        <b>{modeLabels[mode]}</b>{suggested && <small>แนะนำ · {reason}</small>}
      </button>
    })}
    {state.inspiration && <button type="button" role="menuitem" data-mode="inspiration"
      onClick={() => { setState(undefined); state.run(suggestion?.mode ?? 'normal', true) }}>
      <b>เพิ่ม Inspiration</b><small>ทอยตามเงื่อนไข + d{state.inspiration} แล้วใช้หมด</small></button>}
  </div>
}
