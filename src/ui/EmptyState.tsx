import type { ReactNode } from 'react'

/** "Nothing here yet" that also says what to do next, with the action right there when there is one. */
export function EmptyState({ title, hint, children }: { title: string; hint?: ReactNode; children?: ReactNode }) {
  return <div className="bh-empty">
    <b>{title}</b>
    {hint && <p>{hint}</p>}
    {children && <div className="bh-empty-actions">{children}</div>}
  </div>
}
