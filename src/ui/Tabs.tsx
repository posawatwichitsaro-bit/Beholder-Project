import { useRef } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'

export type TabItem<T extends string> = { id: T; label: string; color?: string }

/** Move focus between tabs with the arrow keys, Home and End (WAI-ARIA tabs pattern). */
function useRovingKeys<T extends string>(items: TabItem<T>[], onSelect: (id: T) => void, vertical: boolean) {
  const list = useRef<HTMLDivElement>(null)
  return {
    ref: list,
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      const keys = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']
      const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role=tab]') ?? [])
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (index < 0) return
      let next = -1
      if (event.key === keys[0]) next = (index - 1 + buttons.length) % buttons.length
      else if (event.key === keys[1]) next = (index + 1) % buttons.length
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = buttons.length - 1
      if (next < 0) return
      event.preventDefault()
      buttons[next].focus()
      onSelect(items[next].id)
    }
  }
}

export function Tabs<T extends string>({ items, value, onChange, label }: {
  items: TabItem<T>[]; value: T; onChange: (id: T) => void; label: string
}) {
  const roving = useRovingKeys(items, onChange, false)
  return <div className="bh-tabs" role="tablist" aria-label={label} {...roving}>
    {items.map(item => <button key={item.id} type="button" role="tab" className="bh-tab"
      aria-selected={item.id === value} tabIndex={item.id === value ? 0 : -1} onClick={() => onChange(item.id)}>{item.label}</button>)}
  </div>
}

/** Vertical bookmark tabs along the edge of a book panel (Grimoire). */
export function Bookmarks<T extends string>({ items, value, onChange, label }: {
  items: TabItem<T>[]; value: T; onChange: (id: T) => void; label: string
}) {
  const roving = useRovingKeys(items, onChange, true)
  return <div className="bh-bookmarks" role="tablist" aria-label={label} aria-orientation="vertical" {...roving}>
    {items.map((item, index) => <button key={item.id} type="button" role="tab" className="bh-bookmark"
      style={{ '--_tab': item.color ?? `var(--bh-tab-${(index % 5) + 1})` } as CSSProperties}
      aria-selected={item.id === value} tabIndex={item.id === value ? 0 : -1} onClick={() => onChange(item.id)}>{item.label}</button>)}
  </div>
}
