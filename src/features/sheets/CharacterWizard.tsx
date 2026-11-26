import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { abilities } from '../../../shared/model.ts'
import type { Ability, Sheet } from '../../../shared/model.ts'
import { abilityModifier, armorPresets, hitDiceByClass } from '../../../shared/characterStats.ts'
import { Button, Dialog } from '../../ui/index.ts'
import { PictureInput } from './PictureInput.tsx'
import { buildCharacter, classInfo, suggestedAbilities, weapons } from './wizard.ts'
import { backgrounds, isBackground, isSpecies, pointBuyBudget, pointBuyCost, rollAbilityScores, species, withBackground } from './origins.ts'
import type { BackgroundBonus, BackgroundName, SpeciesName } from './origins.ts'
import type { ClassName, WizardChoices } from './wizard.ts'

const steps = ['ตัวตน', 'ต้นกำเนิด', 'คลาสและเลเวล', 'ค่าพลัง', 'อุปกรณ์', 'ตรวจและบันทึก'] as const
type Method = 'standard' | 'pointbuy' | 'roll'
/** A fair d6 from the browser's crypto source (rejecting the biased top of the byte range). */
const rollDie = () => {
  const value = new Uint8Array(1)
  do crypto.getRandomValues(value); while (value[0] >= 252)
  return value[0] % 6 + 1
}
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
  const [method, setMethod] = useState<Method>('standard')
  const [rolled, setRolled] = useState<number[]>()
  const [loadingImage, setLoadingImage] = useState(false)
  const [pdfState, setPdfState] = useState<'idle' | 'reading' | string>('idle')
  const [saving, setSaving] = useState(false)
  const sheet = useMemo(() => buildCharacter({ ...choices, name: choices.name || 'ตัวละครใหม่' }), [choices])
  const set = (patch: Partial<WizardChoices>) => setChoices(current => ({ ...current, ...patch }))
  function chooseClass(className: ClassName) {
    set({ className, abilities: suggestedAbilities(className), backgroundBonus: defaultBonus(choices.background, className) })
  }
  /** +2 and +1 on the background's abilities the class cares about most. */
  function defaultBonus(background: string | undefined, className: ClassName): BackgroundBonus | undefined {
    if (!isBackground(background)) return undefined
    const [first, second] = classInfo[className].order.filter(ability => backgrounds[background].abilities.includes(ability))
    return { mode: 'two-one', plus2: first, plus1: second }
  }
  function chooseMethod(next: Method) {
    setMethod(next)
    if (next === 'standard' || (next === 'pointbuy' && pointBuyCost(choices.abilities) > pointBuyBudget)) set({ abilities: suggestedAbilities(choices.className) })
  }
  function roll() {
    const values = rollAbilityScores(rollDie)
    setRolled(values)
    const scores = {} as Record<Ability, number>
    classInfo[choices.className].order.forEach((ability, index) => { scores[ability] = values[index] })
    set({ abilities: scores })
  }
  const finalScores = withBackground(choices.abilities, choices.background, choices.backgroundBonus)
  const spent = pointBuyCost(choices.abilities)
  const pointBuyOk = method !== 'pointbuy' || spent <= pointBuyBudget
  const canNext = step === 0 ? choices.name.trim().length > 0 && !loadingImage
    : step === 3 ? pointBuyOk && (method !== 'roll' || Boolean(rolled)) : true
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
      <fieldset className="wizard-origin">
        <legend>Species (เผ่าพันธุ์)</legend>
        <div className="wizard-classes" role="radiogroup" aria-label="Species">
          {(Object.keys(species) as SpeciesName[]).map(name => <button key={name} type="button" role="radio" aria-checked={choices.species === name}
            className="wizard-class" onClick={() => set({ species: name, size: species[name].sizes[0] })}>
            <b>{name}</b><small>{species[name].sizes.join('/')} · {species[name].speed} ft.{species[name].darkvision ? ' · Darkvision ' + species[name].darkvision : ''}</small>
          </button>)}
          <button type="button" role="radio" aria-checked={!isSpecies(choices.species)} className="wizard-class"
            onClick={() => set({ species: '', size: undefined })}><b>อื่น ๆ / ไม่ระบุ</b><small>พิมพ์เองได้</small></button>
        </div>
        {isSpecies(choices.species)
          ? <p className="wizard-hint">{species[choices.species].traits.join(' · ')}</p>
          : <label>ชื่อเผ่าพันธุ์ (ไม่บังคับ)<input value={choices.species ?? ''} maxLength={60} onChange={event => set({ species: event.target.value })} placeholder="เว้นว่างได้" /></label>}
        {isSpecies(choices.species) && species[choices.species].sizes.length > 1 && <label>ขนาด<select value={choices.size}
          onChange={event => set({ size: event.target.value as WizardChoices['size'] })}>
          {species[choices.species].sizes.map(size => <option key={size}>{size}</option>)}
        </select></label>}
      </fieldset>
      <fieldset className="wizard-origin">
        <legend>Background (ภูมิหลัง)</legend>
        <div className="wizard-classes" role="radiogroup" aria-label="Background">
          {(Object.keys(backgrounds) as BackgroundName[]).map(name => <button key={name} type="button" role="radio" aria-checked={choices.background === name}
            className="wizard-class" onClick={() => set({ background: name, backgroundBonus: defaultBonus(name, choices.className) })}>
            <b>{name}</b><small>{backgrounds[name].abilities.join('/')} · {backgrounds[name].feat}</small>
          </button>)}
          <button type="button" role="radio" aria-checked={!isBackground(choices.background)} className="wizard-class"
            onClick={() => set({ background: undefined, backgroundBonus: undefined })}><b>ไม่ใช้</b><small>ไม่เพิ่มค่าพลัง</small></button>
        </div>
        {isBackground(choices.background) && <p className="wizard-hint">Skill: {backgrounds[choices.background].skills.join(', ')} · เครื่องมือ: {backgrounds[choices.background].tool}</p>}
      </fieldset>
    </div>}

    {step === 2 && <div className="wizard-page">
      <div className="wizard-classes" role="radiogroup" aria-label="คลาส">
        {(Object.keys(hitDiceByClass) as ClassName[]).map(name => <button key={name} type="button" role="radio" aria-checked={choices.className === name}
          className="wizard-class" onClick={() => chooseClass(name)}>
          <b>{name}</b><small>d{hitDiceByClass[name]} · Save {classInfo[name].saves.join('/')}</small>
        </button>)}
      </div>
      <label className="wizard-level">เลเวล<input type="number" min={1} max={20} value={choices.level}
        onChange={event => set({ level: Math.max(1, Math.min(20, event.target.valueAsNumber || 1)) })} /></label>
    </div>}

    {step === 3 && <div className="wizard-page">
      <div className="wizard-methods" role="radiogroup" aria-label="วิธีกำหนดค่าพลัง">
        {([['standard', 'Standard Array'], ['pointbuy', 'Point Buy'], ['roll', 'ทอย 4d6']] as [Method, string][]).map(([id, label]) =>
          <button key={id} type="button" role="radio" aria-checked={method === id} onClick={() => chooseMethod(id)}>{label}</button>)}
      </div>
      {method === 'standard' && <p className="wizard-hint">Standard Array (15, 14, 13, 12, 10, 8) เรียงตามความถนัดของ {choices.className} ปรับได้ทุกช่อง</p>}
      {method === 'pointbuy' && <p className="wizard-hint" role="status">Point Buy · ใช้ไป <b>{spent}</b> / {pointBuyBudget} แต้ม · แต่ละค่า 8–15{spent > pointBuyBudget ? ' · เกินงบ' : ''}</p>}
      {method === 'roll' && <p className="wizard-hint">
        {rolled ? 'ได้ ' + rolled.join(', ') + ' · จัดตามความถนัดของคลาสแล้ว สลับช่องได้' : 'ทอย 4d6 หกครั้ง เก็บ 3 ลูกสูงสุดในแต่ละครั้ง'}{' '}
        <Button size="sm" onClick={roll}>{rolled ? 'ทอยใหม่' : 'ทอย 4d6'}</Button></p>}
      <div className="wizard-abilities">
        {abilities.map(key => <label key={key} className="wizard-ability">
          <span>{key}{classInfo[choices.className].saves.includes(key) && <em> · Save</em>}</span>
          <input type="number" min={method === 'pointbuy' ? 8 : 3} max={method === 'pointbuy' ? 15 : 20} value={choices.abilities[key]}
            onChange={event => set({ abilities: { ...choices.abilities, [key]: event.target.valueAsNumber || 10 } as Record<Ability, number> })} />
          <b title="รวมค่าที่เพิ่มจาก Background">{finalScores[key] !== choices.abilities[key] && <small>{finalScores[key]} · </small>}{signed(abilityModifier(finalScores[key]))}</b>
        </label>)}
      </div>
      {isBackground(choices.background) && choices.backgroundBonus && <BonusPicker background={choices.background}
        bonus={choices.backgroundBonus} reset={() => defaultBonus(choices.background, choices.className)!} change={backgroundBonus => set({ backgroundBonus })} />}
      <Button size="sm" onClick={() => { setMethod('standard'); set({ abilities: suggestedAbilities(choices.className) }) }}>คืนค่าแนะนำของคลาส</Button>
    </div>}

    {step === 4 && <div className="wizard-page">
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

    {step === 5 && <div className="wizard-page wizard-review">
      <h3>{choices.name}</h3>
      <p>{[choices.species, choices.background, sheet.classLevel].filter(Boolean).join(' · ')}</p>
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

/** The background's increase: +2/+1 to two of its abilities, or +1 to all three. */
function BonusPicker({ background, bonus, reset, change }: {
  background: BackgroundName; bonus: BackgroundBonus; reset: () => BackgroundBonus; change: (bonus: BackgroundBonus) => void
}) {
  const options = backgrounds[background].abilities
  return <fieldset className="wizard-bonus">
    <legend>เพิ่มจาก Background {background} ({options.join('/')})</legend>
    <label className="wizard-check"><input type="radio" name="background-bonus" checked={bonus.mode === 'two-one'}
      onChange={() => change(reset())} />+2 และ +1</label>
    <label className="wizard-check"><input type="radio" name="background-bonus" checked={bonus.mode === 'three'}
      onChange={() => change({ mode: 'three' })} />+1 ทั้งสามค่า</label>
    {bonus.mode === 'two-one' && <div className="wizard-row">
      <label>+2<select value={bonus.plus2} onChange={event => {
        const plus2 = event.target.value as Ability
        change({ ...bonus, plus2, plus1: bonus.plus1 === plus2 ? options.find(ability => ability !== plus2)! : bonus.plus1 })
      }}>{options.map(ability => <option key={ability}>{ability}</option>)}</select></label>
      <label>+1<select value={bonus.plus1} onChange={event => change({ ...bonus, plus1: event.target.value as Ability })}>
        {options.filter(ability => ability !== bonus.plus2).map(ability => <option key={ability}>{ability}</option>)}</select></label>
    </div>}
  </fieldset>
}
