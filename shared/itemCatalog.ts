import type { Ability, DamageKind, InventoryItem, Sheet } from './model.ts'
import { damageKinds } from './model.ts'
import { abilityModifier } from './characterStats.ts'
import type { ArmorSettings } from './characterStats.ts'
import { itemIcon } from './catalogArt.ts'

/** One template from the SRD 5.2.1 item catalog (research/item, schema v1). */
export type CatalogItem = {
  id: string
  name: string
  kind: 'equipment' | 'magic'
  category: string
  rarity: string | null
  attunement: { required: boolean; restriction: string | null }
  price: { amount: number; currency: string; copper: number } | null
  weightLb: number | null
  weightText?: string | null
  description: string
  details: {
    training?: string; attackRange?: 'melee' | 'ranged'; damageDice?: string; damageType?: string
    mastery?: string; properties?: string[]; versatileDamageDice?: string
    acBase?: number | null; acBonus?: number | null; addsDex?: boolean; dexCap?: number | null
    minStrength?: number | null; stealthDisadvantage?: boolean
    applicability?: string | null; variants?: { label: string; rarity?: string }[]
  }
  source: { pdfPage?: number; srdUrl?: string; basicRulesUrl?: string }
}

export const categoryLabels: Record<string, string> = {
  weapon: 'อาวุธ', armor: 'เกราะ', shield: 'โล่', ammunition: 'กระสุน', adventuring_gear: 'อุปกรณ์เดินทาง',
  tool: 'เครื่องมือ', focus: 'Focus', pack: 'ชุดอุปกรณ์', vehicle: 'พาหนะ', mount: 'สัตว์พาหนะ', mount_gear: 'อุปกรณ์สัตว์พาหนะ',
  potion: 'ยา', ring: 'แหวน', rod: 'Rod', scroll: 'Scroll', staff: 'Staff', wand: 'Wand', wondrous_item: 'Wondrous Item'
}
export const rarityOrder = ['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary', 'Artifact', 'Varies'] as const

/** The catalog file: `{ schemaVersion: 1, items: [...] }`. */
export function catalogItems(document: unknown): CatalogItem[] {
  const doc = document && typeof document === 'object' ? document as { schemaVersion?: unknown; items?: unknown } : {}
  if (doc.schemaVersion !== 1 || !Array.isArray(doc.items)) throw new Error('ไฟล์คลังไอเทมไม่ใช่รูปแบบที่รองรับ')
  return (doc.items as CatalogItem[]).filter(item => item && typeof item.id === 'string' && typeof item.name === 'string')
    .sort((a, b) => a.name.localeCompare(b.name))
}

const price = (item: CatalogItem) => item.price ? item.price.amount.toLocaleString('en-US') + ' ' + item.price.currency : undefined
const weight = (item: CatalogItem) => item.weightLb !== null ? item.weightLb + ' lb.' : item.weightText ?? undefined

/** A short rules line for gear without prose: "Martial melee · 1d8 slashing · Versatile (1d10) · Mastery Sap". */
export function itemSummary(item: CatalogItem) {
  const d = item.details
  const parts = item.category === 'weapon' && d.damageDice ? [
    [d.training, d.attackRange].filter(Boolean).join(' '), d.damageDice + ' ' + d.damageType, ...(d.properties ?? []), d.mastery && 'Mastery ' + d.mastery
  ] : item.category === 'armor' && d.acBase ? [
    d.training + ' armor', 'AC ' + d.acBase + (d.addsDex ? ' + Dex' + (d.dexCap ? ' (max ' + d.dexCap + ')' : '') : ''),
    d.minStrength && 'Str ' + d.minStrength, d.stealthDisadvantage && 'Stealth Disadvantage'
  ] : item.category === 'shield' ? ['AC +' + (d.acBonus ?? 2)] : []
  return [...parts, weight(item), price(item)].filter(Boolean).join(' · ')
}

/** Grouped templates (Potion of Healing, +1/+2/+3 weapons) offer a variant to pick before making a real item. */
export function variantName(item: CatalogItem, label: string) {
  return /^[+\d]/.test(label) || label.length <= 4 ? item.name + ' (' + label + ')' : label
}

/** A real inventory item from a template: its own id later, the template kept as `ref`. Long rules text is cut and linked. */
export function inventoryFromCatalog(item: CatalogItem, options: { variant?: string; quantity?: number } = {}): Omit<InventoryItem, 'id'> {
  const variant = item.details.variants?.find(entry => entry.label === options.variant)
  const summary = itemSummary(item)
  const link = item.source.srdUrl ? '\nSRD: ' + item.source.srdUrl : ''
  let description = [summary, item.description].filter(Boolean).join('\n')
  if (description.length > 2000) description = description.slice(0, 2000 - link.length - 1).trimEnd() + '…' + link
  return {
    name: (variant ? variantName(item, variant.label) : item.name).slice(0, 120),
    description, image: itemIcon(item.id), quantity: Math.max(1, Math.min(999, options.quantity ?? 1)),
    ...(item.id === 'srd-5.2.1:equipment:thieves-tools' ? { tool: 'thievesTools' as const } : {}),
    ref: item.id, category: item.category,
    ...(variant?.rarity ?? item.rarity ? { rarity: variant?.rarity ?? item.rarity! } : {}),
    ...(item.attunement.required ? { attunement: true } : {}),
    ...(item.weightLb !== null ? { weight: item.weightLb } : {})
  }
}

