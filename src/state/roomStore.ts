import { create } from 'zustand'
import type { Snapshot } from '../../shared/model.ts'

/**
 * Client-side copy of the room the viewer is seated in.
 *
 * The server is the source of truth: every state change arrives as a full
 * snapshot (HTTP refresh or WebSocket push). `accept` drops snapshots older
 * than the one already held, so a slow poll can never roll the table back.
 */
type RoomState = {
  room?: Snapshot
  online: boolean
  /** Number of commands currently waiting for the server. */
  pending: number
  error: string
  notice: string
  /** DM-only: send rolls privately instead of to the whole table. */
  privateRoll: boolean
  accept: (next: Snapshot) => void
  enterRoom: (room: Snapshot) => void
  leaveRoom: () => void
  setOnline: (online: boolean) => void
  setError: (error: string) => void
  setNotice: (notice: string) => void
  clearMessages: () => void
  setPrivateRoll: (value: boolean) => void
}

export const useRoomStore = create<RoomState>()(set => ({
  room: undefined,
  online: false,
  pending: 0,
  error: '',
  notice: '',
  privateRoll: false,
  accept: next => set(state => {
    const current = state.room
    if (current && current.id === next.id && next.revision < current.revision) return {}
    return { room: next }
  }),
  enterRoom: room => set({ room, online: false, pending: 0, error: '', notice: '', privateRoll: false }),
  leaveRoom: () => set({ room: undefined, online: false, pending: 0 }),
  setOnline: online => set({ online }),
  setError: error => set({ error }),
  setNotice: notice => set({ notice }),
  clearMessages: () => set({ error: '', notice: '' }),
  setPrivateRoll: privateRoll => set({ privateRoll })
}))

/** The latest snapshot outside React render (event handlers, async loops). */
export function currentRoom(): Snapshot {
  const room = useRoomStore.getState().room
  if (!room) throw new Error('No room is loaded')
  return room
}

export function roomPath(id: string) {
  return '/api/rooms/' + id
}
