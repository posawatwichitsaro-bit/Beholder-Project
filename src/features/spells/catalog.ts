import { useEffect, useState } from 'react'
import { catalogSpells } from '../../../shared/spells.ts'
import type { Spell } from '../../../shared/spells.ts'

let loading: Promise<Spell[]> | undefined
/** The SRD 5.2.1 spells (~400 KB), fetched once when a sheet first shows its spells. */
export function loadSpellCatalog() {
  loading ??= fetch('/data/srd-spells.json').then(response => {
    if (!response.ok) throw new Error('เปิดคลังเวทไม่สำเร็จ')
    return response.json()
  }).then(catalogSpells).catch(error => { loading = undefined; throw error })
  return loading
}

/** The catalog once loaded, an error message, and a retry. */
export function useSpellCatalog() {
  const [spells, setSpells] = useState<Spell[]>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    loadSpellCatalog().then(list => { if (active) setSpells(list) }).catch(() => { if (active) setError('เปิดคลังเวทไม่สำเร็จ') })
    return () => { active = false }
  }, [attempt])
  return { spells, error, retry: () => setAttempt(value => value + 1) }
}

export const levelName = (level: number) => level === 0 ? 'Cantrip' : 'ระดับ ' + level
