/**
 * Coins and shops (0.15). A purse holds the five SRD coins; prices are in
 * copper. The shop only sells at its listed price: selling to it, haggling,
 * stock and gifts are left to the table, and the purse's owner or the DM can
 * always change the numbers by hand.
 */
import type { InventoryItem } from './model.ts'

export const coinKinds = ['cp', 'sp', 'ep', 'gp', 'pp'] as const
export type CoinKind = typeof coinKinds[number]
export type Coins = Partial<Record<CoinKind, number>>
/** Each coin in copper (SRD 5.2.1 coin values). */
export const coinValue: Record<CoinKind, number> = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 }
export const coinNames: Record<CoinKind, string> = { cp: 'Copper', sp: 'Silver', ep: 'Electrum', gp: 'Gold', pp: 'Platinum' }
export const maxCoins = 10_000_000

export const coinTotal = (coins: Coins = {}) => coinKinds.reduce((sum, kind) => sum + (coins[kind] ?? 0) * coinValue[kind], 0)
export const coinCount = (coins: Coins = {}) => coinKinds.reduce((sum, kind) => sum + (coins[kind] ?? 0), 0)

/** Copper as the fewest gp / sp / cp: 150 → "1 gp 5 sp". */
export function formatCopper(copper: number) {
  if (!copper) return '0 gp'
  const parts: string[] = []
  let rest = Math.round(copper)
  for (const kind of ['gp', 'sp', 'cp'] as const) {
    const count = Math.floor(rest / coinValue[kind])
    rest -= count * coinValue[kind]
    if (count) parts.push(count.toLocaleString('en-US') + ' ' + kind)
  }
  return parts.join(' ')
}

export function formatCoins(coins: Coins = {}) {
  const parts = [...coinKinds].reverse().filter(kind => coins[kind]).map(kind => coins[kind]!.toLocaleString('en-US') + ' ' + kind)
  return parts.length ? parts.join(' · ') : 'ไม่มีเหรียญ'
}

const clean = (coins: Coins) => Object.fromEntries(coinKinds.flatMap(kind => coins[kind] ? [[kind, coins[kind]]] : [])) as Coins

/**
 * Pay `price` copper from a purse, the way a person would: small coins first,
 * then one bigger coin, with change back in the largest coins. Undefined when
 * the purse holds too little.
 */
export function pay(coins: Coins, price: number): Coins | undefined {
  if (price <= 0) return clean({ ...coins })
  if (coinTotal(coins) < price) return undefined
  const left: Record<CoinKind, number> = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }
  for (const kind of coinKinds) left[kind] = coins[kind] ?? 0
  let owed = price
  for (const kind of coinKinds) {
    const used = Math.min(left[kind], Math.floor(owed / coinValue[kind]))
    left[kind] -= used
    owed -= used * coinValue[kind]
  }
  if (owed > 0) {
    // One coin bigger than what is still owed always exists here (see the test); the shop gives change.
    const kind = coinKinds.find(entry => left[entry] > 0 && coinValue[entry] >= owed)!
    left[kind] -= 1
    let change = coinValue[kind] - owed
    for (const back of ['gp', 'sp', 'cp'] as const) {
      const count = Math.floor(change / coinValue[back])
      left[back] += count
      change -= count * coinValue[back]
    }
  }
  return clean(left)
}

const coinWords: Record<string, CoinKind> = { cp: 'cp', sp: 'sp', ep: 'ep', gp: 'gp', pp: 'pp',
  copper: 'cp', silver: 'sp', electrum: 'ep', gold: 'gp', platinum: 'pp' }

/** "50 gp", "Gold Pieces", "gp" ×20 … → the coins it stands for; undefined for anything else. */
export function coinItem(item: Pick<InventoryItem, 'name' | 'quantity'>): { kind: CoinKind; amount: number } | undefined {
  const match = /^(\d[\d,]*)?\s*(cp|sp|ep|gp|pp|copper|silver|electrum|gold|platinum)(?:\s*(?:pieces?|coins?))?$/i.exec(item.name.trim())
  if (!match) return undefined
  const each = match[1] ? Number(match[1].replace(/,/g, '')) : 1
  return { kind: coinWords[match[2].toLowerCase()], amount: each * (item.quantity ?? 1) }
}

/** Move coin items out of a bag into the purse. */
export function collectCoins(inventory: InventoryItem[] = [], coins: Coins = {}) {
  const purse = { ...coins }
  const rest = inventory.filter(item => {
    const found = coinItem(item)
    if (!found) return true
    purse[found.kind] = Math.min(maxCoins, (purse[found.kind] ?? 0) + found.amount)
    return false
  })
  return { inventory: rest, coins: clean(purse), moved: rest.length !== inventory.length }
}

/** A shop's ware: an item plus its price in copper (none: agree it with the DM). */
export type ShopItem = InventoryItem & { price?: number }
export const shopLimits = { items: 100, markup: [10, 1000] as const }

/** The price after the shop's markup (percent, 100 = as listed). */
export function shopPrice(item: Pick<ShopItem, 'price'>, markup = 100) {
  return item.price === undefined ? undefined : Math.max(0, Math.round(item.price * markup / 100))
}