/** The SRD "+1, +2, or +3" items, and which plain catalog items they are made from. */
export const magicBonusBases: Record<string, 'weapon' | 'armor' | 'shield' | 'ammunition'> = {
  'srd-5.2.1:magic:weapon-1-2-or-3': 'weapon',
  'srd-5.2.1:magic:armor-1-2-or-3': 'armor',
  'srd-5.2.1:magic:shield-1-2-or-3': 'shield',
  'srd-5.2.1:magic:ammunition-1-2-or-3': 'ammunition'
}

/** Plain catalog items a +N item can be made from: weapons, armor (not shields), the shield, or ammunition. */
export function bonusBaseChoices(catalog: CatalogItem[], kind: 'weapon' | 'armor' | 'shield' | 'ammunition') {
  return catalog.filter(item => item.kind === 'equipment' && (
    kind === 'weapon' ? item.category === 'weapon' && Boolean(item.details.damageDice)
    : kind === 'armor' ? item.category === 'armor'
    : kind === 'shield' ? item.category === 'shield'
    : item.category === 'ammunition'))
}

/**
 * "Weapon, +1" made from a Longsword → "Longsword +1": the magic item's rarity
 * and text, the base item's weight and category, with `bonus` and `base` set.
 */
export function magicFromBase(magic: Omit<InventoryItem, 'id'>, base: CatalogItem, bonus: number): Omit<InventoryItem, 'id'> {
  return { ...magic, name: (base.name + ' +' + bonus).slice(0, 120), category: base.category, bonus, base: base.id,
    ...(base.weightLb !== null ? { weight: base.weightLb } : {}) }
}

/** A sheet attack's numbers with a magic weapon's bonus added to the attack roll and the damage. */
export function withMagicBonus<T extends { bonus: number; damage: string }>(attack: T, bonus = 0): T {
  if (!bonus) return attack
  const flat = /([+-]\d+)$/.exec(attack.damage)
  const damage = flat ? attack.damage.slice(0, -flat[1].length) + signedFlat(Number(flat[1]) + bonus) : attack.damage + '+' + bonus
  return { ...attack, bonus: attack.bonus + bonus, damage }
}
const signedFlat = (value: number) => value === 0 ? '' : (value > 0 ? '+' : '') + value

/** Plain (non-magic) weapon from the catalog as a sheet attack; assumes the character is proficient with it. */
export function weaponAttack(item: CatalogItem, sheet: Pick<Sheet, 'abilities' | 'proficiency'>): NonNullable<Sheet['attacks']>[number] | undefined {
  const d = item.details
  if (item.kind !== 'equipment' || item.category !== 'weapon' || !d.damageDice) return undefined
  const finesse = d.properties?.some(property => property.startsWith('Finesse'))
  const ability: Ability = d.attackRange === 'ranged' ? 'DEX'
    : finesse && sheet.abilities.DEX > sheet.abilities.STR ? 'DEX' : 'STR'
  const modifier = abilityModifier(sheet.abilities[ability])
  const kind = (d.damageType ?? '').toLowerCase()
  return {
    name: item.name, bonus: modifier + sheet.proficiency,
    damage: d.damageDice + (modifier ? (modifier > 0 ? '+' : '') + modifier : ''),
    damageKind: Object.hasOwn(damageKinds, kind) ? kind as DamageKind : 'untyped',
    notes: [ability, ...(d.properties ?? []), d.mastery && 'Mastery ' + d.mastery].filter(Boolean).join(' · ').slice(0, 500)
  }
}

/** Wearing catalog armor or a shield: the armor part of the AC calculation, keeping whatever else was set. */
export function armorFromCatalog(item: CatalogItem, current?: ArmorSettings, magic?: number): ArmorSettings | undefined {
  const d = item.details
  const base = current ?? { base: 10, dex: 'full' as const, shield: false, bonus: 0 }
  if (item.kind !== 'equipment') return undefined
  if (item.category === 'shield') return { ...base, shield: true, shieldMagic: magic || undefined }
  if (item.category !== 'armor' || !d.acBase) return undefined
  return { ...base, base: d.acBase, dex: d.addsDex ? d.dexCap ? 'medium' : 'full' : 'none', armorMagic: magic || undefined }
}
