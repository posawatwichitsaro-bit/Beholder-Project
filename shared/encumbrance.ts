import type { InventoryItem, Sheet, Size } from './model.ts'
import { coinCount } from './shop.ts'

/** SRD 5.2.1 carrying capacity scales with size: Tiny ×½, Small and Medium ×1, Large ×2, Huge ×4, Gargantuan ×8. */
const sizeFactor: Record<Size, number> = { Tiny: .5, Small: 1, Medium: 1, Large: 2, Huge: 4, Gargantuan: 8 }

/** Coins by the handful: 50 of any kind weigh a pound. */
export const coinsPerPound = 50
const coin = /^(?:\d+\s*)?(?:cp|sp|ep|gp|pp|copper|silver|electrum|gold|platinum)(?:\s*(?:pieces?|coins?))?$|\bcoins?\b/i

export function isCoin(item: Pick<InventoryItem, 'name' | 'ref'>) {
  return coin.test(item.name.trim())
}

/** Pounds an item stack weighs: catalog weight × quantity, coins at 50 per pound, unknown items count as nothing. */
export function itemWeight(item: Pick<InventoryItem, 'name' | 'ref' | 'weight' | 'quantity'>) {
  const quantity = item.quantity ?? 1
  if (isCoin(item)) return quantity / coinsPerPound
  return (item.weight ?? 0) * quantity
}

export type Load = { carried: number; capacity: number; over: boolean; speed: number }

/** What a creature carries against STR × 15 lb (by size). Over the limit, Speed drops to 5 feet. */
export function carryingLoad(sheet: Pick<Sheet, 'abilities' | 'size' | 'speed' | 'inventory' | 'coins'>): Load {
  const carried = Math.round(((sheet.inventory ?? []).reduce((sum, item) => sum + itemWeight(item), 0) + coinCount(sheet.coins) / coinsPerPound) * 100) / 100
  const capacity = sheet.abilities.STR * 15 * sizeFactor[sheet.size]
  const over = carried > capacity
  return { carried, capacity, over, speed: over ? Math.min(5, sheet.speed) : sheet.speed }
}
