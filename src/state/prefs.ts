import { create } from 'zustand'

/**
 * Per-device preferences, kept in localStorage. Storage can be unavailable
 * (private windows, blocked site data), so every read and write is guarded and
 * the defaults always work.
 */
export type Role = 'dm' | 'player'
export type PrefValues = {
  /** Dice sounds. */
  sound: boolean
  /** Interface size, 0.9 – 1.25 (scales text and rem-based spacing). */
  uiScale: number
  /** Turn animations off even when the system does not ask for it. */
  reduceMotion: boolean
  /** Grid lines on the board (calibration always shows them). */
  showGrid: boolean
  /** First-run tour finished or skipped, per role. */
  tourSeen: Record<Role, boolean>
  /** Where each movable HUD piece was dragged to, as an offset from its usual place (px). */
  layout: Record<string, { x: number; y: number }>
}
type Prefs = PrefValues & {
  setSound: (on: boolean) => void
  update: (patch: Partial<PrefValues>) => void
}

const key = 'beholder.prefs'
export const uiScales = [0.9, 1, 1.1, 1.25] as const
export const defaultPrefs: PrefValues = { sound: true, uiScale: 1, reduceMotion: false, showGrid: true, tourSeen: { dm: false, player: false }, layout: {} }

/** Stored values, checked one by one so a bad or old entry falls back to its default. */
export function readPrefs(raw: string | null): PrefValues {
  let stored: Record<string, unknown> = {}
  try { stored = JSON.parse(raw ?? '{}') ?? {} } catch { /* ignore broken storage */ }
  const flag = (name: keyof PrefValues, fallback: boolean) => typeof stored[name] === 'boolean' ? stored[name] as boolean : fallback
  const scale = Number(stored.uiScale)
  const tour = (stored.tourSeen ?? {}) as Record<string, unknown>
  return {
    sound: flag('sound', defaultPrefs.sound),
    uiScale: Number.isFinite(scale) ? Math.min(1.25, Math.max(0.9, scale)) : defaultPrefs.uiScale,
    reduceMotion: flag('reduceMotion', defaultPrefs.reduceMotion),
    showGrid: flag('showGrid', defaultPrefs.showGrid),
    tourSeen: { dm: tour.dm === true, player: tour.player === true },
    layout: readLayout(stored.layout)
  }
}

/** Offsets for known-looking ids only, finite and within ±4000 px. */
function readLayout(value: unknown): PrefValues['layout'] {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([id, offset]) => {
    const point = offset as { x?: unknown; y?: unknown }
    const ok = /^[a-z-]{1,40}$/.test(id) && typeof point?.x === 'number' && typeof point?.y === 'number' &&
      Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 4000 && Math.abs(point.y) <= 4000
    return ok ? [[id, { x: Math.round(point.x as number), y: Math.round(point.y as number) }]] : []
  }))
}

function load(): PrefValues {
  try { return readPrefs(localStorage.getItem(key)) }
  catch { return { ...defaultPrefs, tourSeen: { ...defaultPrefs.tourSeen }, layout: {} } }
}
function persist(prefs: PrefValues) {
  try { localStorage.setItem(key, JSON.stringify(prefs)) }
  catch { /* storage unavailable: keep the setting for this visit only */ }
}
const values = ({ sound, uiScale, reduceMotion, showGrid, tourSeen, layout }: PrefValues): PrefValues => ({ sound, uiScale, reduceMotion, showGrid, tourSeen, layout })

export const usePrefs = create<Prefs>()((set, get) => ({
  ...load(),
  setSound: sound => get().update({ sound }),
  update: patch => {
    const next = { ...values(get()), ...patch }
    persist(next)
    set(next)
  }
}))

/** Push the display settings onto <html>: UI scale as a CSS variable, reduced motion as a data attribute. */
export function applyDisplayPrefs(prefs: Pick<PrefValues, 'uiScale' | 'reduceMotion'>, root = document.documentElement) {
  root.style.setProperty('--bh-ui-scale', String(prefs.uiScale))
  if (prefs.reduceMotion) root.dataset.motion = 'reduce'
  else delete root.dataset.motion
}
