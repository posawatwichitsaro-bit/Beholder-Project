import { useState } from 'react'
import type { FormEvent } from 'react'
import { abilities, sizes } from '../shared/model.ts'
import type { Sheet } from '../shared/model.ts'

export function SheetEditor({ initial, save, cancel }: { initial: Sheet; save: (sheet: Sheet) => void; cancel: () => void }) {
  const [sheet, set] = useState(initial)
  const attacks = sheet.attacks ?? []
  const editAttack = (index: number, edit: Partial<typeof attacks[number]>) =>
    set({ ...sheet, attacks: attacks.map((attack, current) => current === index ? { ...attack, ...edit } : attack) })
  const submit = (event: FormEvent) => { event.preventDefault(); save(sheet) }
  const numeric = (key: 'hp' | 'maxHp' | 'tempHp' | 'ac' | 'speed' | 'proficiency' | 'initiative' | 'attack' | 'spellAttack' | 'spellDC', label: string, min = 0) =>
    <label key={key}>{label}<input required type="number" min={min} value={sheet[key]} onChange={e => set({ ...sheet, [key]: e.target.valueAsNumber })} /></label>
  const field = (key: 'name' | 'classLevel' | 'damage' | 'skills' | 'saves' | 'spells' | 'slots' | 'conditions', label: string) =>
    <label key={key}>{label}<input required={key === 'name' || key === 'damage'} value={sheet[key]} onChange={e => set({ ...sheet, [key]: e.target.value })} /></label>
  return <div className="scrim"><form className="dialog" onSubmit={submit}>
    <header><h2>{initial.kind === 'pc' ? 'Character Sheet' : 'Monster Sheet'}</h2><button type="button" onClick={cancel} aria-label="ปิด">×</button></header>
    <div className="form-grid">
      {field('name', 'ชื่อ')}{field('classLevel', initial.kind === 'pc' ? 'คลาสและเลเวล' : 'ประเภท / CR')}
      <label>ขนาด<select value={sheet.size} onChange={e => set({ ...sheet, size: e.target.value as Sheet['size'] })}>
        {Object.keys(sizes).map(size => <option key={size}>{size}</option>)}
      </select></label>
      {numeric('speed', 'ความเร็ว (ฟุต)')}{numeric('hp', 'HP ปัจจุบัน')}{numeric('maxHp', 'HP สูงสุด', 1)}
      {numeric('tempHp', 'Temporary HP')}{numeric('ac', 'AC')}{numeric('proficiency', 'Proficiency')}
      {numeric('initiative', 'Initiative', -999)}{numeric('attack', 'Attack bonus', -999)}{field('damage', 'สูตร Damage')}
      {abilities.map(ability => <label key={ability}>{ability}<input type="number" min="1" max="30" required value={sheet.abilities[ability]}
        onChange={e => set({ ...sheet, abilities: { ...sheet.abilities, [ability]: e.target.valueAsNumber } })} /></label>)}
      {field('skills', 'ทักษะ / Proficiencies')}{field('saves', 'Saving Throw Proficiencies')}
      {numeric('spellAttack', 'Spell attack', -999)}{numeric('spellDC', 'Spell DC')}{field('spells', 'เวท / ความสามารถ')}
      {field('slots', 'ช่องเวท / ทรัพยากร')}{field('conditions', 'Conditions')}
    </div>
    {attacks.length > 0 && <div className="item-list">{attacks.map((attack, index) => <div className="attack-row" key={index}>
      <label>ชื่ออาวุธหรือการโจมตี<input required value={attack.name} onChange={e => editAttack(index, { name: e.target.value })} /></label>
      <label>โบนัส<input required type="number" value={attack.bonus} onChange={e => editAttack(index, { bonus: e.target.valueAsNumber })} /></label>
      <label>สูตร Damage<input required value={attack.damage} onChange={e => editAttack(index, { damage: e.target.value })} /></label>
      <button type="button" aria-label={'ลบอาวุธ ' + (index + 1)} onClick={() => set({ ...sheet, attacks: attacks.filter((_, current) => current !== index) })}>×</button>
    </div>)}</div>}
    <button type="button" disabled={attacks.length >= 20}
      onClick={() => set({ ...sheet, attacks: [...attacks, { name: '', bonus: 0, damage: '1d6' }] })}>+ รายการโจมตี</button>
    <footer><button type="button" onClick={cancel}>ยกเลิก</button><button className="primary">บันทึกชีต</button></footer>
  </form></div>
}
