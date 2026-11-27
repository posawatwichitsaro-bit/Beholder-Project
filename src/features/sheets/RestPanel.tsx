import { BedDouble, Coffee, Dices, Minus, Plus, Sparkles } from 'lucide-react'
import { magicalCunning } from '../../../shared/progression.ts'
import type { Actor, ClassResource, HitDie } from '../../../shared/model.ts'
import { classResources, hitDiceLeft } from '../../../shared/rest.ts'
import type { Send } from '../../state/useCommand.ts'

const recovery: Record<ClassResource['short'], string> = { all: 'พักสั้นคืนทั้งหมด', one: 'พักสั้นคืน 1', none: 'คืนเมื่อพักยาว' }

/**
 * Hit Dice, class resources and the two rests. A Short Rest is "spend Hit Dice
 * one at a time, then press Short Rest" for what comes back; a Long Rest
 * resets everything (and needs at least 1 HP). Both wait until combat ends.
 */
export function RestPanel({ actor, send, inCombat }: { actor: Actor; send: Send; inCombat: boolean }) {
  const dice = hitDiceLeft(actor)
  const sizes = (['d12', 'd10', 'd8', 'd6'] as HitDie[]).filter(die => dice[die])
  const resources = actor.resources ?? []
  const suggested = classResources(actor)
  const { id: _id, ownerId: _owner, templateId: _template, lootResult: _loot, ...sheet } = actor
  const cunning = magicalCunning(actor)
  const canRest = !inCombat && actor.hp > 0 && actor.life === 'active'
  const use = (index: number, used: number) => send({ type: 'useResource', actorId: actor.id, index, used })

  return <div className="rest-panel">
    {inCombat && <p className="sheet-note">พักได้เมื่อจบการต่อสู้</p>}
    <section aria-label="Hit Dice">
      <h3>Hit Dice</h3>
      {sizes.length ? <div className="rest-dice">{sizes.map(die => <div key={die} className="rest-die">
        <b>{die}</b><span>{dice[die]!.left}/{dice[die]!.total}</span>
        <button type="button" disabled={!canRest || !dice[die]!.left} onClick={() => void send({ type: 'spendHitDie', actorId: actor.id, die })}>
          <Dices size={14} aria-hidden="true" /> ใช้ Hit Die {die}</button>
      </div>)}</div>
        : <p className="sheet-note">ใส่คลาสและเลเวลในชีต (เช่น “Fighter 3”) หรือ Hit Dice ในรายละเอียด เพื่อใช้ Hit Dice ตอนพักสั้น</p>}
    </section>

    {/Warlock\s*([2-9]|1\d|20)\b/i.test(actor.classLevel) && <section aria-label="Magical Cunning">
      <h3>Magical Cunning</h3>
      <button type="button" disabled={!cunning} onClick={() => void send({ type: 'magicalCunning', actorId: actor.id })}>
        <Sparkles size={14} aria-hidden="true" /> พิธี 1 นาที · คืนช่อง Pact {cunning ? cunning.regained : ''}</button>
      <small className="sheet-note">{actor.cunningUsed ? 'ใช้ไปแล้ว · กลับมาเมื่อ Long Rest' : cunning ? 'คืนช่อง Pact ที่ใช้ไปได้ไม่เกินครึ่งหนึ่ง (ปัดขึ้น) วันละครั้ง' : 'ยังไม่มีช่อง Pact ที่ใช้ไป'}</small>
    </section>}

    <section aria-label="ทรัพยากรของคลาส">
      <h3>ทรัพยากรของคลาส</h3>
      {resources.map((resource, index) => {
        const left = resource.max - resource.used
        return <div key={resource.name + index} className="rest-resource">
          <span className="rest-resource-name"><b>{resource.name}</b><small>{recovery[resource.short]}</small></span>
          {resource.max <= 10 ? <span className="slot-pips">{Array.from({ length: resource.max }, (_, pip) => {
            const available = pip < left
            return <button key={pip} type="button" className="slot-pip" aria-pressed={available}
              aria-label={resource.name + ' ที่ ' + (pip + 1) + (available ? ' (ยังใช้ได้)' : ' (ใช้แล้ว)')}
              onClick={() => void use(index, available ? resource.used + 1 : resource.used - 1)} />
          })}</span> : <span className="rest-stepper">
            <button type="button" aria-label={'ใช้ ' + resource.name + ' 1'} disabled={!left} onClick={() => void use(index, resource.used + 1)}><Minus size={13} aria-hidden="true" /></button>
            <button type="button" aria-label={'คืน ' + resource.name + ' 1'} disabled={!resource.used} onClick={() => void use(index, resource.used - 1)}><Plus size={13} aria-hidden="true" /></button>
          </span>}
          <span className="slot-count">{left}/{resource.max}</span>
        </div>
      })}
      {!resources.length && (suggested.length
        ? <button type="button" onClick={() => void send({ type: 'sheet', actorId: actor.id, sheet: { ...sheet, resources: suggested } })}>
            เพิ่มทรัพยากรตามคลาส ({suggested.map(entry => entry.name).join(', ')})</button>
        : <p className="sheet-note">คลาสนี้ไม่มีทรัพยากรที่ต้องนับ หรือยังไม่ได้ใส่คลาสและเลเวล</p>)}
      {resources.length > 0 && suggested.length > 0 && <button type="button" className="rest-sync"
        onClick={() => void send({ type: 'sheet', actorId: actor.id, sheet: { ...sheet, resources: suggested.map(entry => ({ ...entry, used: Math.min(entry.max, resources.find(old => old.name === entry.name)?.used ?? 0) })) } })}>
        อัปเดตจำนวนตามเลเวลปัจจุบัน</button>}
    </section>

    <div className="rest-actions">
      <button type="button" disabled={inCombat} onClick={() => void send({ type: 'rest', actorId: actor.id, kind: 'short' })}>
        <Coffee size={15} aria-hidden="true" /> พักสั้น (Short Rest)</button>
      <button type="button" className="primary" disabled={!canRest} onClick={() => void send({ type: 'rest', actorId: actor.id, kind: 'long' })}>
        <BedDouble size={15} aria-hidden="true" /> พักยาว (Long Rest)</button>
    </div>
    <p className="sheet-note">พักยาว: HP เต็ม · Hit Dice และช่องเวทคืนทั้งหมด · Temp HP หาย · Exhaustion ลด 1 ระดับ</p>
  </div>
}
