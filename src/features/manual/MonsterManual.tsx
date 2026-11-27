import { useEffect, useMemo, useState } from 'react'
import { abilities } from '../../../shared/model.ts'
import type { Sheet } from '../../../shared/model.ts'
import { abilityModifier } from '../../../shared/characterStats.ts'
import type { TokenDragProps } from '../board/tokenDrag.ts'
import { catalogMonsters, crNumber, detailLabels, monsterSheet, parseMonsterText } from '../../../shared/monsterManual.ts'
import type { ManualMonster } from '../../../shared/monsterManual.ts'
import { damageKinds } from '../../../shared/model.ts'

type Entry = ManualMonster & { customSheet?: Sheet }

const source = 'https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf'
const signed = (value: number) => (value < 0 ? '−' + Math.abs(value) : '+' + value)
/** "Fey (Goblinoid)" → "Fey", "Swarm of Tiny Beasts" → "Swarm". */
const family = (type: string) => type.split(/[\s(]/)[0]

export function MonsterManual({ addTemplate, placeMonster, dragMonster }: {
  addTemplate: (sheet: Sheet) => Promise<boolean>; placeMonster?: (sheet: Sheet) => void
  /** Drag props so the monster can be dropped straight onto the board. */
  dragMonster?: (sheet: Sheet) => TokenDragProps
}) {
  const [catalog, setCatalog] = useState<Entry[]>([])
  const [query, setQuery] = useState('')
  const [cr, setCr] = useState('')
  const [type, setType] = useState('')
  const [selected, setSelected] = useState<Entry>()
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
      const entries = catalogMonsters(await response.json())
      if (!controller.signal.aborted) setCatalog(entries)
    }).catch(() => { if (!controller.signal.aborted) setError('เปิดคู่มือไม่สำเร็จ') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [attempt])
  const crs = useMemo(() => [...new Set(catalog.map(m => m.cr))].sort((a, b) => crNumber(a) - crNumber(b)), [catalog])
  const types = useMemo(() => [...new Set(catalog.map(m => family(m.type)))].sort(), [catalog])
  const words = query.trim().toLowerCase()
  const matches = catalog.filter(m => (!cr || m.cr === cr) && (!type || family(m.type) === type) && (m.name + ' ' + m.type).toLowerCase().includes(words))
  const sheet = selected && (selected.customSheet ?? monsterSheet(selected))

  return <section className="manual">
    {selected && sheet ? <>
      <button onClick={() => setSelected(undefined)}>← กลับไปยังรายการ</button>
      <header><small>{selected.size} · {selected.type}{selected.alignment ? ' · ' + selected.alignment : ''}</small><h2>{selected.name}</h2>
        {sheet.portrait && <img className="manual-monster-art" src={sheet.portrait} alt={selected.name} />}
      </header>
      <div className="manual-stats">{[['CR', selected.cr], ['AC', selected.ac], ['HP', selected.hp],
        ['Initiative', signed(selected.initiative)]].map(([key, value]) => <div key={key}><small>{key}</small><b>{value}</b></div>)}</div>
      <div className="inline">{placeMonster && <button className="primary" {...dragMonster?.(sheet)} onClick={() => placeMonster(sheet)}>วางมอนสเตอร์ในฉาก</button>}
        <button disabled={busy || saved} onClick={async () => {
          setBusy(true)
          try { setSaved(await addTemplate(sheet)) } finally { setBusy(false) }
        }}>{saved ? 'เพิ่มต้นแบบแล้ว' : 'เพิ่มเป็นต้นแบบในห้อง'}</button></div>
      <table className="manual-abilities" aria-label="ค่าความสามารถ">
        <thead><tr><th scope="col"></th>{abilities.map(key => <th key={key} scope="col">{key}</th>)}</tr></thead>
        <tbody>
          <tr><th scope="row">ค่า</th>{abilities.map(key => <td key={key}>{selected.abilities[key]}</td>)}</tr>
          <tr><th scope="row">Mod</th>{abilities.map(key => <td key={key}>{signed(abilityModifier(selected.abilities[key]))}</td>)}</tr>
          {selected.savingThrows && <tr><th scope="row">Save</th>{abilities.map(key => {
            const value = selected.savingThrows?.[key] ?? abilityModifier(selected.abilities[key])
            return <td key={key} data-trained={value !== abilityModifier(selected.abilities[key]) || undefined}>{signed(value)}</td>
          })}</tr>}
        </tbody>
      </table>
      <dl className="manual-details">
        <div><dt>Speed</dt><dd>{selected.movement ?? selected.speed + ' ft.'}</dd></div>
        {selected.hitDice && <div><dt>Hit Dice</dt><dd>{selected.hitDice}</dd></div>}
        {(Object.keys(detailLabels) as (keyof typeof detailLabels)[]).map(key => selected.details?.[key]
          ? <div key={key}><dt>{detailLabels[key]}</dt><dd>{selected.details[key]}</dd></div> : null)}
      </dl>
      {sheet.attacks && sheet.attacks.length > 0 && <section className="manual-attacks" aria-label="การโจมตีที่ทอยได้">
        <h3>การโจมตีที่ทอยได้</h3>
        <ul>{sheet.attacks.map(attack => <li key={attack.name}><b>{attack.name}</b> <span>{signed(attack.bonus)} · {attack.damage} {damageKinds[attack.damageKind ?? 'untyped'][0]}</span></li>)}</ul>
      </section>}
      {selected.sections ? Object.entries(selected.sections).map(([heading, body]) => <section key={heading} className="manual-section">
        <h3>{heading}</h3><p className="stat-block">{body}</p>
      </section>) : <p className="stat-block">{selected.statBlock}</p>}
      <p className="manual-links">
        {selected.page && <a target="_blank" rel="noreferrer" href={source + '#page=' + selected.page}>เปิด SRD หน้า {selected.page} ↗</a>}
        {selected.url && <a target="_blank" rel="noreferrer" href={selected.url}>D&amp;D Beyond ↗</a>}
      </p>
    </> : <>
      <header><small>SRD 5.2.1</small><h2>Monster Manual</h2></header>
      <details><summary>นำเข้า Stat Block ของคุณ</summary>
        <label>วางข้อความจากชีตมอนสเตอร์หรือ JSON<textarea rows={7} value={draft} maxLength={32000} onChange={e => setDraft(e.target.value)} /></label>
        <button disabled={!draft.trim()} onClick={() => {
          try { const entry = parseMonsterText(draft); setSelected({ ...entry, customSheet: monsterSheet(entry) }); setSaved(false); setImportError('') }
          catch (e) { setImportError((e as Error).message) }
        }}>ตรวจข้อมูลก่อนนำเข้า</button>{importError && <p role="alert">{importError}</p>}
      </details>
      <div className="manual-filters">
        <label>ค้นหาชื่อหรือประเภท<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="เช่น Goblin หรือ Beast" /></label>
        <label>CR<select aria-label="กรองตาม CR" value={cr} onChange={e => setCr(e.target.value)}><option value="">ทั้งหมด</option>{crs.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>ประเภท<select aria-label="กรองตามประเภท" value={type} onChange={e => setType(e.target.value)}><option value="">ทั้งหมด</option>{types.map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
      {loading ? <p>กำลังเปิดคู่มือ…</p> : error ? <p role="alert">{error} <button onClick={() => retry(attempt + 1)}>ลองอีกครั้ง</button></p> : <small>{matches.length} รายการ</small>}
      <div className="manual-list">{matches.map(m => <button key={m.id} onClick={() => { setSelected(m); setSaved(false) }}>
        <span><b>{m.name}</b><small>{m.type}</small></span><span>CR {m.cr}</span></button>)}</div>
    </>}
    <footer><a href="/data/SRD-LICENSE.txt" target="_blank" rel="noreferrer">SRD 5.2.1 · CC BY 4.0</a> · <a href="https://www.dndbeyond.com/sources/dnd/mm-2024" target="_blank" rel="noreferrer">Monster Manual บน D&amp;D Beyond ↗</a></footer>
  </section>
}
