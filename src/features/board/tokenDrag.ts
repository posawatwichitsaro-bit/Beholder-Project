import type { DragEvent } from 'react'
import type { Sheet } from '../../../shared/model.ts'

/** Drag-and-drop of sheets and monsters onto the board (desktop). Touch uses tap-to-place instead. */
export const tokenDragType = 'application/x-beholder-token'

export type TokenSource = { actorId: string } | { templateId: string } | { sheet: Sheet }
export type TokenDragPayload = {
  source: TokenSource
  /** Present for player characters: they get an automatic Character / Companion role. */
  name?: string
  ownerId?: string
}

export function tokenDragProps(payload: TokenDragPayload) {
  return {
    draggable: true,
    title: 'ลากลงกระดานเพื่อวาง',
    onDragStart(event: DragEvent) {
      event.dataTransfer.setData(tokenDragType, JSON.stringify(payload))
      event.dataTransfer.effectAllowed = 'copy'
    }
  }
}

export type TokenDragProps = ReturnType<typeof tokenDragProps>

export function readTokenDrag(event: DragEvent): TokenDragPayload | undefined {
  const raw = event.dataTransfer.getData(tokenDragType)
  if (!raw) return undefined
  try { return JSON.parse(raw) as TokenDragPayload }
  catch { return undefined }
}

export function carriesToken(event: DragEvent) {
  return event.dataTransfer.types.includes(tokenDragType)
}
