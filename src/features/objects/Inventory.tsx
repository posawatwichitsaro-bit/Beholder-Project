import { useState } from 'react'
import type { Actor, InventoryItem, LootSkill, Snapshot } from '../../../shared/model.ts'
import { commandId } from '../../lib/api.ts'
import { armorFromCatalog, weaponAttack } from '../../../shared/itemCatalog.ts'
import { ItemCatalogPicker, loadItemCatalog } from '../items/ItemCatalogPicker.tsx'

type Send = (command: Record<string, unknown>) => Promise<boolean>

export function ItemFields({ item, update, monster }: { item: InventoryItem; update: (item: InventoryItem) => void; monster: boolean }) {
  return <div className="item-fields">
    <label>ชื่อไอเทม<input required maxLength={120} value={item.name} onChange={event => update({ ...item, name: event.target.value })} /></label>
    <label>จำนวน<input required type="number" min={1} max={999} value={item.quantity ?? 1}
      onChange={event => update({ ...item, quantity: event.target.valueAsNumber })} /></label>
    <label>รายละเอียด<input maxLength={2000} value={item.description} onChange={event => update({ ...item, description: event.target.value })} /></label>
    <label>ประเภท<select value={item.tool ?? ''} onChange={event => update({ ...item, tool: event.target.value ? 'thievesTools' : undefined })}>
      <option value="">ทั่วไป</option><option value="thievesTools">Thieves’ Tools</option>
    </select></label>
    {monster && <label>รางวัล<select value={item.lootTier ?? 'basic'}
      onChange={event => update({ ...item, lootTier: event.target.value as 'basic' | 'bonus' })}>
      <option value="basic">พื้นฐาน</option><option value="bonus">โบนัสเมื่อผ่าน DC</option>
    </select></label>}
  </div>
}

export const blankItem = (bonus = false): InventoryItem => ({
  id: commandId(), name: '', quantity: 1, description: '', lootTier: bonus ? 'bonus' : 'basic'
})

/** Catalog items start with a one-line rules summary; the list shows just that line. */
const firstLine = (text: string) => text.split(/\r?\n/)[0]

export function ItemName({ item, loot = false }: { item: InventoryItem; loot?: boolean }) {
  return <div className="item-name">
    <span className={loot && item.lootTier === 'bonus' ? 'bonus-loot' : undefined}>{item.name}{(item.quantity ?? 1) > 1 && ' ×' + item.quantity}</span>
    {(item.rarity || item.attunement) && <span className="item-badges">
      {item.rarity && <span data-rarity={item.rarity}>{item.rarity}</span>}{item.attunement && <span>Attunement</span>}
    </span>}
    {(item.description || item.tool || loot) && <small>{[
      loot && (item.lootTier === 'bonus' ? 'โบนัส' : 'พื้นฐาน'), item.tool && 'Thieves’ Tools', firstLine(item.description)
    ].filter(Boolean).join(' · ')}</small>}
  </div>
}

/** An actor's items. `expanded` shows the list directly (sheet tab) instead of a folded section. */
export function InventoryPanel({ actor, send, expanded = false }: { actor: Actor; send: Send; expanded?: boolean }) {
  const [draft, setDraft] = useState<InventoryItem>()
  const [remove, setRemove] = useState<string>()
  const [browsing, setBrowsing] = useState(false)
  const [equipError, setEquipError] = useState('')
  const monster = actor.kind === 'monster'
  const items = actor.inventory ?? []
  const Wrapper = expanded ? 'section' : 'details'
  const Title = expanded ? 'h3' : 'summary'
  /** Turn a catalog weapon into a sheet attack, or wear catalog armor / a shield, through the normal sheet update. */
  async function equip(item: InventoryItem, as: 'attack' | 'armor') {
    setEquipError('')
    try {
      const template = (await loadItemCatalog()).find(entry => entry.id === item.ref)
      if (!template) throw new Error('ไม่พบไอเทมนี้ในคลัง SRD')
      const { id: _id, ownerId: _owner, templateId: _template, lootResult: _loot, ...sheet } = actor
      if (as === 'attack') {
        const attack = weaponAttack(template, actor)
        if (!attack) throw new Error('ไอเทมนี้ใช้เป็นการโจมตีไม่ได้')
        await send({ type: 'sheet', actorId: actor.id, sheet: { ...sheet, attacks: [...(actor.attacks ?? []), { ...attack, name: item.name }] } })
      } else {
        const armor = armorFromCatalog(template, actor.calculations?.armor)
        if (!armor) throw new Error('ไอเทมนี้สวมใส่ไม่ได้')
        await send({ type: 'sheet', actorId: actor.id, sheet: { ...sheet, calculations: { ...actor.calculations, armor } } })
      }
    } catch (error) { setEquipError((error as Error).message) }
  }
  return <Wrapper className={'inventory' + (expanded ? ' inventory-expanded' : '')}><Title>Inventory ({items.length})</Title>
    {items.length ? <ul>{items.map(item => <li key={item.id}>
      {item.image && <img src={item.image} alt="" />}<ItemName item={item} loot={monster} />
      {!monster && item.ref?.includes(':equipment:') && item.category === 'weapon' && <button type="button"
        disabled={actor.attacks?.some(attack => attack.name === item.name)} title="เพิ่มเป็นการโจมตีบนชีต (คิด Proficiency ให้แล้ว)"
        onClick={() => void equip(item, 'attack')}>{actor.attacks?.some(attack => attack.name === item.name) ? 'อยู่ในการโจมตีแล้ว' : 'ใช้เป็นการโจมตี'}</button>}
      {!monster && item.ref?.includes(':equipment:') && (item.category === 'armor' || item.category === 'shield') && <button type="button"
        title="คำนวณ AC จากชิ้นนี้" onClick={() => void equip(item, 'armor')}>{item.category === 'shield' ? 'ถือโล่' : 'สวมใส่'}</button>}
      {remove === item.id ? <><button onClick={() => void send({ type: 'inventoryRemove', actorId: actor.id, itemId: item.id }).then(ok => {
        if (ok) setRemove(undefined)
      })}>ยืนยันนำออก</button><button onClick={() => setRemove(undefined)}>ยกเลิก</button></>
        : <button className="remove-item" aria-label={'นำ ' + item.name + ' ออก'} onClick={() => setRemove(item.id)}>×</button>}
    </li>)}</ul> : <p className="muted">ยังไม่มีไอเทม</p>}
    {draft ? <form className="inventory-form" onSubmit={async event => {
      event.preventDefault()
      if (await send({ type: 'inventoryAdd', actorId: actor.id, item: draft })) setDraft(undefined)
    }}>
      <ItemFields item={draft} update={setDraft} monster={monster} />
      <div className="inline"><button className="primary">เก็บใน Inventory</button><button type="button" onClick={() => setDraft(undefined)}>ยกเลิก</button></div>
    </form> : browsing ? <ItemCatalogPicker close={() => setBrowsing(false)}
      choose={item => send({ type: 'inventoryAdd', actorId: actor.id, item: { ...item, lootTier: monster && items.length > 0 ? 'bonus' : 'basic' } })} />
      : !actor.lootResult && <div className="inline">
        <button onClick={() => setDraft(blankItem(monster && items.length > 0))}>+ ไอเทม</button>
        <button onClick={() => setBrowsing(true)}>เลือกจากคลัง SRD</button>
      </div>}
    {equipError && <p role="alert">{equipError}</p>}
  </Wrapper>
}

