import { readFileSync } from 'node:fs'
import { catalogMonsters } from '../shared/monsterManual.ts'
import type { ManualMonster } from '../shared/monsterManual.ts'

let byId: Map<string, ManualMonster> | undefined

/** The SRD monster catalog the client also loads (public/data/srd-monsters.json), read once (0.15, encounters). */
export function serverMonster(id: unknown) {
  byId ??= new Map(catalogMonsters(JSON.parse(readFileSync(new URL('../public/data/srd-monsters.json', import.meta.url), 'utf8'))).map(monster => [monster.id, monster]))
  return typeof id === 'string' ? byId.get(id) : undefined
}
