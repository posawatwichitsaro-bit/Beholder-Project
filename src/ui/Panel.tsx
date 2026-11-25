import type { HTMLAttributes, ReactNode } from 'react'

export type Surface = 'leather' | 'parchment'

type Props = HTMLAttributes<HTMLElement> & {
  surface?: Surface
  title?: ReactNode
  /** Controls placed at the end of the header (close button, toggles). */
  actions?: ReactNode
  as?: 'section' | 'aside' | 'div'
}

/** A card surface. Parchment for reading and deciding; leather for HUD chrome. */
export function Panel({ surface = 'parchment', title, actions, as: Tag = 'section', className, children, ...rest }: Props) {
  const parchment = surface === 'parchment'
  return <Tag {...rest} className={'bh-panel' + (parchment ? ' bh-on-parchment' : '') + (className ? ' ' + className : '')} data-surface={surface}>
    {(title || actions) && <header className="bh-panel-header">
      {title && <h2 className="bh-panel-title">{title}</h2>}
      {actions}
    </header>}
    {children}
  </Tag>
}

export function PanelBody({ children }: { children: ReactNode }) {
  return <div className="bh-panel-body">{children}</div>
}
