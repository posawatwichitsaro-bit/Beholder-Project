import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Role } from '../../state/prefs.ts'
import { placeCard, tours } from './tour.ts'
import type { Rect, Size } from './tour.ts'

/**
 * First-run tour: a parchment card that walks through a few spots on screen,
 * with the spot lit and the rest dimmed. It never blocks the table — clicks
 * pass through — and Esc or "ข้ามทัวร์" ends it for good on this device.
 */
export function Tour({ role, close }: { role: Role; close: () => void }) {
  const steps = tours[role]
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect>()
  const [card, setCard] = useState<Size>({ width: 340, height: 200 })
  const [view, setView] = useState<Size>({ width: window.innerWidth, height: window.innerHeight })
  const cardRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const step = steps[index]
  const last = index === steps.length - 1

  useLayoutEffect(() => {
    function measure() {
      const box = [step.target, step.fallback].map(selector => selector ? document.querySelector(selector)?.getBoundingClientRect() : undefined)
        .find(found => found && found.width && found.height)
      setRect(box && box.width && box.height ? { left: box.left, top: box.top, width: box.width, height: box.height } : undefined)
      const size = cardRef.current?.getBoundingClientRect()
      if (size) setCard({ width: size.width, height: size.height })
      setView({ width: window.innerWidth, height: window.innerHeight })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [step])
  useEffect(() => { nextRef.current?.focus({ preventScroll: true }) }, [index])
  useEffect(() => {
    // Capture phase, so Esc ends the tour before the table treats it as "close panels".
    function key(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [close])

  // A target covering most of the screen (the board) is explained with the card in the middle.
  const big = rect && rect.width * rect.height > view.width * view.height * 0.5
  const spot = placeCard(big ? undefined : rect, card, view)
  return <div className="tour" role="dialog" aria-modal="false" aria-labelledby="tour-title" aria-describedby="tour-body">
    {rect ? <div className="tour-spot" aria-hidden="true" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }} />
      : <div className="tour-dim" aria-hidden="true" />}
    <div ref={cardRef} className="tour-card bh-on-parchment" data-side={big ? 'center' : spot.side} style={{ left: spot.left, top: spot.top }}>
      <small className="tour-count">{index + 1} / {steps.length}</small>
      <h2 id="tour-title">{step.title}</h2>
      <p id="tour-body">{step.body}</p>
      <div className="tour-dots" aria-hidden="true">{steps.map((_, dot) => <span key={dot} data-active={dot === index || undefined} />)}</div>
      <footer>
        <button type="button" className="tour-skip" onClick={close}>{last ? 'ปิด' : 'ข้ามทัวร์'}</button>
        {index > 0 && <button type="button" className="bh-button" data-variant="secondary" data-size="md" onClick={() => setIndex(index - 1)}>ก่อนหน้า</button>}
        <button ref={nextRef} type="button" className="bh-button" data-variant="primary" data-size="md"
          onClick={() => last ? close() : setIndex(index + 1)}>{last ? 'เริ่มเล่น' : 'ถัดไป'}</button>
      </footer>
    </div>
  </div>
}
