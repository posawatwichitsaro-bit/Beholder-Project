import { useMemo, useState } from 'react'
import type { Actor } from '../../../shared/model.ts'
import { hitDiceByClass } from '../../../shared/characterStats.ts'
import type { Send } from '../../state/useCommand.ts'
import { Button, Dialog } from '../../ui/index.ts'
import { classesOf, levelHp, levelUp } from './levelUp.ts'
import type { HpChoice } from './levelUp.ts'
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
  const preview = useMemo(() => {
    try { return { result: levelUp(actor, className, hp) } } catch (error) { return { error: (error as Error).message } }
  }, [actor, className, hp])
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
