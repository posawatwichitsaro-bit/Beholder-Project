import { useMemo, useState } from 'react'
import { abilities } from '../../../shared/model.ts'
import type { Ability, Actor } from '../../../shared/model.ts'
import { featChoices, srdLink, srdSubclasses } from '../../../shared/progression.ts'
import { hitDiceByClass } from '../../../shared/characterStats.ts'
import type { Send } from '../../state/useCommand.ts'
import { Button, Dialog } from '../../ui/index.ts'
import { asiLevel, classesOf, levelHp, levelUp } from './levelUp.ts'
import type { HpChoice, LevelChoices } from './levelUp.ts'
import type { ClassName } from './wizard.ts'

/**
 * One level up: pick the class (the current one, or a new one to multiclass),
 * fixed or rolled HP, preview what changes, then a checklist of the choices
 * the player still makes on the sheet (ASI/Feat, subclass, spells).
 */
export function LevelUpDialog({ actor, send, close }: { actor: Actor; send: Send; close: () => void }) {
  const owned = classesOf(actor.classLevel)
  const [className, setClassName] = useState<ClassName>(owned[0]?.name ?? 'Fighter')
  const [hp, setHp] = useState<HpChoice>({ mode: 'fixed' })
  const [saving, setSaving] = useState(false)
  const nextLevel = (owned.find(entry => entry.name === className)?.level ?? 0) + 1
  const total = owned.reduce((sum, entry) => sum + entry.level, 0) + 1
  // SRD choices at this level: the subclass at 3, a feat or Ability Score Improvement at ASI levels.
  const subclass = nextLevel === 3 && !actor.subclass ? srdSubclasses[className] : undefined
  const offersFeat = asiLevel(className, nextLevel)
  const [takeSubclass, setTakeSubclass] = useState(true)
  const [feat, setFeat] = useState('Ability Score Improvement')
  const [first, setFirst] = useState<Ability>('STR')
  const [second, setSecond] = useState<Ability | ''>('')
  const choices: LevelChoices = {
    ...(subclass && takeSubclass ? { subclass: subclass.name } : {}),
    ...(offersFeat && feat ? { feat, increase: feat === 'Ability Score Improvement' ? (second && second !== first ? { [first]: 1, [second]: 1 } : { [first]: 2 }) : undefined } : {})
  }
  const preview = useMemo(() => {
    try { return { result: levelUp(actor, className, hp, choices) } } catch (error) { return { error: (error as Error).message } }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor, className, hp, JSON.stringify(choices)])
  const featInfo = featChoices(total).find(entry => entry.name === feat)
  const die = hitDiceByClass[className]

  async function confirm() {
    if (!preview.result) return
    setSaving(true)
    try {
      const { id: _id, ownerId: _owner, templateId: _template, lootResult: _loot, ...sheet } = preview.result.sheet as Actor
      if (await send({ type: 'sheet', actorId: actor.id, sheet })) close()
    } finally { setSaving(false) }
  }

  return <Dialog title={'เลเวลอัป · ' + actor.name} onClose={close} footer={<>
    <Button onClick={close}>ยกเลิก</Button>
    <Button variant="primary" disabled={!preview.result} pending={saving} onClick={() => void confirm()}>ยืนยันเลเวลอัป</Button>
  </>}>
    <div className="level-up">
      <label>คลาสที่จะเพิ่มเลเวล<select value={className} onChange={event => setClassName(event.target.value as ClassName)}>
        {owned.map(entry => <option key={entry.name} value={entry.name}>{entry.name} {entry.level} → {entry.level + 1}</option>)}
        <optgroup label="Multiclass">{(Object.keys(hitDiceByClass) as ClassName[]).filter(name => !owned.some(entry => entry.name === name))
          .map(name => <option key={name} value={name}>{name} 1 (คลาสใหม่)</option>)}</optgroup>
      </select></label>
      <fieldset className="level-up-hp">
        <legend>Hit Points (d{die})</legend>
        <label className="wizard-check"><input type="radio" name="level-hp" checked={hp.mode === 'fixed'} onChange={() => setHp({ mode: 'fixed' })} />
          ค่าคงที่ {die / 2 + 1} + CON = <b>{levelHp(className, actor.abilities.CON, { mode: 'fixed' })}</b></label>
        <label className="wizard-check"><input type="radio" name="level-hp" checked={hp.mode === 'rolled'} onChange={() => setHp({ mode: 'rolled', roll: die / 2 + 1 })} />
          ทอยเอง</label>
        {hp.mode === 'rolled' && <label>ผลทอย d{die}<input type="number" min={1} max={die} value={hp.roll}
          onChange={event => setHp({ mode: 'rolled', roll: Math.max(1, Math.min(die, event.target.valueAsNumber || 1)) })} /></label>}
      </fieldset>
      {subclass && <fieldset className="level-up-choice">
        <legend>Subclass (SRD)</legend>
        <label className="wizard-check"><input type="checkbox" checked={takeSubclass} onChange={event => setTakeSubclass(event.target.checked)} />{subclass.name}</label>
        <small>{subclass.summary} · <a href={srdLink} target="_blank" rel="noreferrer">อ่านใน SRD ↗</a></small>
      </fieldset>}
      {offersFeat && <fieldset className="level-up-choice">
        <legend>Ability Score Improvement หรือ Feat</legend>
        <label>เลือก<select value={feat} onChange={event => setFeat(event.target.value)}>
          <option value="">ยังไม่เลือก (เลือกเองในชีตทีหลัง)</option>
          {featChoices(total).map(entry => <option key={entry.name} value={entry.name}>{entry.name} · {entry.category}</option>)}
        </select></label>
        {featInfo && <small>{featInfo.summary}{featInfo.automatic ? ' · คิดให้แล้ว: ' + featInfo.automatic : ''}</small>}
        {feat === 'Ability Score Improvement' && <div className="form-grid">
          <label>+{second ? 1 : 2} ให้<select aria-label="ค่าแรกที่เพิ่ม" value={first} onChange={event => setFirst(event.target.value as Ability)}>
            {abilities.map(key => <option key={key} value={key}>{key} ({actor.abilities[key]})</option>)}</select></label>
          <label>+1 อีกค่า (ถ้าแบ่ง)<select aria-label="ค่าที่สองที่เพิ่ม" value={second} onChange={event => setSecond(event.target.value as Ability | '')}>
            <option value="">ไม่แบ่ง</option>{abilities.filter(key => key !== first).map(key => <option key={key} value={key}>{key} ({actor.abilities[key]})</option>)}</select></label>
        </div>}
      </fieldset>}
      {preview.error ? <p role="alert">{preview.error}</p> : preview.result && <>
        <dl className="wizard-summary">
          <div><dt>เลเวลรวม</dt><dd>{preview.result.total}</dd></div>
          <div><dt>Max HP</dt><dd>{actor.maxHp} → {preview.result.sheet.maxHp}</dd></div>
          <div><dt>Proficiency</dt><dd>+{preview.result.sheet.proficiency}</dd></div>
          {preview.result.sheet.slots !== actor.slots && <div><dt>ช่องเวท</dt><dd>{preview.result.sheet.slots}</dd></div>}
        </dl>
        <h3>สิ่งที่ต้องเลือกต่อ</h3>
        <ul className="level-up-checklist">{preview.result.checklist.map(note => <li key={note}>{note}</li>)}</ul>
      </>}
    </div>
  </Dialog>
}
