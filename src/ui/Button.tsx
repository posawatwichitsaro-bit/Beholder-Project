import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'brass' | 'ghost' | 'danger'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  /** Shows a spinner and blocks clicks while a command is on its way. */
  pending?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'secondary', size = 'md', pending = false, icon, className, disabled, type = 'button', children, ...rest }: Props) {
  return <button {...rest} type={type} className={'bh-button' + (className ? ' ' + className : '')}
    data-variant={variant} data-size={size} disabled={disabled || pending} aria-busy={pending || undefined}>
    {icon && <span aria-hidden="true" style={{ display: 'inline-flex' }}>{icon}</span>}
    {children}
  </button>
}
