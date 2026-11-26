import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { GripVertical } from 'lucide-react'
import { usePrefs } from '../state/prefs.ts'

/** Style for a movable HUD piece: its saved offset as a CSS `translate` (which leaves its own `transform` alone). */
export function useMovable(id: string): { 'data-movable': string; style: CSSProperties } {
  const offset = usePrefs(state => state.layout[id])
  return { 'data-movable': id, style: offset ? { translate: offset.x + 'px ' + offset.y + 'px' } : {} }
}

/** Keep at least `keep` px of the piece on screen. */
function clamp(rect: DOMRect, x: number, y: number, base: { x: number; y: number }, keep = 48) {
  const left = rect.left - base.x + x
  const top = rect.top - base.y + y
  return {
    x: x + Math.max(0, keep - (left + rect.width)) - Math.max(0, left + keep - window.innerWidth),
    y: y + Math.max(0, -top) - Math.max(0, top + keep - window.innerHeight)
  }
}

/**
 * A grip that drags the nearest `[data-movable]` piece around the screen; the
 * place is saved on this device. Arrow keys nudge it 10 px (Shift: 40 px),
 * double-click puts it back. "รีเซ็ตตำแหน่ง UI" in settings resets them all.
 */
export function MoveHandle({ id, label, className }: { id: string; label: string; className?: string }) {
  const update = usePrefs(state => state.update)
  const save = (offset: { x: number; y: number } | undefined) => {
    const layout = { ...usePrefs.getState().layout }
    if (offset && (offset.x || offset.y)) layout[id] = offset
    else delete layout[id]
    update({ layout })
  }
  function down(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    const host = event.currentTarget.closest('[data-movable]') as HTMLElement | null
    if (!host) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const base = usePrefs.getState().layout[id] ?? { x: 0, y: 0 }
    const rect = host.getBoundingClientRect()
    const start = { x: event.clientX, y: event.clientY }
    let current = base
    host.dataset.moving = 'true'
    const move = (moveEvent: globalThis.PointerEvent) => {
      current = clamp(rect, base.x + moveEvent.clientX - start.x, base.y + moveEvent.clientY - start.y, base)
      host.style.translate = current.x + 'px ' + current.y + 'px'
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      delete host.dataset.moving
      save(current)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }
  function key(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 40 : 10
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]
    if (!delta) return
    event.preventDefault()
    event.stopPropagation()
    const host = event.currentTarget.closest('[data-movable]') as HTMLElement | null
    const base = usePrefs.getState().layout[id] ?? { x: 0, y: 0 }
    save(host ? clamp(host.getBoundingClientRect(), base.x + delta[0], base.y + delta[1], base) : { x: base.x + delta[0], y: base.y + delta[1] })
  }
  return <button type="button" className={'move-handle' + (className ? ' ' + className : '')} aria-label={'ย้าย ' + label}
    title={'ลากเพื่อย้าย ' + label + ' · ดับเบิลคลิกเพื่อคืนที่เดิม'} onPointerDown={down} onKeyDown={key} onDoubleClick={() => save(undefined)}>
    <GripVertical size={14} aria-hidden="true" />
  </button>
}
