import { useState } from 'react'
import { classesIn } from '../../../shared/spells.ts'
import type { Spell } from '../../../shared/spells.ts'
import { levelName } from './catalog.ts'

const shown = 60

/**
 * Search the SRD spells and add one to a sheet. The list starts with the
 * sheet's own classes ("แสดงทุกเวท" lifts that); spells already on the sheet are marked.
 */
export function SpellPicker({ spells, classLevel, known, add, close }: {
  spells: Spell[]; classLevel: string; known: Set<string>
  add: (spell: Spell) => void; close: () => void
}) {
  const classes = classesIn(classLevel).map(entry => entry.name)
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState('')
  const [all, setAll] = useState(!spells.some(spell => spell.classes.some(name => classes.includes(name))))
  const [open, setOpen] = useState<Spell>()
  const words = query.trim().toLowerCase()
  const matches = spells.filter(spell => (all || spell.classes.some(name => classes.includes(name)))
    && (level === '' || spell.level === Number(level)) && (!words || spell.name.toLowerCase().includes(words)))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
  return <section className="item-catalog spell-picker" aria-label="คลังเวท SRD">
    <header className="item-catalog-head"><b>คลังเวท SRD 5.2.1</b><button type="button" onClick={close}>ปิดคลังเวท</button></header>
    {open ? <div className="item-catalog-detail">
      <button type="button" onClick={() => setOpen(undefined)}>← กลับไปยังรายการ</button>
      <SpellDetails spell={open} />
      <button type="button" className="primary" disabled={known.has(open.id)} onClick={() => { add(open); setOpen(undefined) }}>
        {known.has(open.id) ? 'อยู่ในชีตแล้ว' : 'เพิ่มเวทลงชีต'}</button>
    </div> : <>
      <label>ค้นหาเวท<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="เช่น Fireball, Cure Wounds" /></label>
      <div className="item-catalog-filters">
        <select aria-label="กรองระดับเวท" value={level} onChange={event => setLevel(event.target.value)}>
          <option value="">ทุกระดับ</option>{Array.from({ length: 10 }, (_, value) => <option key={value} value={value}>{levelName(value)}</option>)}
        </select>
        <label className="spell-picker-all"><input type="checkbox" checked={all} onChange={event => setAll(event.target.checked)} />แสดงทุกเวท</label>
      </div>
      {!all && <small className="muted">เฉพาะเวทของ {classes.join(', ')}</small>}
      <small className="muted">{matches.length > shown ? 'แสดง ' + shown + ' จาก ' + matches.length + ' บท · พิมพ์เพื่อค้นให้แคบลง' : matches.length + ' บท'}</small>
      <ul className="item-catalog-list">{matches.slice(0, shown).map(spell => <li key={spell.id}>
        <button type="button" onClick={() => setOpen(spell)} aria-label={'ดูเวท ' + spell.name}>
          <b>{spell.name}{known.has(spell.id) && ' ✓'}</b>
          <small>{[levelName(spell.level), spell.school, spell.concentration && 'Concentration', spell.ritual && 'Ritual'].filter(Boolean).join(' · ')}</small>
        </button>
      </li>)}</ul>
    </>}
    <footer><a href="/data/SRD-LICENSE.txt" target="_blank" rel="noreferrer">SRD 5.2.1 · CC BY 4.0</a></footer>
  </section>
}

/** A spell's header fields and full text, as the SRD gives them. */
export function SpellDetails({ spell }: { spell: Spell }) {
  return <div className="spell-details">
    <h4>{spell.name}</h4>
    <p className="item-badges"><span>{levelName(spell.level)} · {spell.school}</span>
      {spell.concentration && <span>Concentration</span>}{spell.ritual && <span>Ritual</span>}</p>
    <dl className="spell-fields">
      <dt>เวลาร่าย</dt><dd>{spell.castingTime}</dd><dt>ระยะ</dt><dd>{spell.range}</dd>
      <dt>ส่วนประกอบ</dt><dd>{spell.components}</dd><dt>ระยะเวลา</dt><dd>{spell.duration}</dd>
      <dt>คลาส</dt><dd>{spell.classes.join(', ')}</dd>
    </dl>
    <p className="item-description">{spell.description}</p>
    {spell.higherLevels && <p className="item-description"><b>ช่องเวทระดับสูงขึ้น.</b> {spell.higherLevels}</p>}
    {spell.cantripUpgrade && <p className="item-description"><b>Cantrip Upgrade.</b> {spell.cantripUpgrade}</p>}
    <small><a href={'https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf#page=' + spell.source.pdfPage} target="_blank" rel="noreferrer">SRD หน้า {spell.source.pdfPage} ↗</a></small>
  </div>
}
