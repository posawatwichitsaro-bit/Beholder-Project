import { useEffect, useState } from 'react'
import { abilities, blankSheet, damageKinds } from '../shared/model.ts'
import type { Sheet, Size, Ability, DamageKind } from '../shared/model.ts'
import { monsterSheet, parseMonsterText } from '../shared/monsterManual.ts'

type Monster = {
  name: string; size: Size; type: string; cr: string; ac: number; hp: number; speed: number; initiative: number
  abilities: Record<Ability, number>; statBlock: string; page?: number; customSheet?: Sheet
}

function asSheet(m: Monster): Sheet {
  if (m.customSheet) return m.customSheet
  const sheet = blankSheet('monster')
  const attacks: NonNullable<Sheet['attacks']> = []
  const blocks = m.statBlock.split('\n')
  for (let index = 0; index < blocks.length; index++) {
    const line = blocks[index]
    const title = line.match(/^([^.!?]{1,90})\.\s+(?:Melee|Ranged)[\s\S]*?Attack Roll:/i)
    if (!title) continue
    const hit = (line + ' ' + (blocks[index + 1] ?? '')).replace(/−/g, '-').match(/Attack Roll:\s*([+-]?\d+).*?Hit:\s*(\d+)(?:\s*\((\d+d\d+(?:\s*[+-]\s*\d+)?)\))?\s+([a-z]+) damage/i)
    if (!hit) continue
    const kind = hit[4].toLowerCase()
    attacks.push({ name: title[1], bonus: +hit[1], damage: (hit[3] ?? hit[2]).replace(/\s/g, ''), damageKind: Object.hasOwn(damageKinds, kind) ? kind as DamageKind : 'untyped' })
  }
  return { ...sheet, name: m.name, size: m.size, abilities: { ...m.abilities }, hp: m.hp, maxHp: m.hp, ac: m.ac, speed: m.speed,
    initiative: m.initiative, classLevel: m.type + ' · CR ' + m.cr, proficiency: Number(m.statBlock.match(/PB\s*\+(\d+)/)?.[1] ?? 2),
    attack: attacks[0]?.bonus ?? 0, damage: attacks[0]?.damage ?? '0', attacks,
    monsterReference: { page: m.page, statBlock: m.statBlock } }
}

const source = 'https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf'
function crValue(cr: string) {
  const [top, bottom] = cr.split('/').map(Number)
  return top / (bottom ?? 1)
}
export function MonsterManual({ addTemplate, placeMonster }: {
  addTemplate: (sheet: Sheet) => Promise<boolean>; placeMonster?: (sheet: Sheet) => void
}) {
  const [catalog, setCatalog] = useState<Monster[]>([])
  const [query, setQuery] = useState('')
  const [cr, setCr] = useState('')
  const [selected, setSelected] = useState<Monster>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, retry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [draft, setDraft] = useState('')
  const [importError, setImportError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    fetch('/data/srd-monsters.json', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw Error()
      const entries: Monster[] = await response.json()
      if (!controller.signal.aborted) setCatalog(entries.sort((a,b) => a.name.localeCompare(b.name)))
    }).catch(() => { if (!controller.signal.aborted) setError('เปิดคู่มือไม่สำเร็จ') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [attempt])
  const matches = catalog.filter(m => (!cr || m.cr === cr) && (m.name + ' ' + m.type).toLowerCase().includes(query.trim().toLowerCase()))
  return <section className="manual">
    {selected ? <>
      <button onClick={() => setSelected(undefined)}>← กลับไปยังรายการ</button>
      <header><small>{selected.size} · {selected.type}</small><h2>{selected.name}</h2></header>
      <div className="manual-stats">{[['CR',selected.cr],['AC',selected.ac],['HP',selected.hp]].map(([key,val]) => <div key={key}><small>{key}</small><b>{val}</b></div>)}</div>
      <div className="inline">{placeMonster && <button className="primary" onClick={() => placeMonster(asSheet(selected))}>วางมอนสเตอร์ในฉาก</button>}
        <button disabled={busy || saved} onClick={async () => {
          setBusy(true)
          try { setSaved(await addTemplate(asSheet(selected))) } finally { setBusy(false) }
        }}>{saved ? 'เพิ่มต้นแบบแล้ว' : 'เพิ่มเป็นต้นแบบในห้อง'}</button></div>
      <div className="manual-abilities">{abilities.map(key => <span key={key}>{key} <b>{selected.abilities[key]}</b></span>)}</div>
      <p className="stat-block">{selected.statBlock}</p>
      {selected.page && <a target="_blank" rel="noreferrer" href={source + '#page=' + selected.page}>เปิด SRD หน้า {selected.page} ↗</a>}
    </> : <>
      <header><small>SRD 5.2.1</small><h2>Monster Manual</h2></header>
      <details><summary>นำเข้า Stat Block ของคุณ</summary>
        <label>วางข้อความจากชีตมอนสเตอร์หรือ JSON<textarea rows={7} value={draft} maxLength={32000} onChange={e => setDraft(e.target.value)} /></label>
        <button disabled={!draft.trim()} onClick={() => {
          try { const entry = parseMonsterText(draft); setSelected({ ...entry, customSheet: monsterSheet(entry) }); setSaved(false); setImportError('') }
          catch (e) { setImportError((e as Error).message) }
        }}>ตรวจข้อมูลก่อนนำเข้า</button>{importError && <p role="alert">{importError}</p>}
      </details>
      <div className="manual-filters"><label>ค้นหาชื่อหรือประเภท<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="เช่น Goblin หรือ Beast" /></label>
      <label>CR<select value={cr} onChange={e => setCr(e.target.value)}><option value="">ทั้งหมด</option>{[...new Set(catalog.map(m => m.cr))].sort((a,b) => crValue(a)-crValue(b)).map(v => <option key={v}>{v}</option>)}</select></label></div>
      {loading ? <p>กำลังเปิดคู่มือ…</p> : error ? <p role="alert">{error} <button onClick={() => retry(attempt+1)}>ลองอีกครั้ง</button></p> : <small>{matches.length} รายการ</small>}
      <div className="manual-list">{matches.map(m => <button key={m.name} onClick={() => { setSelected(m); setSaved(false) }}>
        <span><b>{m.name}</b><small>{m.type}</small></span><span>CR {m.cr}</span></button>)}</div>
    </>}
    <footer><a href="/data/SRD-LICENSE.txt" target="_blank" rel="noreferrer">SRD 5.2.1 · CC BY 4.0</a> · <a href="https://www.dndbeyond.com/sources/dnd/mm-2024" target="_blank" rel="noreferrer">Monster Manual บน D&amp;D Beyond ↗</a></footer>
  </section>
}
