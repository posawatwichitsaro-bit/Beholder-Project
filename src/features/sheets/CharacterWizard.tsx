import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { abilities } from '../../../shared/model.ts'
import type { Ability, Sheet } from '../../../shared/model.ts'
import { abilityModifier, armorPresets, hitDiceByClass } from '../../../shared/characterStats.ts'
import { Button, Dialog } from '../../ui/index.ts'
import { PictureInput } from './PictureInput.tsx'
import { buildCharacter, classInfo, suggestedAbilities, weapons } from './wizard.ts'
import type { ClassName, WizardChoices } from './wizard.ts'

const steps = ['ตัวตน', 'คลาสและเลเวล', 'ค่าพลัง', 'อุปกรณ์', 'ตรวจและบันทึก'] as const
const signed = (value: number) => (value >= 0 ? '+' : '') + value

/**
 * New character, one question at a time: who → class & level → ability
 * scores → armour & weapons → review. The finished sheet has the D&D
 * calculator switched on, so later edits keep HP/AC/spell numbers right.
 * Experienced players can import a D&D Beyond PDF or open the full editor.
 */
export function CharacterWizard({ save, close, openEditor }: {
  save: (sheet: Sheet) => Promise<boolean>
  close: () => void
  /** Leave the wizard for the full sheet editor, optionally with an imported sheet and its report. */
  openEditor: (sheet?: Sheet, report?: string[]) => void
}) {
  const [step, setStep] = useState(0)
  const [choices, setChoices] = useState<WizardChoices>({
    name: '', className: 'Fighter', level: 1, abilities: suggestedAbilities('Fighter'),
    armor: 'Chain Mail', shield: false, weapons: ['Longsword']
  })
  const [loadingImage, setLoadingImage] = useState(false)
  const [pdfState, setPdfState] = useState<'idle' | 'reading' | string>('idle')
  const [saving, setSaving] = useState(false)
  const sheet = useMemo(() => buildCharacter({ ...choices, name: choices.name || 'ตัวละครใหม่' }), [choices])
  const set = (patch: Partial<WizardChoices>) => setChoices(current => ({ ...current, ...patch }))
  const canNext = step !== 0 || (choices.name.trim().length > 0 && !loadingImage)

  function chooseClass(className: ClassName) {
    set({ className, abilities: suggestedAbilities(className) })
  }
  async function importPdf(file: File) {
    setPdfState('reading')
    try {
      const { importBeyondPdf } = await import('./importBeyondPdf.ts')
      const result = await importBeyondPdf(file)
      openEditor(result.sheet, result.warnings)
    } catch (error) {
      setPdfState(error instanceof Error ? error.message : 'อ่าน PDF ไม่สำเร็จ')
    }
  }
  async function finish() {
    setSaving(true)
    try { if (await save({ ...sheet, name: choices.name.trim() })) close() }
    finally { setSaving(false) }
  }

  const footer = <>
    {step > 0 && <Button onClick={() => setStep(step - 1)}>ย้อนกลับ</Button>}
    {step < steps.length - 1
      ? <Button variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>ถัดไป</Button>
      : <Button variant="primary" pending={saving} onClick={() => void finish()}>สร้างตัวละคร</Button>}
  </>

  return <Dialog title="สร้างตัวละคร" onClose={close} footer={footer} size="lg">
    <ol className="wizard-steps" aria-label="ขั้นตอน">
      {steps.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined} data-done={index < step || undefined}>
        <span className="wizard-dot" aria-hidden="true">{index < step ? <Check size={12} /> : index + 1}</span>{label}
      </li>)}
    </ol>

    {step === 0 && <div className="wizard-page">
      <label>ชื่อตัวละคร<input autoFocus value={choices.name} maxLength={120} onChange={event => set({ name: event.target.value })} placeholder="เช่น Mira Ash" /></label>
      <label>เผ่าพันธุ์ (ไม่บังคับ)<input value={choices.species ?? ''} maxLength={60} onChange={event => set({ species: event.target.value })} placeholder="เช่น Elf, Dwarf, Human" /></label>
      <PictureInput label="รูปตัวละครบน Token" value={choices.portrait} pending={setLoadingImage} change={portrait => set({ portrait })} />
      <div className="wizard-alt">
        <p>มีตัวละครอยู่แล้ว?</p>
        <label className="wizard-file">นำเข้า PDF จาก D&amp;D Beyond<input type="file" accept="application/pdf,.pdf" disabled={pdfState === 'reading'}
          onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importPdf(file) }} /></label>
        {pdfState === 'reading' && <p role="status">กำลังอ่าน PDF…</p>}
        {pdfState !== 'idle' && pdfState !== 'reading' && <p role="alert">{pdfState}</p>}
        <button type="button" className="wizard-link" onClick={() => openEditor()}>กรอกชีตเองแบบเต็ม</button>
      </div>
    </div>}

    {step === 1 && <div className="wizard-page">
      <div className="wizard-classes" role="radiogroup" aria-label="คลาส">
        {(Object.keys(hitDiceByClass) as ClassName[]).map(name => <button key={name} type="button" role="radio" aria-checked={choices.className === name}
          className="wizard-class" onClick={() => chooseClass(name)}>
          <b>{name}</b><small>d{hitDiceByClass[name]} · Save {classInfo[name].saves.join('/')}</small>
        </button>)}
      </div>
      <label className="wizard-level">เลเวล<input type="number" min={1} max={20} value={choices.level}
        onChange={event => set({ level: Math.max(1, Math.min(20, event.target.valueAsNumber || 1)) })} /></label>
    </div>}

    {step === 2 && <div className="wizard-page">
      <p className="wizard-hint">ค่าตั้งต้นใช้ Standard Array (15, 14, 13, 12, 10, 8) เรียงตามความถนัดของ {choices.className} ปรับได้ทุกช่อง</p>
      <div className="wizard-abilities">
        {abilities.map(key => <label key={key} className="wizard-ability">
          <span>{key}{classInfo[choices.className].saves.includes(key) && <em> · Save</em>}</span>
          <input type="number" min={3} max={20} value={choices.abilities[key]}
            onChange={event => set({ abilities: { ...choices.abilities, [key]: event.target.valueAsNumber || 10 } as Record<Ability, number> })} />
          <b>{signed(abilityModifier(choices.abilities[key]))}</b>
        </label>)}
      </div>
      <Button size="sm" onClick={() => set({ abilities: suggestedAbilities(choices.className) })}>คืนค่าแนะนำของคลาส</Button>
    </div>}

    {step === 3 && <div className="wizard-page">
      <div className="wizard-row">
        <label>ชุดเกราะ<select value={choices.armor} onChange={event => set({ armor: event.target.value as WizardChoices['armor'] })}>
          {Object.keys(armorPresets).map(name => <option key={name}>{name}</option>)}
        </select></label>
        <label className="wizard-check"><input type="checkbox" checked={choices.shield} onChange={event => set({ shield: event.target.checked })} />ถือโล่ (+2 AC)</label>
        <p className="wizard-result">AC <b>{sheet.ac}</b></p>
      </div>
      <fieldset className="wizard-weapons">
        <legend>อาวุธ (เลือกได้สูงสุด 3 · ชิ้นแรกเป็นการโจมตีหลัก)</legend>
        {Object.entries(weapons).map(([name, weapon]) => {
          const picked = choices.weapons.includes(name)
          return <label key={name} className="wizard-check">
            <input type="checkbox" checked={picked} disabled={!picked && choices.weapons.length >= 3}
              onChange={() => set({ weapons: picked ? choices.weapons.filter(item => item !== name) : [...choices.weapons, name] })} />
            {name}<small>{weapon.damage} · {weapon.style === 'ranged' ? 'DEX' : weapon.style === 'finesse' ? 'STR/DEX' : 'STR'}</small>
          </label>
        })}
      </fieldset>
    </div>}

    {step === 4 && <div className="wizard-page wizard-review">
      <h3>{choices.name}</h3>
      <p>{[choices.species, sheet.classLevel].filter(Boolean).join(' · ')}</p>
      <dl className="wizard-summary">
        <div><dt>HP</dt><dd>{sheet.maxHp}</dd></div>
        <div><dt>AC</dt><dd>{sheet.ac}</dd></div>
        <div><dt>Initiative</dt><dd>{signed(sheet.initiative)}</dd></div>
        <div><dt>Proficiency</dt><dd>{signed(sheet.proficiency)}</dd></div>
        {classInfo[choices.className].spellAbility && <div><dt>Spell DC</dt><dd>{sheet.spellDC}</dd></div>}
      </dl>
      <ul className="wizard-attacks">
        <li><b>{choices.weapons[0] ?? 'Unarmed Strike'}</b> {signed(sheet.attack)} · {sheet.damage}</li>
        {(sheet.attacks ?? []).map(attack => <li key={attack.name}><b>{attack.name}</b> {signed(attack.bonus)} · {attack.damage}</li>)}
      </ul>
      <p className="wizard-hint">ตัวคำนวณ D&amp;D เปิดไว้ให้แล้ว เลเวลอัปหรือเปลี่ยนเกราะทีหลังได้จากปุ่มแก้ชีต ค่าต่าง ๆ จะคำนวณใหม่เอง</p>
    </div>}
  </Dialog>
}
