import { useState } from 'react'
import type { FormEvent } from 'react'
import { abilities, sizes } from '../../../shared/model.ts'
import type { ItemProficiency, Sheet } from '../../../shared/model.ts'
import { PictureInput } from './PictureInput.tsx'
import { ItemFields, LootSettingsFields, blankItem } from '../objects/Inventory.tsx'
import { ItemCatalogPicker } from '../items/ItemCatalogPicker.tsx'
import { CharacterCalculationFields } from './CharacterCalculations.tsx'
import { attacksPerAction } from '../../../shared/economy.ts'
import { abilityModifier, calculatedSheet } from '../../../shared/characterStats.ts'

export function SheetEditor({ initial, save, cancel, copy, editInventory = true, report }: {
  initial: Sheet; save: (sheet: Sheet) => void; cancel: () => void; copy?: () => void; editInventory?: boolean
  /** Warnings from a PDF import done before the editor opened (the character wizard). */
  report?: string[]
}) {
  const [sheet, set] = useState(initial)
  const [loadingImage, setLoadingImage] = useState(false)
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [importError, setImportError] = useState('')
  const [importReport, setImportReport] = useState<string[] | undefined>(report)
  const attacks = sheet.attacks ?? []
  const items = sheet.inventory ?? []
  const proficiency = sheet.itemProficiency ?? { thievesTools: false, sleight: false, investigation: false, perception: false }
  const editAttack = (index: number, edit: Partial<typeof attacks[number]>) =>
    set({ ...sheet, attacks: attacks.map((attack, current) => current === index ? { ...attack, ...edit } : attack) })
  const computed = calculatedSheet(sheet)
  const config = sheet.calculations
  const automatic = { maxHp: !!config?.hp, ac: !!config?.armor, proficiency: !!config?.hp || !!config?.level,
    initiative: config?.initiativeBonus !== undefined, spellAttack: !!config?.spellAbility, spellDC: !!config?.spellAbility }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!loadingImage && !loadingPdf) save(computed)
  }
  const numeric = (key: 'hp' | 'maxHp' | 'tempHp' | 'ac' | 'speed' | 'proficiency' | 'initiative' | 'attack' | 'spellAttack' | 'spellDC', label: string, min = 0) => {
    const locked = key in automatic && automatic[key as keyof typeof automatic]
    return <label key={key}>{label}<input required type="number" min={min} readOnly={locked}
      value={Number.isFinite(computed[key]) ? computed[key] : ''} onChange={e => set({ ...sheet, [key]: e.target.valueAsNumber })} /></label>
  }
  const field = (key: 'name' | 'classLevel' | 'damage' | 'skills' | 'saves' | 'spells' | 'slots' | 'conditions', label: string) =>
    <label key={key}>{label}<input autoFocus={key === 'name'} required={key === 'name' || key === 'damage'} value={sheet[key]} onChange={e => set({ ...sheet, [key]: e.target.value })} /></label>
  return <div className="scrim"><form className="dialog" role="dialog" aria-label="แก้ไขชีต" aria-modal="true" onSubmit={submit}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); cancel() } }}>
    <header><h2>{initial.kind === 'pc' ? 'Character Sheet' : 'Monster Sheet'}</h2><button type="button" onClick={cancel} aria-label="ปิด">×</button></header>
    {sheet.kind === 'pc' && editInventory && <section className="pdf-import">
      <label>นำเข้า PDF จาก D&D Beyond<input type="file" accept="application/pdf,.pdf" disabled={loadingPdf || loadingImage} onChange={async event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (!file) return
        setLoadingPdf(true)
        setImportError('')
        setImportReport(undefined)
        try {
          const { importBeyondPdf } = await import('./importBeyondPdf.ts')
          const result = await importBeyondPdf(file)
          set(result.sheet)
          setImportReport(result.warnings)
        } catch (error) {
          setImportError(error instanceof Error ? error.message : 'อ่าน PDF ไม่สำเร็จ')
        } finally { setLoadingPdf(false) }
      }} /></label>
      {loadingPdf && <p role="status">กำลังอ่าน PDF…</p>}
      {importError && <p role="alert">{importError}</p>}
      {importReport && <div role="status"><strong>อ่าน {sheet.name} แล้ว ตรวจข้อมูลก่อนบันทึก</strong>
        {importReport.map(message => <p key={message}>{message}</p>)}
      </div>}
    </section>}
    <PictureInput label="รูปตัวละครบน Token" value={sheet.portrait} pending={setLoadingImage}
      change={portrait => set(current => ({ ...current, portrait }))} />
    <div className="form-grid">
      {field('name', 'ชื่อ')}{field('classLevel', initial.kind === 'pc' ? 'คลาสและเลเวล' : 'ประเภท / CR')}
      <label>ขนาด<select value={sheet.size} onChange={e => set({ ...sheet, size: e.target.value as Sheet['size'] })}>
        {Object.keys(sizes).map(size => <option key={size}>{size}</option>)}
      </select></label>
      {numeric('speed', 'ความเร็ว (ฟุต)')}{numeric('hp', 'HP ปัจจุบัน')}{numeric('maxHp', 'HP สูงสุด', 1)}
      {numeric('tempHp', 'Temporary HP')}{numeric('ac', 'AC')}{numeric('proficiency', 'Proficiency')}
      {numeric('initiative', 'Initiative', -999)}{numeric('attack', 'Attack bonus', -999)}{field('damage', 'สูตร Damage')}
      <label key="attacksPerAction" title="Extra Attack หรือ Multiattack · เว้นว่างให้ระบบคิดจากคลาสหรือ stat block">โจมตีต่อ Action
        <input type="number" min={1} max={10} placeholder={String(attacksPerAction({ ...sheet, attacksPerAction: undefined }))} value={sheet.attacksPerAction ?? ''}
          onChange={e => set({ ...sheet, attacksPerAction: Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : undefined })} /></label>
      {abilities.map(ability => {
        const score = sheet.abilities[ability]
        const modifier = abilityModifier(score)
        return <div key={ability}><label>{ability}<input type="number" min="1" max="30" required value={Number.isFinite(score) ? score : ''}
          onChange={e => set({ ...sheet, abilities: { ...sheet.abilities, [ability]: e.target.valueAsNumber } })} /></label>
          {Number.isFinite(score) && <small>Modifier {modifier >= 0 ? '+' : ''}{modifier}</small>}
        </div>
      })}
      {field('skills', 'ทักษะ / Proficiencies')}{field('saves', 'Saving Throw Proficiencies')}
      {numeric('spellAttack', 'Spell attack', -999)}{numeric('spellDC', 'Spell DC')}{field('spells', 'เวท / ความสามารถ')}
      {field('slots', 'ช่องเวท / ทรัพยากร')}{field('conditions', 'Conditions')}
    </div>
    {sheet.kind === 'pc' && <CharacterCalculationFields sheet={sheet} update={calculations => set({ ...computed, calculations })} />}
    {sheet.characterDetails && <details><summary>ข้อมูลจากชีต</summary>
      {sheet.characterDetails.species && <p>Species · {sheet.characterDetails.species}</p>}
      {sheet.characterDetails.background && <p>Background · {sheet.characterDetails.background}</p>}
      {sheet.characterDetails.hitDice && <p>Hit Dice · {sheet.characterDetails.hitDice}</p>}
      {sheet.characterDetails.defenses && <p>Defenses · {sheet.characterDetails.defenses}</p>}
    </details>}
    {sheet.kind === 'pc' && <details><summary>ความชำนาญสำหรับค้นหาและสะเดาะล็อก</summary><div className="checks sheet-proficiency">
      {(Object.entries({ thievesTools: 'Thieves’ Tools', sleight: 'Sleight of Hand', investigation: 'Investigation', perception: 'Perception' }) as [keyof ItemProficiency, string][]).map(([key, title]) =>
        <label key={key}><input type="checkbox" checked={proficiency[key]} onChange={event => set({
          ...sheet, itemProficiency: { ...proficiency, [key]: event.target.checked }
        })} />{title}</label>)}
    </div></details>}
    {editInventory && <details className="sheet-inventory"><summary>{sheet.kind === 'monster' ? 'Inventory และ Loot' : 'Inventory'} ({items.length})</summary>
      {sheet.kind === 'monster' && <LootSettingsFields dc={sheet.lootDc} skill={sheet.lootSkill}
        changeDc={lootDc => set({ ...sheet, lootDc })} changeSkill={lootSkill => set({ ...sheet, lootSkill, lootDc: sheet.lootDc ?? 12 })} />}
      {items.map((item, index) => <div className="inventory-form" key={item.id}>
        <ItemFields item={item} monster={sheet.kind === 'monster'} update={value => set({ ...sheet, inventory: items.map((entry, at) => index === at ? value : entry) })} />
        <button type="button" onClick={() => set({ ...sheet, inventory: items.filter((_, at) => index !== at) })}>นำไอเทมออก</button>
      </div>)}
      {browsing ? <ItemCatalogPicker actionLabel="ใส่ในชีตนี้" close={() => setBrowsing(false)}
        choose={item => { set({ ...sheet, inventory: [...items, { ...blankItem(sheet.kind === 'monster' && items.length > 0), ...item }] }); return true }} />
        : <div className="inline"><button type="button" disabled={items.length >= 100}
          onClick={() => set({ ...sheet, inventory: [...items, blankItem(sheet.kind === 'monster' && items.length > 0)] })}>+ ไอเทม</button>
          <button type="button" disabled={items.length >= 100} onClick={() => setBrowsing(true)}>เลือกจากคลัง SRD</button></div>}
    </details>}
    {attacks.length > 0 && <div className="item-list">{attacks.map((attack, index) => <div className="attack-row" key={index}>
      <label>ชื่ออาวุธหรือการโจมตี<input required value={attack.name} onChange={e => editAttack(index, { name: e.target.value })} /></label>
      <label>โบนัส<input required type="number" value={attack.bonus} onChange={e => editAttack(index, { bonus: e.target.valueAsNumber })} /></label>
      <label>สูตร Damage<input required value={attack.damage} onChange={e => editAttack(index, { damage: e.target.value })} /></label>
      <button type="button" aria-label={'ลบอาวุธ ' + (index + 1)} onClick={() => set({ ...sheet, attacks: attacks.filter((_, current) => current !== index) })}>×</button>
      {attack.notes && <small className="attack-notes">{attack.notes}</small>}
    </div>)}</div>}
    <button type="button" disabled={attacks.length >= 20}
      onClick={() => set({ ...sheet, attacks: [...attacks, { name: '', bonus: 0, damage: '1d6' }] })}>+ รายการโจมตี</button>
    <footer>{copy && <button type="button" onClick={copy}>คัดลอกเข้าคลังส่วนตัว</button>}
      <button type="button" onClick={cancel}>ยกเลิก</button><button className="primary" disabled={loadingImage || loadingPdf}>บันทึกชีต</button></footer>
  </form></div>
}
