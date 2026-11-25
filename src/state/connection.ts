import { useEffect } from 'react'
import type { Snapshot } from '../../shared/model.ts'
import { api } from '../lib/api.ts'
import { roomPath, useRoomStore } from './roomStore.ts'

/** Fetch the latest snapshot of a room into the store. */
export async function refreshRoom(roomId: string) {
  useRoomStore.getState().accept(await api<Snapshot>(roomPath(roomId)))
}

/**
 * Keep the store in sync with the server while a room is open:
 * a WebSocket for pushes (reconnecting after 1.2 s) plus a 5 s poll as a safety net.
 */
export function useRoomConnection(roomId: string) {
  useEffect(() => {
    const store = useRoomStore.getState()
    let socket: WebSocket | undefined
    let retry: ReturnType<typeof setTimeout>
    let closed = false
    const open = () => {
      socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + roomPath(roomId) + '/socket')
      socket.onopen = () => { if (!closed) store.setOnline(true) }
      socket.onmessage = event => store.accept(JSON.parse(event.data) as Snapshot)
      socket.onclose = () => {
        if (closed) return
        store.setOnline(false)
        retry = setTimeout(open, 1200)
      }
    }
    open()
    const timer = setInterval(() => { void refreshRoom(roomId).catch(() => {}) }, 5000)
    return () => { closed = true; clearTimeout(retry); clearInterval(timer); socket?.close() }
  }, [roomId])
}
