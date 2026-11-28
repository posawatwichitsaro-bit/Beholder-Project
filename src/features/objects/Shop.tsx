import { useState } from 'react'
import type { Actor, InventoryItem, SceneObject } from '../../../shared/model.ts'
import { coinKinds, coinNames, collectCoins, formatCoins, formatCopper, shopPrice } from '../../../shared/shop.ts'
import type { Coins, ShopItem } from '../../../shared/shop.ts'
import { ItemCatalogPicker, loadItemCatalog } from '../items/ItemCatalogPicker.tsx'
import { ItemName } from './Inventory.tsx'
import './shop.css'

type Send = (command: Record<string, unknown>) => Promise<boolean>
type Shop = Extract<SceneObject, { kind: 'shop' }>

/** A catalog item with its SRD price (copper), for putting in a shop. No price for most magic items. */
export async function pricedFromCatalog(item: Omit<InventoryItem, 'id'>): Promise<Omit<ShopItem, 'id'>> {
  const catalog = await loadItemCatalog()
  const copper = item.ref && !item.bonus ? catalog.find(entry => entry.id === item.ref)?.price?.copper : undefined
  return { ...item, ...(copper !== undefined ? { price: copper } : {}) }
}

/** A price typed in gold pieces (2.5 → 250 copper); blank clears it. */
const goldToCopper = (value: string) => value.trim() === '' ? null : Math.max(0, Math.round(Number(value) * 100))

/** A shop's counter (0.15): buy at the listed price. The DM opens or closes it and sets prices; anything else is up to the table. */
export function ShopCounter({ shop, actor, dm, send, perform }: {
  shop: Shop; actor?: Actor; dm: boolean; send: Send; perform: (type: string, values?: Record<string, unknown>) => Promise<boolean>
}) {
  const [amounts, setAmounts] = useState<Record<string, number>>({})
  const [adding, setAdding] = useState(false)
  const purse = actor ? collectCoins(actor.inventory, actor.coins).coins : undefined
  const markup = shop.markup ?? 100
  const shopCommand = (values: Record<string, unknown>) => send({ type: 'shop', objectId: shop.id, ...values })
  return <div className="shop-counter">
    {dm && <div className="shop-admin">
      <button aria-pressed={shop.open} onClick={() => void shopCommand({ open: !shop.open })}>{shop.open ? 'ปิดร้าน' : 'เปิดร้าน'}</button>
      <form className="inline" onSubmit={event => {
        event.preventDefault()
        void shopCommand({ markup: Number(new FormData(event.currentTarget).get('markup')) })
      }}>
        <label>ราคา (%)<input key={markup} name="markup" type="number" min={10} max={1000} step={1} defaultValue={markup} required /></label>
        <button>ตั้ง</button>
      </form>
    </div>}
    {!shop.open && !dm ? <p role="status" className="shop-closed">ร้านปิดอยู่</p> : <>
      {!shop.open && <p className="muted">ร้านปิดอยู่ · ผู้เล่นไม่เห็นสินค้า</p>}
      {actor && purse && <p className="shop-purse">ถุงเงินของ {actor.name}: <b>{formatCoins(purse)}</b></p>}
      {!shop.items.length && <p className="muted">ยังไม่มีสินค้า</p>}
      <ul className="shop-wares">{shop.items.map(ware => {
        const each = shopPrice(ware, markup)
        const amount = amounts[ware.id] ?? 1
        return <li key={ware.id}>
          <ItemName item={ware} />
          <span className="shop-price">{each === undefined ? 'ราคาตามตกลง' : formatCopper(each)}</span>
          {dm && <form className="inline" onSubmit={event => {
            event.preventDefault()
            void shopCommand({ itemId: ware.id, price: goldToCopper(String(new FormData(event.currentTarget).get('price'))) })
          }}>
            <input key={ware.price ?? 'none'} name="price" type="number" min={0} step={.01} aria-label={'ราคาตั้งต้นของ ' + ware.name + ' (gp)'}
              defaultValue={ware.price === undefined ? '' : ware.price / 100} placeholder="gp" />
            <button>ตั้งราคา</button>
            <button type="button" aria-label={'เอา ' + ware.name + ' ออกจากร้าน'} onClick={() => void shopCommand({ removeItem: ware.id })}>×</button>
          </form>}
          {actor && each !== undefined && <span className="inline">
            <input type="number" min={1} max={999} value={amount} aria-label={'จำนวน ' + ware.name}
              onChange={event => setAmounts(list => ({ ...list, [ware.id]: Math.max(1, Math.min(999, Math.floor(event.target.valueAsNumber) || 1)) }))} />
            <button className="primary" aria-label={'ซื้อ ' + ware.name} onClick={() => void perform('buy', { itemId: ware.id, quantity: amount })}>ซื้อ</button>
          </span>}
        </li>
      })}</ul>
      {dm && (adding ? <ItemCatalogPicker actionLabel="วางขายในร้าน" close={() => setAdding(false)}
        choose={async entry => shopCommand({ add: await pricedFromCatalog(entry) })} />
        : <button type="button" onClick={() => setAdding(true)}>เพิ่มสินค้าจากคลัง SRD</button>)}
      <small className="muted">ขายของคืน ต่อราคา หรือของแถม ให้ตกลงกันที่โต๊ะ แล้วแก้ถุงเงินกับ Inventory เอง</small>
    </>}
  </div>
}

/** The coin purse on an inventory (0.15): its owner or the DM types the numbers in. */
export function PurseEditor({ actor, send }: { actor: Actor; send: Send }) {
  const [editing, setEditing] = useState(false)
  const purse = collectCoins(actor.inventory, actor.coins).coins
  if (!editing) return <div className="purse">
    <span>ถุงเงิน: <b>{formatCoins(purse)}</b></span>
    <button type="button" onClick={() => setEditing(true)}>แก้ถุงเงิน</button>
  </div>
  return <form className="purse purse-form" onSubmit={async event => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const coins: Coins = Object.fromEntries(coinKinds.map(kind => [kind, Math.max(0, Math.floor(Number(form.get(kind)) || 0))]))
    if (await send({ type: 'coins', actorId: actor.id, coins })) setEditing(false)
  }}>
    {[...coinKinds].reverse().map(kind => <label key={kind} title={coinNames[kind]}>{kind}
      <input name={kind} type="number" min={0} max={10000000} defaultValue={purse[kind] ?? 0} /></label>)}
    <div className="inline"><button className="primary">บันทึก</button><button type="button" onClick={() => setEditing(false)}>ยกเลิก</button></div>
  </form>
}
