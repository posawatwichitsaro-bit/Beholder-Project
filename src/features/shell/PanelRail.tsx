import type { CSSProperties } from 'react'
import { groupLabels } from './panelRegistry.ts'
import type { PanelDef, PanelGroup, PanelId } from './panelRegistry.ts'
import { panelIcons, panelTabs } from './panelIcons.tsx'

/**
 * Bookmark-style buttons down the right edge, one per registered panel.
 * The nav keeps its old name ("ระบบในห้อง") and buttons keep the panel labels
 * as their accessible names, so tests and screen readers find them as before.
 */
export function PanelRail({ items, isPressed, choose, open }: {
  items: PanelDef[]; isPressed: (id: PanelId) => boolean; choose: (id: PanelId) => void; open: boolean
}) {
  const groups = (Object.keys(groupLabels) as PanelGroup[])
    .map(group => ({ group, items: items.filter(item => item.group === group && item.inRail) }))
    .filter(entry => entry.items.length)
  return <nav id="hud-rail" className="hud-rail" aria-label="ระบบในห้อง" hidden={!open}>
    {groups.map(({ group, items }) => <div className="hud-rail-group" key={group} role="group" aria-label={groupLabels[group]}>
      {items.map(item => <button key={item.id} type="button" className="hud-rail-button"
        aria-label={item.label} aria-pressed={isPressed(item.id)} aria-keyshortcuts={item.shortcut}
        style={{ '--_tab': panelTabs[item.id] } as CSSProperties} onClick={() => choose(item.id)}>
        <span aria-hidden="true" className="hud-rail-icon">{panelIcons[item.id]}</span>
        <span aria-hidden="true" className="hud-rail-tip">{item.label}{item.shortcut && <kbd className="bh-kbd">{item.shortcut}</kbd>}</span>
      </button>)}
    </div>)}
  </nav>
}
