import { useState } from 'react'
import { Copy, HeartPulse, Pencil, Shield, Footprints, Sparkles, Swords, Zap } from 'lucide-react'
import { abilities } from '../../../shared/model.ts'
import type { Ability, Actor, Scene, Snapshot } from '../../../shared/model.ts'
import { abilityModifier, bonusForCheck, commonSkills } from '../../../shared/characterStats.ts'
import type { Skill } from '../../../shared/characterStats.ts'
import type { Send } from '../../state/useCommand.ts'
import { HpBar, Tabs } from '../../ui/index.ts'
import { InventoryPanel } from '../objects/Inventory.tsx'

type Tab = 'overview' | 'actions' | 'spells' | 'inventory' | 'notes'
type Mode = 'normal' | 'advantage' | 'disadvantage'
const signed = (value: number) => (value >= 0 ? '+' : '') + value

/**
 * A character or monster sheet in "view" mode: a parchment page with tabs.
 * Every number that can be rolled is a button — click STR to roll a STR check,
 * a weapon to attack with it. The roll options (advantage, proficiency, target,
 * cover) sit above and apply to the next roll. Editing opens SheetEditor.
 */
export function SheetView({ actor, scene, room, send, edit, copy }: {
  actor: Actor; scene?: Scene; room: Snapshot; send: Send; edit: () => void; copy: () => void
}) {
  const dm = room.me.role === 'dm'
  const [tab, setTab] = useState<Tab>('overview')
  const [mode, setMode] = useState<Mode>('normal')
  const [proficient, setProficient] = useState(false)
  const [target, setTarget] = useState('')
  const [cover, setCover] = useState(0)
  const [spellDamage, setSpellDamage] = useState('1d8')
  const [spellName, setSpellName] = useState('')
  const [saveAbility, setSaveAbility] = useState<Ability>('DEX')
  const [half, setHalf] = useState(false)
  const [slots, setSlots] = useState(actor.slots)
  const [healing, setHealing] = useState(1)
  const targets = room.publicActors.filter(item => item.id !== actor.id && scene?.tokens.some(token => token.actorId === item.id))
  const targetId = targets.some(item => item.id === target) ? target : targets[0]?.id
  const onBoard = Boolean(scene?.tokens.some(token => token.actorId === actor.id))

  function roll(rollType: string, extra: { ability?: Ability; skill?: Skill; weaponIndex?: number } = {}) {
    void send({
      type: 'sheetRoll', rollType, actorId: actor.id, sceneId: scene?.id, targetId,
      ability: extra.ability ?? 'STR', skill: extra.skill, weaponIndex: extra.weaponIndex,
      advantage: mode === 'advantage', disadvantage: mode === 'disadvantage', proficient, cover, formula: spellDamage
    })
  }
  const saveBonus = (key: Ability) => {
    const saved = actor.savingThrows?.[key]
    return saved ? bonusForCheck(actor, saved) : abilityModifier(actor.abilities[key])
  }
  const skills = (Object.keys(commonSkills) as Skill[]).filter(key => actor.skillChecks?.[key])
  const conditions = actor.conditions.split(/[,،]/).map(value => value.trim()).filter(Boolean)
  const attacks = actor.attacks ?? []

  const rollOptions = <div className="sheet-roll-options" role="group" aria-label="ตัวเลือกการทอย">
    <div className="sheet-segment" role="group" aria-label="ได้เปรียบหรือเสียเปรียบ">
      {([['normal', 'ปกติ'], ['advantage', 'Advantage'], ['disadvantage', 'Disadvantage']] as const).map(([id, label]) =>
        <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)}>{label}</button>)}
    </div>
    <label className="sheet-toggle"><input type="checkbox" checked={proficient} onChange={event => setProficient(event.target.checked)} />Proficient</label>
  </div>
  const targeting = <div className="sheet-targeting">
    <label>เป้าหมาย<select value={targetId ?? ''} onChange={event => setTarget(event.target.value)}>
      {targets.length === 0 && <option value="">ไม่มีเป้าหมายในฉาก</option>}
      {targets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <label>ที่กำบังของเป้าหมาย<select value={cover} onChange={event => setCover(Number(event.target.value))}>
      <option value={0}>ไม่มี Cover</option><option value={2}>Half Cover (+2)</option><option value={5}>¾ Cover (+5)</option>
    </select></label>
  </div>

  return <article className="sheet-view bh-on-parchment" aria-label={'ชีต ' + actor.name}>
    <header className="sheet-head">
      <span className="sheet-portrait" aria-hidden="true">
        {actor.portrait ? <img src={actor.portrait} alt="" /> : actor.name.slice(0, 2)}
      </span>
      <div className="sheet-title">
        <h2>{actor.name}</h2>
        <span>{[actor.classLevel, actor.kind === 'monster' ? 'Monster' : '', actor.life === 'active' ? '' : actor.life].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="sheet-head-actions">
        <button type="button" className="sheet-icon" onClick={edit} aria-label="แก้ชีต" title="แก้ชีต (เปิดโหมดแก้ไขและตัวคำนวณ D&D)"><Pencil size={16} aria-hidden="true" /></button>
        <button type="button" className="sheet-icon" onClick={copy} aria-label="คัดลอกเข้าคลังส่วนตัว" title="คัดลอกเข้าคลังส่วนตัว"><Copy size={16} aria-hidden="true" /></button>
      </div>
    </header>

    <section className="sheet-vitals" aria-label="ค่าหลัก">
      <div className="sheet-hp">
        <div className="sheet-hp-line">
          <HeartPulse size={16} aria-hidden="true" />
          <span className="sheet-hp-text">{actor.hp}/{actor.maxHp}</span>
          <span className="sheet-hp-label">HP</span>
          {actor.tempHp > 0 && <span className="sheet-temp">+{actor.tempHp} Temp</span>}
        </div>
        <HpBar hp={actor.hp} max={actor.maxHp} temp={actor.tempHp} side={actor.kind === 'monster' ? 'foe' : 'ally'} label={'HP ของ ' + actor.name} surface="parchment" height={10} />
      </div>
      <div className="sheet-stat"><Shield size={14} aria-hidden="true" /><b>{actor.ac}</b><span>AC</span></div>
      <button type="button" className="sheet-stat sheet-rollable" onClick={() => roll('initiative')} aria-label={'ทอย Initiative ' + signed(actor.initiative)}>
        <Zap size={14} aria-hidden="true" /><b>{signed(actor.initiative)}</b><span>Init</span></button>
      <div className="sheet-stat"><Footprints size={14} aria-hidden="true" /><b>{actor.speed}</b><span>ฟุต</span></div>
      <div className="sheet-stat"><b>{signed(actor.proficiency)}</b><span>Prof</span></div>
      {conditions.length > 0 && <div className="sheet-conditions">{conditions.map(item => <span key={item} className="bh-chip" data-active="true">{item}</span>)}</div>}
    </section>

    {rollOptions}

    <Tabs label="หน้าชีต" value={tab} onChange={setTab} items={[
      { id: 'overview', label: 'ภาพรวม' }, { id: 'actions', label: 'Actions' }, { id: 'spells', label: 'Spells' },
      { id: 'inventory', label: 'Inventory' }, { id: 'notes', label: 'Notes' }
    ]} />

    <div className="sheet-page" role="tabpanel">
      {tab === 'overview' && <>
        <div className="sheet-abilities">
          {abilities.map(key => {
            const modifier = abilityModifier(actor.abilities[key])
            return <div className="sheet-ability" key={key}>
              <button type="button" className="sheet-ability-check" onClick={() => roll('check', { ability: key })} aria-label={key + ' check'}
                title={'ทอย ' + key + ' check'}>
                <span className="sheet-ability-key">{key}</span>
                <b>{signed(modifier)}</b>
                <span className="sheet-ability-score">{actor.abilities[key]}</span>
              </button>
              <button type="button" className="sheet-ability-save" onClick={() => roll('save', { ability: key })} aria-label={key + ' save'}
                title={'ทอย ' + key + ' saving throw'}>Save {signed(saveBonus(key))}</button>
            </div>
          })}
        </div>
        {skills.length > 0 ? <div className="sheet-skills" aria-label="ทักษะ">
          {skills.map(key => <button type="button" key={key} onClick={() => roll('check', { ability: commonSkills[key], skill: key })} aria-label={key + ' check'}>
            <span>{key}</span><b>{signed(bonusForCheck(actor, actor.skillChecks![key]!))}</b></button>)}
        </div> : actor.skills && <p className="sheet-note">ทักษะ · {actor.skills}</p>}
        {actor.hp === 0 && <div className="sheet-death">
          <span>Death saves <b>{actor.successes}</b> สำเร็จ · <b>{actor.failures}</b> ล้มเหลว</span>
          {actor.life === 'dying' && <button type="button" className="primary" onClick={() => roll('death')}>ทอย Death Save</button>}
        </div>}
        {dm && <form className="sheet-heal" onSubmit={event => { event.preventDefault(); void send({ type: 'heal', actorId: actor.id, amount: healing }) }}>
          <label>HP ที่รักษา<input type="number" min={1} value={healing} onChange={event => setHealing(event.target.valueAsNumber)} /></label>
          <button>รักษา</button>
        </form>}
      </>}

      {tab === 'actions' && <>
        {targeting}
        <div className="sheet-attacks">
          <div className="sheet-attack">
            <span className="sheet-attack-name"><Swords size={14} aria-hidden="true" /> การโจมตีหลัก</span>
            <button type="button" disabled={!targetId || !onBoard} onClick={() => roll('attack')} aria-label="Attack การโจมตีหลัก">{signed(actor.attack)} โจมตี</button>
            <button type="button" onClick={() => roll('damage')} aria-label="Damage การโจมตีหลัก">{actor.damage}</button>
          </div>
          {attacks.map((attack, index) => <div className="sheet-attack" key={index}>
            <span className="sheet-attack-name"><Swords size={14} aria-hidden="true" /> {attack.name}{attack.notes && <small>{attack.notes}</small>}</span>
            <button type="button" disabled={!targetId || !onBoard} onClick={() => roll('attack', { weaponIndex: index })} aria-label={'Attack ' + attack.name}>{signed(attack.bonus)} โจมตี</button>
            <button type="button" onClick={() => roll('damage', { weaponIndex: index })} aria-label={'Damage ' + attack.name}>{attack.damage}</button>
          </div>)}
        </div>
        {!onBoard && <p className="sheet-note">วาง Token ของตัวละครนี้ในฉากก่อนจึงจะโจมตีได้</p>}
        <button type="button" className="sheet-wide" onClick={() => roll('initiative')}>ทอย Initiative {signed(actor.initiative)}</button>
      </>}

      {tab === 'spells' && <>
        <div className="sheet-spell-stats">
          <div className="sheet-stat"><Sparkles size={14} aria-hidden="true" /><b>{signed(actor.spellAttack)}</b><span>Spell attack</span></div>
          <div className="sheet-stat"><b>{actor.spellDC}</b><span>Spell DC</span></div>
        </div>
        {targeting}
        <div className="sheet-inline">
          <label>สูตร Spell Damage<input value={spellDamage} onChange={event => setSpellDamage(event.target.value)} /></label>
          <button type="button" disabled={!targetId} onClick={() => roll('spellAttack')}>Spell Attack</button>
        </div>
        <form className="sheet-cast" onSubmit={event => {
          event.preventDefault()
          void send({ type: 'castSave', actorId: actor.id, targetId, sceneId: scene?.id, ability: saveAbility, label: spellName, half, formula: spellDamage })
        }}>
          <h3>เวทที่ให้เป้าหมายทอย Save</h3>
          <label>ชื่อเวท<input value={spellName} onChange={event => setSpellName(event.target.value)} placeholder="เช่น Fireball" /></label>
          <label>Save ด้วย<select value={saveAbility} onChange={event => setSaveAbility(event.target.value as Ability)}>
            {abilities.map(key => <option key={key}>{key}</option>)}</select></label>
          <label className="sheet-toggle"><input type="checkbox" checked={half} onChange={event => setHalf(event.target.checked)} />ผ่านแล้วรับความเสียหายครึ่งหนึ่ง</label>
          <button disabled={!targetId || !spellName.trim()}>ขอ {saveAbility} Save · DC {actor.spellDC}</button>
        </form>
        {actor.spells && <p className="sheet-note">เวท / ความสามารถ · {actor.spells}</p>}
        <form className="sheet-inline" onSubmit={event => { event.preventDefault(); void send({ type: 'slots', slots, actorId: actor.id }) }}>
          <label>ช่องเวท<input value={slots} placeholder="ช่องเวทคงเหลือ" onChange={event => setSlots(event.target.value)} /></label>
          <button>บันทึก</button>
        </form>
      </>}

      {tab === 'inventory' && <InventoryPanel key={actor.id} actor={actor} send={send} expanded />}

      {tab === 'notes' && <div className="sheet-notes">
        {actor.characterDetails?.species && <p><b>Species</b> · {actor.characterDetails.species}</p>}
        {actor.characterDetails?.background && <p><b>Background</b> · {actor.characterDetails.background}</p>}
        {actor.characterDetails?.hitDice && <p><b>Hit Dice</b> · {actor.characterDetails.hitDice}</p>}
        {actor.characterDetails?.defenses && <p><b>Defenses</b> · {actor.characterDetails.defenses}</p>}
        {actor.skills && <p><b>ทักษะ</b> · {actor.skills}</p>}
        {actor.saves && <p><b>Saving throws</b> · {actor.saves}</p>}
        {actor.monsterReference && <details open><summary>Stat block{actor.monsterReference.page && ' · SRD หน้า ' + actor.monsterReference.page}</summary>
          <p className="stat-block">{actor.monsterReference.statBlock}</p></details>}
        {!actor.characterDetails && !actor.skills && !actor.saves && !actor.monsterReference && <p className="sheet-note">ยังไม่มีบันทึก · เพิ่มได้จากปุ่มแก้ชีต</p>}
      </div>}
    </div>
  </article>
}
