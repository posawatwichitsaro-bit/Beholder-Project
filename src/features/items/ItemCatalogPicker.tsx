import { useEffect, useMemo, useState } from 'react'
import type { InventoryItem } from '../../../shared/model.ts'
import { catalogItems, categoryLabels, inventoryFromCatalog, itemSummary, rarityOrder, variantName } from '../../../shared/itemCatalog.ts'
import type { CatalogItem } from '../../../shared/itemCatalog.ts'
import { itemIcon } from '../../../shared/catalogArt.ts'

let loading: Promise<CatalogItem[]> | undefined
/** The SRD item catalog (~570 KB), fetched once when someone first opens it. */
export function loadItemCatalog() {
  loading ??= fetch('/data/srd-items.json').then(response => {
    if (!response.ok) throw new Error('เปิดคลังไอเทมไม่สำเร็จ')
    return response.json()
  }).then(catalogItems).catch(error => { loading = undefined; throw error })
  return loading
}

const shown = 60

/**
 * Search the SRD 5.2.1 items, pick a variant and quantity, and hand back an
 * inventory item ready to send. Used wherever items are added.
 */
export function ItemCatalogPicker({ choose, close, actionLabel = 'เพิ่มลง Inventory' }: {
  choose: (item: Omit<InventoryItem, 'id'>) => Promise<boolean> | boolean | void
  close: () => void; actionLabel?: string
}) {
  const [catalog, setCatalog] = useState<CatalogItem[]>()
  const [error, setError] = useState('')
  const [attempt, retry] = useState(0)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const [category, setCategory] = useState('')
  const [rarity, setRarity] = useState('')
  const [selected, setSelected] = useState<CatalogItem>()
  const [variant, setVariant] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    setError('')
    loadItemCatalog().then(items => { if (active) setCatalog(items) }).catch(() => { if (active) setError('เปิดคลังไอเทมไม่สำเร็จ') })
    return () => { active = false }
  }, [attempt])
  const categories = useMemo(() => [...new Set((catalog ?? []).filter(item => !kind || item.kind === kind).map(item => item.category))]
    .sort((a, b) => (categoryLabels[a] ?? a).localeCompare(categoryLabels[b] ?? b)), [catalog, kind])
  const words = query.trim().toLowerCase()
  const matches = (catalog ?? []).filter(item => (!kind || item.kind === kind) && (!category || item.category === category)
    && (!rarity || item.rarity === rarity || item.details.variants?.some(entry => entry.rarity === rarity))
    && (!words || item.name.toLowerCase().includes(words) || item.details.variants?.some(entry => entry.label.toLowerCase().includes(words))))

  function open(item: CatalogItem) {
    setSelected(item)
    setVariant(item.details.variants?.[0]?.label ?? '')
    setQuantity(1)
  }
  async function add() {
    if (!selected) return
    setBusy(true)
    try {
      const ok = await choose(inventoryFromCatalog(selected, { variant: variant || undefined, quantity }))
      if (ok !== false) setSelected(undefined)
    } finally { setBusy(false) }
  }

  return <section className="item-catalog" aria-label="คลังไอเทม SRD">
    <header className="item-catalog-head"><b>คลังไอเทม SRD 5.2.1</b><button type="button" onClick={close}>ปิดคลัง</button></header>
    {selected ? <div className="item-catalog-detail">
      <button type="button" onClick={() => setSelected(undefined)}>← กลับไปยังรายการ</button>
      <h4>{itemIcon(selected.id) && <img className="catalog-item-icon" src={itemIcon(selected.id)} alt="" />} {selected.name}</h4>
      <p className="item-badges">
        <span>{categoryLabels[selected.category] ?? selected.category}</span>
        {selected.rarity && <span data-rarity={selected.rarity}>{selected.rarity}</span>}
        {selected.attunement.required && <span>Attunement{selected.attunement.restriction ? ' · ' + selected.attunement.restriction : ''}</span>}
      </p>
      {itemSummary(selected) && <p className="item-summary">{itemSummary(selected)}</p>}
      {selected.description && <p className="item-description">{selected.description}</p>}
      {selected.details.variants && <label>รุ่น<select value={variant} onChange={event => setVariant(event.target.value)}>
        {selected.details.variants.map(entry => <option key={entry.label} value={entry.label}>{variantName(selected, entry.label)}{entry.rarity ? ' · ' + entry.rarity : ''}</option>)}
      </select></label>}
      <label>จำนวน<input type="number" min={1} max={999} value={quantity} onChange={event => setQuantity(Math.max(1, Math.min(999, event.target.valueAsNumber || 1)))} /></label>
      <div className="inline">
        <button type="button" className="primary" disabled={busy} onClick={() => void add()}>{actionLabel}</button>
        {selected.source.srdUrl && <a href={selected.source.srdUrl} target="_blank" rel="noreferrer">SRD หน้า {selected.source.pdfPage} ↗</a>}
      </div>
    </div> : <>
      <label>ค้นหาไอเทม<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="เช่น Longsword, Potion, Bag" /></label>
      <div className="item-catalog-filters">
        <select aria-label="กรองชนิด" value={kind} onChange={event => { setKind(event.target.value); setCategory('') }}>
          <option value="">ทุกชนิด</option><option value="equipment">อุปกรณ์</option><option value="magic">ไอเทมเวท</option>
        </select>
        <select aria-label="กรองหมวด" value={category} onChange={event => setCategory(event.target.value)}>
          <option value="">ทุกหมวด</option>{categories.map(value => <option key={value} value={value}>{categoryLabels[value] ?? value}</option>)}
        </select>
        <select aria-label="กรอง Rarity" value={rarity} onChange={event => setRarity(event.target.value)}>
          <option value="">ทุก Rarity</option>{rarityOrder.filter(value => value !== 'Varies').map(value => <option key={value}>{value}</option>)}
        </select>
      </div>
      {error ? <p role="alert">{error} <button type="button" onClick={() => retry(attempt + 1)}>ลองอีกครั้ง</button></p>
        : !catalog ? <p className="muted">กำลังเปิดคลัง…</p>
        : <small className="muted">{matches.length > shown ? 'แสดง ' + shown + ' จาก ' + matches.length + ' รายการ · พิมพ์เพื่อค้นให้แคบลง' : matches.length + ' รายการ'}</small>}
      <ul className="item-catalog-list">{matches.slice(0, shown).map(item => <li key={item.id}>
        <button type="button" onClick={() => open(item)}>
          <b>{itemIcon(item.id) && <img className="catalog-item-icon" src={itemIcon(item.id)} alt="" loading="lazy" />} {item.name}</b>
          <small>{[categoryLabels[item.category] ?? item.category, item.rarity, item.attunement.required && 'Attunement'].filter(Boolean).join(' · ')}</small>
        </button>
      </li>)}</ul>
    </>}
    <footer><a href="/data/SRD-LICENSE.txt" target="_blank" rel="noreferrer">SRD 5.2.1 · CC BY 4.0</a>
      {' · '}<a href="/art/srd/inventory/CREDITS.md" target="_blank" rel="noreferrer">เครดิตภาพไอเทม</a></footer>
  </section>
}
