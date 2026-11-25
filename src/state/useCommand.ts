import { api, commandId, json } from '../lib/api.ts'
import { refreshRoom } from './connection.ts'
import { currentRoom, roomPath, useRoomStore } from './roomStore.ts'

export type Command = Record<string, unknown>
export type Send = (command: Command) => Promise<boolean>

const privateRollTypes = new Set(['roll', 'sheetRoll', 'attackObject'])
let inFlight = false

/**
 * Send one command to the server, then refresh the snapshot.
 *
 * Commands run one at a time; a command sent while another is in flight is
 * dropped and returns false (callers already treat false as "not applied").
 * Each command carries a fresh `commandId` and the current revision. When the
 * browser gets no HTTP response at all, the same payload is retried once and
 * the server answers from its receipt instead of applying it twice.
 */
export async function sendCommand(command: Command, created?: (sceneId: string) => void): Promise<boolean> {
  if (inFlight) return false
  inFlight = true
  const store = useRoomStore.getState()
  const room = currentRoom()
  store.setError('')
  useRoomStore.setState(state => ({ pending: state.pending + 1 }))
  try {
    const silent = room.me.role === 'dm' && store.privateRoll && privateRollTypes.has(String(command.type))
    const payload = json({ ...command, privateRoll: silent, commandId: commandId(), revision: room.revision })
    let receipt: { sceneId?: string }
    try { receipt = await api(roomPath(room.id) + '/commands', payload) }
    catch (error) {
      if (!(error instanceof TypeError)) throw error
      receipt = await api(roomPath(room.id) + '/commands', payload)
    }
    await refreshRoom(room.id).catch(() => {})
    if (receipt.sceneId) created?.(receipt.sceneId)
    return true
  } catch (error) {
    useRoomStore.getState().setError((error as Error).message)
    await refreshRoom(room.id).catch(() => {})
    return false
  } finally {
    inFlight = false
    useRoomStore.setState(state => ({ pending: Math.max(0, state.pending - 1) }))
  }
}

/** `send` plus a `pending` flag so buttons can show that a command is on its way. */
export function useCommand() {
  const pending = useRoomStore(state => state.pending > 0)
  return { send: sendCommand, pending }
}
