import type { ReactNode } from 'react'

export type TooltipSide = 'top' | 'bottom' | 'left'

/**
 * Hover/focus label with an optional keyboard shortcut. Purely visual: the
 * wrapped control must still carry its own accessible name.
 */
export function Tooltip({ label, shortcut, side = 'top', children }: {
  label: string; shortcut?: string; side?: TooltipSide; children: ReactNode
}) {
  return <span className="bh-tooltip" data-side={side}>
    {children}
    <span className="bh-tooltip-bubble" aria-hidden="true">{label}{shortcut && <kbd className="bh-kbd">{shortcut}</kbd>}</span>
  </span>
}
