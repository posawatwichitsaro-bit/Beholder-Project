import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * Modal dialog on parchment.
 * - Escape and the close button call `onClose`.
 * - Focus moves into the dialog on open and returns to the opener on close.
 * - The scrim also carries the legacy `scrim` class so the board's keyboard
 *   handlers keep ignoring arrow keys while a dialog is open.
 */
export function Dialog({ title, onClose, footer, size = 'md', children }: {
  title: ReactNode; onClose: () => void; footer?: ReactNode; size?: 'md' | 'lg'; children: ReactNode
}) {
  const titleId = useId()
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const first = box.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-dialog-close]), [href], [tabindex]:not([tabindex="-1"])')
    ;(first ?? box.current)?.focus()
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); close.current() }
    }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('keydown', key); opener?.focus?.() }
  }, [])
  return <div className="bh-scrim scrim" onMouseDown={event => { if (event.target === event.currentTarget) close.current() }}>
    <div ref={box} className="bh-dialog bh-on-parchment" role="dialog" aria-modal="true" aria-labelledby={titleId} data-size={size} tabIndex={-1}>
      <header className="bh-panel-header">
        <h2 id={titleId} className="bh-panel-title">{title}</h2>
        <button type="button" className="bh-icon-button" data-dialog-close aria-label="ปิด" onClick={() => close.current()}><X size={18} aria-hidden="true" /></button>
      </header>
      <div className="bh-panel-body">{children}</div>
      {footer && <footer className="bh-dialog-footer">{footer}</footer>}
    </div>
  </div>
}
