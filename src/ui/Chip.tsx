import type { ReactNode } from 'react'

/** A condition or filter pill. With `onToggle` it is a toggle button; without, a static label. */
export function Chip({ children, active = false, onToggle, title }: {
  children: ReactNode; active?: boolean; onToggle?: () => void; title?: string
}) {
  if (!onToggle) return <span className="bh-chip" data-active={active} title={title}>{children}</span>
  return <button type="button" className="bh-chip" aria-pressed={active} title={title} onClick={onToggle}>{children}</button>
}