export function LootSettingsFields({ dc, skill, changeDc, changeSkill }: {
  dc?: number; skill?: LootSkill; changeDc: (dc: number) => void; changeSkill: (skill: LootSkill) => void
}) {
  return <div className="form-grid">
    <label>DC ค้นศพ<input type="number" min={1} max={30} required value={dc ?? 12} onChange={event => changeDc(event.target.valueAsNumber)} /></label>
    <label>ทักษะค้นหา<select value={skill ?? 'investigation'} onChange={event => changeSkill(event.target.value as LootSkill)}>
      <option value="investigation">INT · Investigation</option><option value="perception">WIS · Perception</option>
    </select></label>
  </div>
}

export function LootDialog({ monster, stats, characters, sceneActive, dm, send, close }: {
  monster: Snapshot['publicActors'][number]; stats?: Actor; characters: Actor[]; sceneActive: boolean; dm: boolean; send: Send; close: () => void
}) {
  const [chosen, setChosen] = useState('')
  const [dc, setDc] = useState(stats?.lootDc ?? 12)
  const [skill, setSkill] = useState<LootSkill>(stats?.lootSkill ?? 'investigation')
  const searcher = characters.find(character => character.id === chosen) ?? characters[0]
  const result = monster.lootResult
  return <div className="scrim"><section className="dialog compact" role="dialog" aria-label={'ค้นศพ ' + monster.name}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
    <header><h2>ค้นศพ · {monster.name}</h2><button aria-label="ปิด" onClick={close}>×</button></header>
    {result ? <div className="loot-result" role="status">
      <strong>{result.passed ? 'ค้นพบของครบ' : 'ได้เฉพาะของพื้นฐาน'} · ผลทอย {result.total}</strong>
      <p>ผู้ค้น {result.searcher}</p>
      {result.found.length ? <ul>{result.found.map((item, index) => <li key={index}>{item.name} ×{item.quantity}</li>)}</ul> : <p>ไม่พบไอเทม</p>}
    </div> : <>
      {dm && stats && <>
        <form onSubmit={event => {
          event.preventDefault()
          void send({ type: 'lootSettings', actorId: monster.id, dc, skill })
        }}>
          <LootSettingsFields dc={dc} skill={skill} changeDc={setDc} changeSkill={setSkill} />
          <button>บันทึก DC และทักษะ</button>
        </form>
        <InventoryPanel actor={stats} send={send} />
      </>}
      <p className="muted">ให้ตัวละครยืนติดศพ ผ่านจะได้ของพื้นฐานและโบนัส พลาดจะได้ของพื้นฐาน</p>
      {characters.length > 0 && <label>ตัวละครที่จะค้น<select value={searcher?.id ?? ''} onChange={event => setChosen(event.target.value)}>
        {characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
      </select></label>}
      <button className="primary" disabled={!sceneActive || !searcher} onClick={() => void send({
        type: 'searchLoot', actorId: monster.id, searcherId: searcher?.id
      })}>ทอยค้นหาและรับ Loot</button>
    </>}
  </section></div>
}
