import type { CSSProperties, ReactNode } from 'react'
import { Pin, PinOff, X } from 'lucide-react'
import type { PanelId } from './panelRegistry.ts'
import { panelIcons, panelTabs } from './panelIcons.tsx'

export type DockItem = { id: PanelId; title: string; body: ReactNode }

/**
 * The right-hand dock: up to two panels stacked. Keeps the old drawer's id and
 * class so panel content styled for the drawer looks the same until each
 * panel is rebuilt with the UI kit.
 */
export function Dock({ items, pinned, pin, close }: {
  items: DockItem[]; pinned: PanelId | null; pin: (id: PanelId) => void; close: (id: PanelId) => void
}) {
  return <aside className="table-drawer panel hud-dock" id="table-drawer" aria-label="แผงเครื่องมือ" hidden={!items.length} data-count={items.length}>
    {items.map(item => <section key={item.id} className="hud-dock-panel" aria-label={item.title} style={{ '--_tab': panelTabs[item.id] } as CSSProperties}>
      <header className="hud-dock-head">
        <span aria-hidden="true" className="hud-dock-icon">{panelIcons[item.id]}</span>
        <h2>{item.title}</h2>
        <button type="button" className="hud-dock-action" aria-pressed={pinned === item.id}
          aria-label={pinned === item.id ? 'เลิกปักหมุด ' + item.title : 'ปักหมุด ' + item.title}
          title={pinned === item.id ? 'เลิกปักหมุด' : 'ปักหมุดไว้ เปิดแผงอื่นแล้วแผงนี้ยังอยู่'} onClick={() => pin(item.id)}>
          {pinned === item.id ? <PinOff size={16} aria-hidden="true" /> : <Pin size={16} aria-hidden="true" />}
        </button>
        <button type="button" className="hud-dock-action" aria-label={'ปิด ' + item.title} title="ปิด (Esc)" onClick={() => close(item.id)}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="drawer-content hud-dock-body">{item.body}</div>
    </section>)}
  </aside>
}
