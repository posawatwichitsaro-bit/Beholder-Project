/**
 * World maps (0.16): region, city or dungeon overview pictures with pins.
 * A new map and the DM's new pins start hidden from players; players may add
 * their own pins to a shared map, and anyone may move the party marker.
 * Positions are fractions of the picture (0–1), so they survive a new upload.
 */
import type { MapAsset, Member } from './model.ts'

export const pinKinds = {
  city: 'เมือง', town: 'หมู่บ้าน', dungeon: 'ดันเจียน', wild: 'ป่าเขา', water: 'น้ำ', poi: 'จุดสำคัญ', danger: 'อันตราย', note: 'โน้ต'
} as const
export type PinKind = keyof typeof pinKinds

export type WorldPin = {
  id: string; x: number; y: number; name: string; kind: PinKind; note?: string
  /** A scene the DM can open from the pin (never sent to players). */
  sceneId?: string
  /** Hidden from players (the DM's pins start this way). */
  hidden?: boolean
  ownerId: string
}
export type WorldMap = {
  id: string; name: string; image?: MapAsset
  /** Players see the map only once the DM shares it. */
  shared?: boolean
  pins: WorldPin[]
  /** Where the party is, as a fraction of the picture. */
  party?: { x: number; y: number }
}
export type PresentingMap = { mapId: string; at: number }

export const worldLimits = { maps: 20, pins: 300, name: 120, note: 2000 }

/** What a member gets of a map: the DM everything; a player a shared map's visible pins, without scene links. */
export function worldMapFor(map: WorldMap, me: Pick<Member, 'id' | 'role'>): WorldMap | undefined {
  if (me.role === 'dm') return map
  if (!map.shared) return undefined
  return { ...map, pins: map.pins.filter(pin => !pin.hidden || pin.ownerId === me.id).map(({ sceneId: _scene, ...pin }) => pin) }
}

/** Who may change a pin: its owner or the DM. */
export const canEditPin = (pin: Pick<WorldPin, 'ownerId'>, me: Pick<Member, 'id' | 'role'>) => me.role === 'dm' || pin.ownerId === me.id
