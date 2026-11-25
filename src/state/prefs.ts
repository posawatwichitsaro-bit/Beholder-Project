import { create } from 'zustand'

/**
 * Per-device preferences, kept in localStorage. Storage can be unavailable
 * (private windows, blocked site data), so every read and write is guarded and
 * the defaults always work.
 */
type Prefs = { sound: boolean; setSound: (on: boolean) => void }

const key = 'beholder.prefs'

function load(): Partial<Prefs> {
  try { return JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Prefs> }
  catch { return {} }
}
function persist(prefs: Pick<Prefs, 'sound'>) {
  try { localStorage.setItem(key, JSON.stringify(prefs)) }
  catch { /* storage unavailable: keep the setting for this visit only */ }
}

export const usePrefs = create<Prefs>()(set => ({
  sound: load().sound ?? true,
  setSound: sound => { persist({ sound }); set({ sound }) }
}))
