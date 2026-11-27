import { catalogMonsters } from '../../../shared/monsterManual.ts'
import type { ManualMonster } from '../../../shared/monsterManual.ts'

let loading: Promise<ManualMonster[]> | undefined
/** The SRD monster catalog, fetched once and shared by everything that needs it. */
export function loadMonsterCatalog() {
  loading ??= fetch('/data/srd-monsters.json').then(response => {
    if (!response.ok) throw new Error('เปิดคู่มือไม่สำเร็จ')
    return response.json()
  }).then(catalogMonsters).catch(error => { loading = undefined; throw error })
  return loading
}
