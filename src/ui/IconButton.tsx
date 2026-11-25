import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Tooltip } from './Tooltip.tsx'
import type { TooltipSide } from './Tooltip.tsx'

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** Accessible name, also shown as the tooltip. */
  label: string
  shortcut?: string
  tooltipSide?: TooltipSide
  icon: ReactNode
  /** Toggle buttons report their state with aria-pressed. */
  pressed?: boolean
}

export function IconButton({ label, shortcut, tooltipSide, icon, pressed, className, type = 'button', ...rest }: Props) {
  return <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
    <button {...rest} type={type} className={'bh-icon-button' + (className ? ' ' + className : '')}
      aria-label={label} aria-keyshortcuts={shortcut} aria-pressed={pressed}>
      <span aria-hidden="true" style={{ display: 'inline-flex' }}>{icon}</span>
    </button>
  </Tooltip>
}
