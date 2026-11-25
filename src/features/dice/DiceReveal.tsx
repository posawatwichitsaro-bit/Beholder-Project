import { useEffect, useRef, useState } from 'react'
import type { Roll } from '../../../shared/model.ts'
import { usePrefs } from '../../state/prefs.ts'
import { diceOutcome, dieOf, faceOf } from './diceOutcome.ts'
import type { DiceOutcome } from './diceOutcome.ts'
import { playDiceSound } from './sound.ts'

type Reveal = { roll: Roll; outcome: DiceOutcome; key: number }
const shapes: Record<number, string> = {
  4: '50,6 94,88 6,88',
  6: '14,14 86,14 86,86 14,86',
  8: '50,4 94,50 50,96 6,50',
  10: '50,4 92,40 76,92 24,92 8,40',
  12: '50,4 90,30 90,72 50,96 10,72 10,30',
  20: '50,3 93,27 93,73 50,97 7,73 7,27'
}

/**
 * A short dice animation for each new roll at the table (yours and others'):
 * the die tumbles, lands on its face, then shows the total. Natural 20s burst
 * gold, natural 1s shake red. Purely visual — the dice tray and log announce
 * results to screen readers — so its text lives in CSS attributes, not the DOM.
 */
export function DiceReveal({ rolls }: { rolls: Roll[] }) {
  const sound = usePrefs(state => state.sound)
  const seen = useRef<Set<string> | null>(null)
  const queue = useRef<Reveal[]>([])
  const counter = useRef(0)
  const [current, setCurrent] = useState<Reveal>()

  useEffect(() => {
    // Rolls already on the table when the board opens are history, not news.
    if (!seen.current) { seen.current = new Set(rolls.map(roll => roll.id)); return }
    const fresh = rolls.filter(roll => !seen.current!.has(roll.id))
    for (const roll of fresh) {
      seen.current.add(roll.id)
      queue.current.push({ roll, outcome: diceOutcome(roll), key: ++counter.current })
    }
    queue.current = queue.current.slice(-3)
    if (!current && queue.current.length) setCurrent(queue.current.shift())
  }, [rolls])

  useEffect(() => {
    if (!current) return
    if (sound) playDiceSound(current.outcome)
    const timer = setTimeout(() => setCurrent(queue.current.shift()), current.outcome === 'normal' ? 1700 : 2600)
    return () => clearTimeout(timer)
  }, [current])

  if (!current) return null
  const { roll, outcome } = current
  const sides = dieOf(roll)
  const banner = outcome === 'critical' ? 'CRITICAL!' : outcome === 'fumble' ? 'พลาดเต็ม ๆ' : ''
  return <div key={current.key} className="dice-reveal" data-outcome={outcome} aria-hidden="true">
    <div className="dice-reveal-die">
      <svg viewBox="0 0 100 100" width="76" height="76"><polygon points={shapes[sides] ?? shapes[20]} /></svg>
      <span className="dice-reveal-face" data-text={String(faceOf(roll))} />
    </div>
    <div className="dice-reveal-text">
      <span className="dice-reveal-who" data-text={roll.name + ' · ' + roll.label} />
      <span className="dice-reveal-total" data-text={String(roll.total)} />
      {banner && <span className="dice-reveal-banner" data-text={banner} />}
    </div>
  </div>
}
