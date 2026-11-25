import type { PanelId } from './panelRegistry.ts'

/**
 * Which panels are open in the right-hand dock.
 *
 * - The dock shows at most two panels, top first.
 * - Opening a panel replaces what is there, as the old drawer did, unless a
 *   panel is pinned: the pinned one stays on top and the new one goes under it.
 * - `stack` keeps the current top panel and puts the new one under it. It is
 *   used, for example, to show dice results under the sheet the roll came from.
 */
export type DockState = { open: PanelId[]; pinned: PanelId | null }

export type DockAction =
  | { type: 'open'; id: PanelId; stack?: boolean }
  | { type: 'toggle'; id: PanelId }
  | { type: 'close'; id: PanelId }
  | { type: 'closeAll' }
  | { type: 'pin'; id: PanelId }

export const emptyDock: DockState = { open: [], pinned: null }

const maxPanels = 2

function opened(state: DockState, id: PanelId, stack: boolean): DockState {
  if (state.open.includes(id)) return state
  const keep = state.pinned && state.open.includes(state.pinned) ? state.pinned : stack ? state.open[0] : undefined
  const open = keep && keep !== id ? [keep, id] : [id]
  return { ...state, open: open.slice(0, maxPanels) }
}

export function dockReducer(state: DockState, action: DockAction): DockState {
  switch (action.type) {
    case 'open': return opened(state, action.id, action.stack ?? false)
    case 'toggle': return state.open.includes(action.id) ? dockReducer(state, { type: 'close', id: action.id }) : opened(state, action.id, false)
    case 'close': return {
      open: state.open.filter(id => id !== action.id),
      pinned: state.pinned === action.id ? null : state.pinned
    }
    case 'closeAll': return state.pinned && state.open.includes(state.pinned)
      ? { ...state, open: [state.pinned] }
      : { ...state, open: [] }
    case 'pin': return { ...state, pinned: state.pinned === action.id ? null : action.id }
  }
}
