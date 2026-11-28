import { readFileSync } from 'node:fs'
import { catalogSpells } from '../shared/spells.ts'
import type { Spell } from '../shared/spells.ts'

let byId: Map<string, Spell> | undefined

/** The SRD spell catalog the client also loads (public/data/srd-spells.json), read once. */
export function serverSpell(id: unknown) {
  byId ??= new Map(catalogSpells(JSON.parse(readFileSync(new URL('../public/data/srd-spells.json', import.meta.url), 'utf8'))).map(spell => [spell.id, spell]))
  return typeof id === 'string' ? byId.get(id) : undefined
}
