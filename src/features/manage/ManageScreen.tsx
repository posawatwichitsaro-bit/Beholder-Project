import { useEffect, useMemo, useState } from 'react'
import { Boxes, Map as MapIcon, Package, Search, Users, X } from 'lucide-react'
import type { Actor, Scene, Snapshot } from '../../../shared/model.ts'
import { parseConditions } from '../../../shared/conditions.ts'
import type { Command } from '../../state/useCommand.ts'
import { Button, HpBar } from '../../ui/index.ts'

type Section = 'tokens' | 'items' | 'scenes'
type TokenRow = { key: string; scene: Scene; tokenId: string; actor: Actor }
type ItemRow = { key: string; name: string; quantity: number; holder: string; kind: string; description: string; actorId?: string; itemId: string }

/**
 * "ห้องเก็บของ DM": everything at the table in sortable lists — tokens across
 * every scene, items wherever they are, and the scenes themselves — with a
 * filter, multi-select for bulk removal, and an inspector for the selected row.
 * Running the game stays on the board; this is for tidying up between scenes.
 */
export function ManageScreen({ room, send, close, openSheet, goTo, viewScene, copyScene, deleteScene }: {
  room: Snapshot; send: (command: Command) => Promise<boolean>; close: () => void
  openSheet: (actor: Actor) => void; goTo: (sceneId: string, actorId: string) => void; viewScene: (sceneId: string) => void
  copyScene: (scene: Scene) => void; deleteScene: (scene: Scene) => void
}) {
  const [section, setSection] = useState<Section>('tokens')
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState<string>()
  const [checked, setChecked] = useState<string[]>([])
  useEffect(() => {
    function key(event: KeyboardEvent) {
      // A dialog opened from here (copy / delete scene) sits on top and takes Escape first.
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelectorAll('.scrim').length > 1) return
      event.preventDefault()
      close()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [close])
  useEffect(() => { setFilter('all'); setCurrent(undefined); setChecked([]); setQuery('') }, [section])

  const tokens: TokenRow[] = useMemo(() => room.scenes.flatMap(scene => scene.tokens.flatMap(token => {
    const actor = room.actors.find(item => item.id === token.actorId)
    return actor ? [{ key: token.id, scene, tokenId: token.id, actor }] : []
  })), [room.scenes, room.actors])
  const items: ItemRow[] = useMemo(() => [
    ...room.actors.flatMap(actor => (actor.inventory ?? []).map(item => ({
      key: actor.id + ':' + item.id, name: item.name, quantity: item.quantity ?? 1, holder: actor.name,
      kind: actor.kind === 'monster' ? 'Loot มอนสเตอร์' : 'อยู่กับผู้เล่น', description: item.description, actorId: actor.id, itemId: item.id
    }))),
    ...room.scenes.flatMap(scene => (scene.objects ?? []).flatMap(object => object.kind === 'container' ? object.items.map(item => ({
      key: object.id + ':' + item.id, name: item.name, quantity: item.quantity ?? 1, holder: object.name + ' · ' + scene.name,
      kind: 'ในกล่อง', description: item.description, itemId: item.id
    })) : []))
  ], [room.actors, room.scenes])

  const matches = (text: string) => !query.trim() || text.toLowerCase().includes(query.trim().toLowerCase())
  const owner = (actor: Actor) => actor.kind === 'monster' ? 'Monster' : 'PC · ' + (room.members.find(member => member.id === actor.ownerId)?.name ?? '—')
  const shownTokens = tokens.filter(row => (filter === 'all' || row.scene.id === filter) && matches(row.actor.name + ' ' + row.scene.name))
  const shownItems = items.filter(row => (filter === 'all' || row.kind === filter) && matches(row.name + ' ' + row.holder))
  const shownScenes = room.scenes.filter(scene => matches(scene.name))
  const toggle = (key: string) => setChecked(list => list.includes(key) ? list.filter(entry => entry !== key) : [...list, key])

  async function removeChecked() {
    for (const row of tokens.filter(entry => checked.includes(entry.key))) {
      await send({ type: 'removeToken', sceneId: row.scene.id, tokenId: row.tokenId })
    }
    setChecked([])
  }

  const sections: [Section, string, typeof Users, number][] = [
    ['tokens', 'Token ในเรื่อง', Users, tokens.length], ['items', 'Item และ Loot', Package, items.length], ['scenes', 'ฉากในเรื่อง', MapIcon, room.scenes.length]
  ]
  const chips = section === 'tokens' ? [['all', 'ทุกฉาก'], ...room.scenes.map(scene => [scene.id, scene.name])]
    : section === 'items' ? [['all', 'ทั้งหมด'], ['อยู่กับผู้เล่น', 'อยู่กับผู้เล่น'], ['ในกล่อง', 'ในกล่อง'], ['Loot มอนสเตอร์', 'Loot มอนสเตอร์']] : []
  const tokenRow = shownTokens.find(row => row.key === current) ?? (section === 'tokens' ? shownTokens[0] : undefined)
  const itemRow = shownItems.find(row => row.key === current) ?? (section === 'items' ? shownItems[0] : undefined)
  const sceneRow = shownScenes.find(scene => scene.id === current) ?? (section === 'scenes' ? shownScenes[0] : undefined)

  return <div className="manage scrim" role="dialog" aria-modal="true" aria-label="ห้องเก็บของ DM">
    <header className="manage-top">
      <Boxes size={20} aria-hidden="true" />
      <div className="manage-title"><span>{room.name}</span><h2>ห้องเก็บของ DM</h2></div>
      <label className="manage-search"><Search size={15} aria-hidden="true" />
        <input type="search" aria-label="ค้นหาในหมวดนี้" placeholder="ค้นหาชื่อหรือฉาก" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button type="button" className="manage-close" aria-label="ปิดห้องเก็บของ" onClick={close}><X size={18} aria-hidden="true" /></button>
    </header>
    <nav className="manage-sections" aria-label="หมวด">
      {sections.map(([id, label, Icon, count]) => <button key={id} type="button" aria-pressed={section === id} onClick={() => setSection(id)}>
        <Icon size={16} aria-hidden="true" /><span>{label}</span><b>{count}</b></button>)}
    </nav>
    <main className="manage-main">
      {chips.length > 0 && <div className="manage-chips" role="group" aria-label="ตัวกรอง">
        {chips.map(([id, label]) => <button key={id} type="button" className="bh-chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
      </div>}
      {section === 'tokens' && checked.length > 0 && <div className="manage-bulk" role="toolbar" aria-label="คำสั่งกับรายการที่เลือก">
        <b>เลือก {checked.length} รายการ</b>
        <button type="button" className="danger" onClick={() => void removeChecked()}>นำออกจากฉาก</button>
        <button type="button" onClick={() => setChecked([])}>ยกเลิกการเลือก</button>
      </div>}
      <div className="manage-table-box">
        {section === 'tokens' && <table className="manage-table">
          <thead><tr><th scope="col" className="manage-check"><span className="bh-visually-hidden">เลือก</span></th><th scope="col">ชื่อ</th><th scope="col">ประเภท</th><th scope="col">ฉาก</th><th scope="col">HP</th><th scope="col">AC</th><th scope="col">Condition</th></tr></thead>
          <tbody>{shownTokens.map(row => <tr key={row.key} aria-selected={tokenRow?.key === row.key} onClick={() => setCurrent(row.key)}>
            <td><input type="checkbox" aria-label={'เลือก ' + row.actor.name + ' ใน ' + row.scene.name} checked={checked.includes(row.key)} onClick={event => event.stopPropagation()} onChange={() => toggle(row.key)} /></td>
            <td><b>{row.actor.name}</b></td><td>{owner(row.actor)}</td><td>{row.scene.name}{row.scene.id === room.activeSceneId && <small> · เปิดอยู่</small>}</td>
            <td>{row.actor.hp}/{row.actor.maxHp}</td><td>{row.actor.ac}</td><td>{parseConditions(row.actor.conditions).map(item => item.name).join(', ')}</td>
          </tr>)}</tbody>
        </table>}
        {section === 'items' && <table className="manage-table">
          <thead><tr><th scope="col">ชื่อ</th><th scope="col">จำนวน</th><th scope="col">อยู่กับ</th><th scope="col">ชนิด</th></tr></thead>
          <tbody>{shownItems.map(row => <tr key={row.key} aria-selected={itemRow?.key === row.key} onClick={() => setCurrent(row.key)}>
            <td><b>{row.name}</b></td><td>{row.quantity}</td><td>{row.holder}</td><td>{row.kind}</td>
          </tr>)}</tbody>
        </table>}
        {section === 'scenes' && <table className="manage-table">
          <thead><tr><th scope="col">ชื่อ</th><th scope="col">สถานะ</th><th scope="col">Grid</th><th scope="col">Token</th><th scope="col">Object</th></tr></thead>
          <tbody>{shownScenes.map(scene => <tr key={scene.id} aria-selected={sceneRow?.id === scene.id} onClick={() => setCurrent(scene.id)}>
            <td><b>{scene.name}</b></td><td>{scene.id === room.activeSceneId ? 'ผู้เล่นเห็นอยู่' : 'กำลังเตรียม'}</td>
            <td>{scene.cell}px</td><td>{scene.tokens.length}</td><td>{scene.objects?.length ?? 0}</td>
          </tr>)}</tbody>
        </table>}
        {((section === 'tokens' && !shownTokens.length) || (section === 'items' && !shownItems.length) || (section === 'scenes' && !shownScenes.length)) &&
          <p className="manage-empty">ไม่มีรายการ{query ? 'ที่ตรงกับ “' + query + '”' : 'ในหมวดนี้'}</p>}
      </div>
    </main>
    <aside className="manage-inspector bh-on-parchment" aria-label="รายละเอียด">
      {section === 'tokens' && tokenRow && <>
        <h3>{tokenRow.actor.name}</h3>
        <p className="manage-sub">{owner(tokenRow.actor)} · {tokenRow.scene.name}</p>
        <HpBar hp={tokenRow.actor.hp} max={tokenRow.actor.maxHp} temp={tokenRow.actor.tempHp} side={tokenRow.actor.kind === 'monster' ? 'foe' : 'ally'} label={'HP ของ ' + tokenRow.actor.name} surface="parchment" height={10} />
        <dl className="manage-facts"><div><dt>HP</dt><dd>{tokenRow.actor.hp}/{tokenRow.actor.maxHp}</dd></div><div><dt>AC</dt><dd>{tokenRow.actor.ac}</dd></div><div><dt>Speed</dt><dd>{tokenRow.actor.speed}</dd></div></dl>
        <div className="manage-actions">
          <Button variant="primary" onClick={() => goTo(tokenRow.scene.id, tokenRow.actor.id)}>ไปที่ Token</Button>
          <Button onClick={() => openSheet(tokenRow.actor)}>แก้ชีต</Button>
          <Button variant="danger" onClick={() => void send({ type: 'removeToken', sceneId: tokenRow.scene.id, tokenId: tokenRow.tokenId })}>นำออกจากฉาก</Button>
        </div>
      </>}
      {section === 'items' && itemRow && <>
        <h3>{itemRow.name}</h3>
        <p className="manage-sub">{itemRow.quantity} ชิ้น · {itemRow.holder}</p>
        {itemRow.description && <p>{itemRow.description}</p>}
        {itemRow.actorId && <div className="manage-actions"><Button variant="danger"
          onClick={() => void send({ type: 'inventoryRemove', actorId: itemRow.actorId, itemId: itemRow.itemId })}>นำไอเทมออก</Button></div>}
        {!itemRow.actorId && <p className="manage-sub">จัดการของในกล่องได้จากการ “โต้ตอบกับ Object” บนกระดาน</p>}
      </>}
      {section === 'scenes' && sceneRow && <>
        <h3>{sceneRow.name}</h3>
        <p className="manage-sub">{sceneRow.id === room.activeSceneId ? 'ผู้เล่นเห็นฉากนี้อยู่' : 'กำลังเตรียม · ผู้เล่นยังไม่เห็น'}</p>
        <dl className="manage-facts"><div><dt>Grid</dt><dd>{sceneRow.cell}px</dd></div><div><dt>Token</dt><dd>{sceneRow.tokens.length}</dd></div><div><dt>Object</dt><dd>{sceneRow.objects?.length ?? 0}</dd></div></dl>
        <div className="manage-actions">
          <Button variant="primary" onClick={() => viewScene(sceneRow.id)}>ดูฉากนี้</Button>
          {sceneRow.id !== room.activeSceneId && <Button onClick={() => void send({ type: 'activate', sceneId: sceneRow.id })}>เปิดให้ผู้เล่น</Button>}
          <Button onClick={() => copyScene(sceneRow)}>ทำสำเนา</Button>
          <Button variant="danger" onClick={() => deleteScene(sceneRow)}>ลบ</Button>
        </div>
      </>}
      {((section === 'tokens' && !tokenRow) || (section === 'items' && !itemRow) || (section === 'scenes' && !sceneRow)) && <p className="manage-sub">เลือกแถวเพื่อดูรายละเอียด</p>}
    </aside>
  </div>
}
