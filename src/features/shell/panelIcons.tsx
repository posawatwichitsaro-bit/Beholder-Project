import { Library, Map as MapIcon, Package, ScrollText, Settings, Skull, Swords, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { D20Icon } from '../../ui/index.ts'
import type { PanelId } from './panelRegistry.ts'

const size = 19

export const panelIcons: Record<PanelId, ReactNode> = {
  scenes: <MapIcon size={size} />,
  sheets: <ScrollText size={size} />,
  actor: <UserRound size={size} />,
  objects: <Package size={size} />,
  combat: <Swords size={size} />,
  dice: <D20Icon size={size} />,
  manual: <Skull size={size} />,
  library: <Library size={size} />,
  account: <Settings size={size} />
}

/** Bookmark colour per panel, so a panel and its rail button read as a pair. */
export const panelTabs: Record<PanelId, string> = {
  scenes: 'var(--bh-tab-1)',
  sheets: 'var(--bh-tab-2)',
  actor: 'var(--bh-tab-2)',
  objects: 'var(--bh-tab-3)',
  combat: 'var(--bh-crimson)',
  dice: 'var(--bh-tab-4)',
  manual: 'var(--bh-tab-3)',
  library: 'var(--bh-tab-5)',
  account: 'var(--bh-surface-3)'
}
