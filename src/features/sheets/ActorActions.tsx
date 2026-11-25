import { useState } from 'react'
import { abilities } from '../../../shared/model.ts'
import type { Actor, Scene, Snapshot } from '../../../shared/model.ts'
import { bonusForCheck, commonSkills } from '../../../shared/characterStats.ts'
import type { Skill } from '../../../shared/characterStats.ts'
import type { Send } from '../../state/useCommand.ts'

export function ActorActions({ actor, scene, room, send, combatTarget }: { actor: Actor; scene?: Scene; room: Snapshot; send: Send; combatTarget?: string }) {
  const compact = combatTarget !== undefined
  const [target, setTarget] = useState('')
  const [advantage, setAdvantage] = useState(false)
  const [disadvantage, setDisadvantage] = useState(false)
  const [proficient, setProficient] = useState(false)
  const [ability, setAbility] = useState('STR')
  const [skill, setSkill] = useState('')
  const [cover, setCover] = useState(0)
  const [spellDamage, setSpellDamage] = useState('1d8')
  const [spellName, setSpellName] = useState('')
  const [half, setHalf] = useState(false)
  const [weapon, setWeapon] = useState('')
  const [healing, setHealing] = useState(1)
  const [slots, setSlots] = useState(actor.slots)
  const targets = room.publicActors.filter(item => item.id !== actor.id && scene?.tokens.some(token => token.actorId === item.id))
  const targetId = compact ? combatTarget : targets.some(item => item.id === target) ? target : targets[0]?.id
  function roll(rollType: string) {
    const weaponIndex = (rollType === 'attack' || rollType === 'damage') && weapon !== '' && actor.attacks?.[Number(weapon)] ? Number(weapon) : undefined
    void send({ type: 'sheetRoll', rollType, actorId: actor.id, sceneId: scene?.id, targetId, ability,
      skill: rollType === 'check' ? skill : undefined, advantage, disadvantage, proficient, cover, formula: spellDamage, weaponIndex })
  }
  return <div className="actor-actions">
    {!compact && <><div className="stat-row"><span><b>{actor.hp}/{actor.maxHp}</b> HP</span><span><b>{actor.ac}</b> AC</span><span><b>{actor.tempHp}</b> Temp</span></div>
    <div className="ability-row">{abilities.map(key => <span key={key}>{key} <b>{actor.abilities[key]}</b></span>)}</div>
    <p className="muted">{[actor.classLevel, actor.speed + ' ฟุต', actor.conditions, actor.life === 'active' ? '' : actor.life].filter(Boolean).join(' · ')}</p>
    {(actor.skills || actor.saves || actor.spells) && <p className="muted">{[
      Object.keys(actor.skillChecks ?? {}).length ? '' : actor.skills,
      Object.keys(actor.savingThrows ?? {}).length ? '' : actor.saves, actor.spells
    ].filter(Boolean).join(' · ')}</p>}</>}
    {Object.keys(actor.skillChecks ?? {}).length > 0 && <label>เลือกทักษะสำหรับ Check<select value={skill} onChange={event => setSkill(event.target.value)}>
      <option value="">ใช้ค่าความสามารถด้านล่าง</option>
      {(Object.keys(commonSkills) as Skill[]).map(key => {
        const structured = actor.skillChecks?.[key]
        const bonus = structured && bonusForCheck(actor, structured)
        return <option key={key} value={key}>{key}{bonus !== undefined ? ' (' + (bonus >= 0 ? '+' : '') + bonus + ')' : ''}</option>
      })}
    </select></label>}
    <div className="inline">
      <select aria-label="ค่าความสามารถ" value={ability} onChange={e => setAbility(e.target.value)}>{abilities.map(key => {
        const saved = actor.savingThrows?.[key]
        const bonus = saved && bonusForCheck(actor, saved)
        return <option key={key} value={key}>{key}{bonus !== undefined ? ' · Save ' + (bonus >= 0 ? '+' : '') + bonus : ''}</option>
      })}</select>
      <button onClick={() => roll('check')}>Check</button><button onClick={() => roll('save')}>Save</button>
      {!compact && <button onClick={() => roll('initiative')}>Initiative</button>}
    </div>
    <div className="checks">
      <label><input type="checkbox" checked={proficient} onChange={e => setProficient(e.target.checked)} />Proficient</label>
      <label><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Adv.</label>
      <label><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Disadv.</label>
    </div>
    <div className="inline">
      {!compact && <select aria-label="เป้าหมาย" value={targetId ?? ''} onChange={e => setTarget(e.target.value)}>
        {targets.length === 0 && <option value="">ไม่มีเป้าหมาย</option>}
        {targets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>}
      <select aria-label="ที่กำบังของเป้าหมาย" value={cover} onChange={e => setCover(Number(e.target.value))}>
        <option value={0}>ไม่มี Cover</option><option value={2}>Half Cover</option><option value={5}>¾ Cover</option>
      </select>
    </div>
    {!compact && !!actor.attacks?.length && <select aria-label="เลือกรายการโจมตี" value={weapon} onChange={e => setWeapon(e.target.value)}>
      <option value="">การโจมตีหลัก</option>
      {actor.attacks.map((item, index) => <option value={index} key={index}>{item.name}</option>)}
    </select>}
    {!compact && <div className="inline"><button disabled={!targetId || !scene?.tokens.some(token => token.actorId === actor.id)} onClick={() => roll('attack')}>Attack</button>
      <button onClick={() => roll('damage')}>Damage</button></div>}
    <div className="inline"><input aria-label="สูตร Spell Damage" value={spellDamage} onChange={e => setSpellDamage(e.target.value)} />
      <button disabled={!targetId} onClick={() => roll('spellAttack')}>Spell Attack</button></div>
    <details className="spell-save"><summary>เวทที่ให้เป้าหมายทอย Save</summary>
      <label>ชื่อเวท<input value={spellName} onChange={event => setSpellName(event.target.value)} /></label>
      <label className="inline"><input type="checkbox" checked={half} onChange={event => setHalf(event.target.checked)} />ผ่านแล้วรับความเสียหายครึ่งหนึ่ง</label>
      <button disabled={!targetId || !spellName.trim()} onClick={() => void send({
        type: 'castSave', actorId: actor.id, targetId, sceneId: scene?.id, ability, label: spellName, half, formula: spellDamage
      })}>ขอ {ability} Save · DC {actor.spellDC}</button>
    </details>
    <div className="inline"><input aria-label="ช่องเวท" placeholder="ช่องเวทคงเหลือ" value={slots} onChange={e => setSlots(e.target.value)} />
      <button onClick={() => void send({ type: 'slots', slots, actorId: actor.id })}>บันทึก</button></div>
    <p className="muted">Spell DC {actor.spellDC}</p>
    {!compact && actor.hp === 0 && <div className="inline"><span>Death saves {actor.successes} ✓ / {actor.failures} ×</span>
      {actor.life === 'dying' && <button onClick={() => roll('death')}>ทอย</button>}</div>}
    {!compact && room.me.role === 'dm' && <div className="inline"><input aria-label="HP ที่รักษา" type="number" min="1" value={healing} onChange={e => setHealing(e.target.valueAsNumber)} />
      <button onClick={() => void send({ type: 'heal', actorId: actor.id, amount: healing })}>รักษา</button></div>}
  </div>
}
