import { api, commandId, json } from '../lib/api.ts'
import { refreshRoom } from './connection.ts'
import { roomPath, useRoomStore } from './roomStore.ts'

export type Command = Record<string, unknown>
export type Send = (command: Command) => Promise<boolean>

const privateRollTypes = new Set(['roll', 'sheetRoll', 'attackObject'])
/** How many commands may wait behind the one in flight before new ones are refused. */
export const queueLimit = 20
let tail: Promise<unknown> = Promise.resolve()
let queued = 0

/**
 * Send one command to the server, then refresh the snapshot.
 *
 * Commands run one at a time, in the order they were sent: a command sent
 * while another is in flight waits its turn instead of being dropped, and
 * reads the revision only when it actually goes out. While anything is queued
 * the store's `pending` count is above zero so the HUD can say "กำลังส่ง…".
 * Each command carries a fresh `commandId`. When the browser gets no HTTP
 * response at all, the same payload is retried once and the server answers
 * from its receipt instead of applying it twice.
 */
export function sendCommand(command: Command, created?: (sceneId: string) => void): Promise<boolean> {
  if (queued > queueLimit) {
    useRoomStore.getState().setError('ส่งคำสั่งถี่เกินไป รอสักครู่แล้วลองอีกครั้ง')
    return Promise.resolve(false)
  }
  queued++
  useRoomStore.setState(state => ({ pending: state.pending + 1 }))
  const run = tail.then(() => deliver(command, created)).finally(() => {
    queued--
    useRoomStore.setState(state => ({ pending: Math.max(0, state.pending - 1) }))
  })
  tail = run.catch(() => {})
  return run
}

async function deliver(command: Command, created?: (sceneId: string) => void): Promise<boolean> {
  const store = useRoomStore.getState()
  const room = store.room
  if (!room) return false
  store.setError('')
  try {
    const silent = room.me.role === 'dm' && store.privateRoll && privateRollTypes.has(String(command.type))
    const payload = json({ ...command, privateRoll: silent, commandId: commandId(), revision: room.revision })
    let receipt: { sceneId?: string; notice?: string }
    try { receipt = await api(roomPath(room.id) + '/commands', payload) }
    catch (error) {
      if (!(error instanceof TypeError)) throw error
      receipt = await api(roomPath(room.id) + '/commands', payload)
    }
    await refreshRoom(room.id).catch(() => {})
    if (receipt.sceneId) created?.(receipt.sceneId)
    // Some commands answer with a short message for this seat only (undo says what it took back).
    if (receipt.notice) useRoomStore.getState().setNotice(receipt.notice)
    return true
  } catch (error) {
    useRoomStore.getState().setError((error as Error).message)
    await refreshRoom(room.id).catch(() => {})
    return false
  }
}

/** `send` plus a `pending` flag so buttons can show that a command is on its way. */
export function useCommand() {
  const pending = useRoomStore(state => state.pending > 0)
  return { send: sendCommand, pending }
}
