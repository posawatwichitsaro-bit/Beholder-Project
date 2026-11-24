import { abilities } from '../shared/model.ts'
import type { Ability, Sheet } from '../shared/model.ts'
import { abilityModifier, armorPresets, calculatedSheet, hitDiceByClass } from '../shared/characterStats.ts'
import type { ArmorSettings, CharacterCalculations, HitDie } from '../shared/characterStats.ts'

export function CharacterCalculationFields({ sheet, update }: { sheet: Sheet; update: (value: CharacterCalculations) => void }) {
  const config = sheet.calculations ?? {}
  const computed = calculatedSheet(sheet)
  const classHints = [...sheet.classLevel.matchAll(/\b([A-Za-z]+)\s+([1-9]|1\d|20)\b/g)].flatMap(match => {
    const die = hitDiceByClass[match[1] as keyof typeof hitDiceByClass]
    return die ? [{ die, levels: Number(match[2]) }] : []
  })
  const hintedLevel = classHints.reduce((sum, item) => sum + item.levels, 0)
  const hp = config.hp
  const armor = config.armor
  const setArmor = (fields: Partial<ArmorSettings>) => { if (armor) update({ ...config, armor: { ...armor, ...fields } }) }
  const setClass = (index: number, fields: Partial<{ die: HitDie; levels: number }>) => {
    if (hp) update({ ...config, hp: { ...hp, classes: hp.classes.map((item, at) => index === at ? { ...item, ...fields } : item) } })
  }
  return <details className="character-calculation"><summary>คำนวณค่าสถานะ D&D</summary>
    <div className="calculation-block">
      <label className="inline"><input type="checkbox" checked={!!hp} onChange={event => update({
        ...config, hp: event.target.checked ? { classes: hintedLevel > 0 && hintedLevel <= 20 ? classHints : [{ die: 8, levels: config.level ?? 1 }], bonus: 0 } : undefined
      })} />คำนวณ Max HP แบบค่าคงที่ตามคลาส</label>
      {hp && <>
        <small>ใส่คลาสเริ่มต้นแถวแรกเพื่อใช้ Hit Die เต็มในเลเวลแรก</small>
        {hp.classes.map((item, index) => <div key={index} className="class-inputs">
          <label>Hit Die {index + 1}<select value={item.die} onChange={event => setClass(index, { die: Number(event.target.value) as HitDie })}>
            {[6, 8, 10, 12].map(die => <option key={die} value={die}>d{die}</option>)}
          </select></label>
          <label>เลเวลคลาส {index + 1}<input type="number" min={1} max={20} required value={item.levels || ''}
            onChange={event => setClass(index, { levels: event.target.valueAsNumber })} /></label>
          {index > 0 && <button type="button" onClick={() => update({ ...config, hp: { ...hp, classes: hp.classes.filter((_, at) => index !== at) } })}>ลบคลาส</button>}
        </div>)}
        <button type="button" disabled={hp.classes.length >= 20} onClick={() => update({ ...config, hp: { ...hp, classes: [...hp.classes, { die: 8, levels: 1 }] } })}>+ คลาส</button>
        <label>ตัวปรับ Max HP ทั้งหมด<input type="number" min={-200} max={500} required value={Number.isFinite(hp.bonus) ? hp.bonus : ''}
          onChange={event => update({ ...config, hp: { ...hp, bonus: event.target.valueAsNumber } })} /></label>
        <output>Max HP {computed.maxHp} · Proficiency +{computed.proficiency}</output>
      </>}
      {!hp && <>
        <label className="inline"><input type="checkbox" checked={config.level !== undefined} onChange={event => update({
          ...config, level: event.target.checked ? (hintedLevel > 0 && hintedLevel <= 20 ? hintedLevel : 1) : undefined
        })} />คำนวณ Proficiency จากเลเวลรวม</label>
        {config.level !== undefined && <label>เลเวลรวม<input type="number" min={1} max={20} required value={config.level || ''}
          onChange={event => update({ ...config, level: event.target.valueAsNumber })} /></label>}
      </>}
    </div>
    <div className="calculation-block">
      <label className="inline"><input type="checkbox" checked={!!armor} onChange={event => update({
        ...config, armor: event.target.checked ? { ...armorPresets.Unarmored, shield: false, bonus: 0 } : undefined
      })} />คำนวณ AC จากเกราะ</label>
      {armor && <>
        <label>ใช้ค่าเกราะสำเร็จรูป<select value="" onChange={event => {
          const name = event.target.value as keyof typeof armorPresets
          if (name) setArmor(armorPresets[name])
        }}><option value="">เลือกเพื่อกรอกค่า</option>{Object.keys(armorPresets).map(name => <option key={name}>{name}</option>)}</select></label>
        <div className="form-grid">
          <label>AC ฐาน<input type="number" min={1} max={99} required value={armor.base || ''} onChange={event => setArmor({ base: event.target.valueAsNumber })} /></label>
          <label>การใช้ DEX<select value={armor.dex} onChange={event => setArmor({ dex: event.target.value as ArmorSettings['dex'] })}>
            <option value="full">บวก DEX เต็ม</option><option value="medium">บวก DEX สูงสุด +2</option><option value="none">ไม่บวก DEX</option>
          </select></label>
          <label>ค่าความสามารถเสริม<select value={armor.extra ?? ''} onChange={event => setArmor({ extra: event.target.value as Ability || undefined })}>
            <option value="">ไม่มี</option>{abilities.filter(ability => ability !== 'DEX').map(ability => <option key={ability}>{ability}</option>)}
          </select></label>
          <label>โบนัส AC อื่น<input type="number" min={-30} max={99} required value={Number.isFinite(armor.bonus) ? armor.bonus : ''}
            onChange={event => setArmor({ bonus: event.target.valueAsNumber })} /></label>
          <label className="inline"><input type="checkbox" checked={armor.shield} onChange={event => setArmor({ shield: event.target.checked })} />ถือโล่ +2</label>
        </div>
        <output>AC {computed.ac}</output>
      </>}
    </div>
    <div className="calculation-block">
      <label className="inline"><input type="checkbox" checked={config.initiativeBonus !== undefined} onChange={event => update({
        ...config, initiativeBonus: event.target.checked ? sheet.initiative - abilityModifier(sheet.abilities.DEX) : undefined
      })} />คำนวณ Initiative จาก DEX</label>
      {config.initiativeBonus !== undefined && <label>ตัวปรับ Initiative อื่น<input type="number" min={-99} max={99} required
        value={Number.isFinite(config.initiativeBonus) ? config.initiativeBonus : ''} onChange={event => update({ ...config, initiativeBonus: event.target.valueAsNumber })} /></label>}
      <label>ค่าความสามารถร่ายเวทหลัก<select value={config.spellAbility ?? ''} onChange={event => update({
        ...config, spellAbility: event.target.value as Ability || undefined
      })}><option value="">ใช้ค่าที่กรอก</option>{abilities.map(ability => <option key={ability}>{ability}</option>)}</select></label>
    </div>
  </details>
}
