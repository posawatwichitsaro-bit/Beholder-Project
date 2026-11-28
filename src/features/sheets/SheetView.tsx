import { useEffect, useState } from 'react'
import { ArrowBigUpDash, Copy, HeartPulse, Pencil, Shield, Footprints, Sparkles, Swords, Zap } from 'lucide-react'
import { abilities, sizes } from '../../../shared/model.ts'
import type { Ability, Actor, Scene, Snapshot } from '../../../shared/model.ts'
import { abilityModifier, bonusForCheck, commonSkills } from '../../../shared/characterStats.ts'
import type { Skill } from '../../../shared/characterStats.ts'
import type { Send } from '../../state/useCommand.ts'
import { HpBar, Tabs } from '../../ui/index.ts'
import { InventoryPanel } from '../objects/Inventory.tsx'
import { ConditionEditor } from '../combat/ConditionEditor.tsx'
import { SlotTracker } from './SlotTracker.tsx'
import { parseSlots } from '../../../shared/conditions.ts'
import { LevelUpDialog } from './LevelUpDialog.tsx'
import { carryingLoad } from '../../../shared/encumbrance.ts'
import { attackOdds, rollOdds, withinReach } from '../../../shared/advantage.ts'
import type { RollMode } from '../../../shared/advantage.ts'
import { rollMenuProps } from '../../ui/index.ts'
import { readyToLevel, srdLink, srdFeats, xpForLevel, characterLevel } from '../../../shared/progression.ts'
import { GiveXp } from '../combat/XpAward.tsx'
import { VisionFields } from './VisionFields.tsx'
import { RestPanel } from './RestPanel.tsx'
import { Spellbook } from '../spells/Spellbook.tsx'
import { inspirationDie } from '../../../shared/classFeatures.ts'
import { ClassFeatures } from './ClassFeatures.tsx'
import { DmNotes } from '../table/DmNotes.tsx'
import type { DrawArea } from '../spells/Spellbook.tsx'

type Tab = 'overview' | 'actions' | 'spells' | 'rest' | 'inventory' | 'notes'
type Mode = 'normal' | 'advantage' | 'disadvantage'
const signed = (value: number) => (value >= 0 ? '+' : '') + value

/**
 * A character or monster sheet in "view" mode: a parchment page with tabs.
 * Every number that can be rolled is a button — click STR to roll a STR check,
 * a weapon to attack with it. The roll options (advantage, proficiency, target,
 * cover) sit above and apply to the next roll. Editing opens SheetEditor.
 */
export function SheetView({ actor, scene, room, send, edit, copy, preferredTarget, chooseTarget, drawArea }: {
  actor: Actor; scene?: Scene; room: Snapshot; send: Send; edit: () => void; copy: () => void
  /** The creature picked on the board; it becomes this sheet's target when it is in the scene. */
  preferredTarget?: string
  chooseTarget?: (id: string) => void
  /** Place a spell's template on the board (area spells). */
  drawArea?: DrawArea
}) {
  const dm = room.me.role === 'dm'
  const xpRoom = room.settings?.advancement === 'xp'
  const overloaded = actor.kind === 'pc' && room.settings?.encumbrance !== false && carryingLoad(actor).over
  const [tab, setTab] = useState<Tab>('overview')
  const [levelling, setLevelling] = useState(false)
  const [mode, setMode] = useState<Mode>('normal')
  const [proficient, setProficient] = useState(false)
  const [target, setTarget] = useState('')
  const [cover, setCover] = useState(0)
  const [spellDamage, setSpellDamage] = useState('1d8')
  const [spellName, setSpellName] = useState('')
  const [saveAbility, setSaveAbility] = useState<Ability>('DEX')
  const [half, setHalf] = useState(false)
  const [healing, setHealing] = useState(1)
  const targets = sortTargets(actor, room, scene)
  useEffect(() => { if (preferredTarget) setTarget(preferredTarget) }, [preferredTarget])
  // Default: what you picked (here or on the board), else the nearest foe, else anyone.
  const targetId = targets.some(item => item.id === target) ? target : targets.find(item => item.foe)?.id ?? targets[0]?.id
  const onBoard = Boolean(scene?.tokens.some(token => token.actorId === actor.id))

  const slotLevels = parseSlots(actor.slots) ?? []
  // A leveled cast spends a slot: default to the lowest level still available; pick Cantrip for free casts.
  const [slotLevel, setSlotLevel] = useState<number>()
  // A Warlock multiclass casts from either pool: ordinary slots or Pact Magic.
  const pactLevels = parseSlots(actor.pactSlots ?? '') ?? []
  const [usePact, setUsePact] = useState(false)
  const lowest = (usePact ? pactLevels : slotLevels).find(slot => slot.left > 0)?.level ?? 0
  const castLevel = slotLevel !== undefined && (slotLevel === 0 || (usePact ? pactLevels : slotLevels).some(slot => slot.level === slotLevel && slot.left > 0)) ? slotLevel : lowest
  type RollExtra = { ability?: Ability; skill?: Skill; weaponIndex?: number; slotLevel?: number }
  /** A sheet roll. `chosen` comes from the right-click menu; otherwise the Mode toggle, else the conditions decide. */
  function roll(rollType: string, extra: RollExtra = {}, chosen?: RollMode, inspiration = false) {
    void send({
      ...(inspiration ? { inspiration: true } : {}),
      type: 'sheetRoll', rollType, actorId: actor.id, sceneId: scene?.id, targetId,
      ability: extra.ability ?? 'STR', skill: extra.skill, weaponIndex: extra.weaponIndex, slotLevel: extra.slotLevel || undefined,
      ...(chosen ? { rollMode: chosen } : { advantage: mode === 'advantage', disadvantage: mode === 'disadvantage' }),
      ...(usePact && extra.slotLevel ? { pact: true } : {}),
      proficient, cover, formula: spellDamage
    })
  }
  /** What the conditions suggest for this roll, shown in the right-click menu. */
  function oddsFor(rollType: string, ability?: Ability) {
    if (rollType === 'attack' || rollType === 'spellAttack') {
      const target = room.publicActors.find(item => item.id === targetId)
      const mine = scene?.tokens.find(token => token.actorId === actor.id)
      const theirs = scene?.tokens.find(token => token.actorId === targetId)
      const reach = Boolean(mine && theirs && target && withinReach(mine, sizes[actor.size], theirs, sizes[target.size]))
      return attackOdds(actor, target, reach)
    }
    return rollOdds(actor, rollType === 'initiative' ? 'initiative' : rollType === 'save' ? 'save' : 'check', ability)
  }
  const menu = (rollType: string, extra: RollExtra = {}) =>
    rollMenuProps((chosen, inspiration) => roll(rollType, extra, chosen, inspiration), { odds: () => oddsFor(rollType, extra.ability), title: actor.name, inspiration: () => inspirationDie(actor) })
  const saveBonus = (key: Ability) => {
    const saved = actor.savingThrows?.[key]
    return saved ? bonusForCheck(actor, saved) : abilityModifier(actor.abilities[key])
  }
  // Every skill can be rolled; trained ones show their real bonus and stand out.
  const skills = Object.keys(commonSkills) as Skill[]
  const skillBonus = (key: Skill) => {
    const trained = actor.skillChecks?.[key]
    return trained ? bonusForCheck(actor, trained) : abilityModifier(actor.abilities[commonSkills[key]])
  }
  const attacks = actor.attacks ?? []

  const rollOptions = <div className="sheet-roll-options" role="group" aria-label="ตัวเลือกการทอย">
    <div className="sheet-segment" role="group" aria-label="ได้เปรียบหรือเสียเปรียบ">
      {([['normal', 'ปกติ'], ['advantage', 'Advantage'], ['disadvantage', 'Disadvantage']] as const).map(([id, label]) =>
        <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)}>{label}</button>)}
    </div>
    <label className="sheet-toggle"><input type="checkbox" checked={proficient} onChange={event => setProficient(event.target.checked)} />Proficient</label>
  </div>
  const targeting = <div className="sheet-targeting">
    <label>เป้าหมาย<select aria-label="เป้าหมายการโจมตี" value={targetId ?? ''} onChange={event => { setTarget(event.target.value); chooseTarget?.(event.target.value) }}>
      {targets.length === 0 && <option value="">ไม่มีเป้าหมายในฉาก</option>}
      {targets.some(item => item.foe) && <optgroup label="ศัตรู">{targets.filter(item => item.foe).map(item =>
        <option key={item.id} value={item.id}>{item.name}{item.feet !== undefined ? ' · ' + item.feet + ' ft.' : ''}{item.down ? ' · หมดสติ' : ''}</option>)}</optgroup>}
      {targets.some(item => !item.foe) && <optgroup label="พันธมิตร">{targets.filter(item => !item.foe).map(item =>
        <option key={item.id} value={item.id}>{item.name}{item.feet !== undefined ? ' · ' + item.feet + ' ft.' : ''}</option>)}</optgroup>}
    </select></label>
    <label>ที่กำบังของเป้าหมาย<select aria-label="ที่กำบังของเป้าหมาย" value={cover} onChange={event => setCover(Number(event.target.value))}>
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
        <span>{[actor.classLevel, actor.subclass, actor.kind === 'monster' ? 'Monster' : '', actor.life === 'active' ? '' : actor.life].filter(Boolean).join(' · ')}</span>
        {xpRoom && actor.kind === 'pc' && <span className="sheet-xp">{(actor.xp ?? 0).toLocaleString()} XP
          {characterLevel(actor) < 20 && <> / {xpForLevel[Math.max(1, characterLevel(actor))].toLocaleString()}</>}
          {readyToLevel(actor) && <b className="sheet-level-ready">เลื่อนระดับได้</b>}</span>}
        {actor.feats?.length ? <span className="sheet-feats">{actor.feats.map(name => {
          const feat = srdFeats.find(entry => entry.name === name)
          return <a key={name} href={srdLink} target="_blank" rel="noreferrer" title={feat ? feat.summary + (feat.automatic ? ' · คิดให้แล้ว: ' + feat.automatic : '') : undefined}>{name}</a>
        })}</span> : null}
      </div>
      <div className="sheet-head-actions">
        <button type="button" className="sheet-icon" onClick={edit} aria-label="แก้ชีต" title="แก้ชีต (เปิดโหมดแก้ไขและตัวคำนวณ D&D)"><Pencil size={16} aria-hidden="true" /></button>
        {actor.kind === 'pc' && actor.calculations?.hp && <button type="button" className={'sheet-icon' + (xpRoom && readyToLevel(actor) ? ' sheet-level-glow' : '')} onClick={() => setLevelling(true)} aria-label="เลเวลอัป" title="เลเวลอัป">
          <ArrowBigUpDash size={16} aria-hidden="true" /></button>}
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
      <button type="button" className="sheet-stat sheet-rollable" {...menu('initiative')} onClick={() => roll('initiative')} aria-label={'ทอย Initiative ' + signed(actor.initiative)}>
        <Zap size={14} aria-hidden="true" /><b>{signed(actor.initiative)}</b><span>Init</span></button>
      <div className="sheet-stat" title={overloaded ? 'แบกเกินพิกัด · Speed ปกติ ' + actor.speed + ' ft' : undefined}><Footprints size={14} aria-hidden="true" /><b className={overloaded ? 'carry-over' : undefined}>{overloaded ? 5 : actor.speed}</b><span>ฟุต</span></div>
      <div className="sheet-stat"><b>{signed(actor.proficiency)}</b><span>Prof</span></div>
      <div className="sheet-conditions"><ConditionEditor actor={actor} send={send} /></div>
    </section>

    {rollOptions}

    <Tabs label="หน้าชีต" value={tab} onChange={setTab} items={[
      { id: 'overview', label: 'ภาพรวม' }, { id: 'actions', label: 'Actions' }, { id: 'spells', label: 'Spells' },
      ...(actor.kind === 'pc' ? [{ id: 'rest' as const, label: 'Rest' }] : []), { id: 'inventory', label: 'Inventory' }, { id: 'notes', label: 'Notes' }
    ]} />

    <div className="sheet-page" role="tabpanel">
      {tab === 'overview' && <>
        <div className="sheet-abilities">
          {abilities.map(key => {
            const modifier = abilityModifier(actor.abilities[key])
            return <div className="sheet-ability" key={key}>
              <button type="button" className="sheet-ability-check" {...menu('check', { ability: key })} onClick={() => roll('check', { ability: key })} aria-label={key + ' check'}
                title={'ทอย ' + key + ' check'}>
                <span className="sheet-ability-key">{key}</span>
                <b>{signed(modifier)}</b>
                <span className="sheet-ability-score">{actor.abilities[key]}</span>
              </button>
              <button type="button" className="sheet-ability-save" {...menu('save', { ability: key })} onClick={() => roll('save', { ability: key })} aria-label={key + ' save'}
                title={'ทอย ' + key + ' saving throw'}>Save {signed(saveBonus(key))}</button>
            </div>
          })}
        </div>
        <div className="sheet-skills" aria-label="ทักษะ">
          {skills.map(key => <button type="button" key={key} data-trained={actor.skillChecks?.[key] ? 'true' : undefined}
            {...menu('check', { ability: commonSkills[key], skill: key })} onClick={() => roll('check', { ability: commonSkills[key], skill: key })} aria-label={key + ' check'}
            title={key + ' (' + commonSkills[key] + ')' + (actor.skillChecks?.[key] ? ' · ชำนาญ' : '')}>
            <span>{key}<small>{commonSkills[key]}</small></span><b>{signed(skillBonus(key))}</b></button>)}
        </div>
        {!actor.skillChecks && actor.skills && <p className="sheet-note">ทักษะ · {actor.skills}</p>}
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
            <button type="button" disabled={!targetId || !onBoard} {...menu('attack')} onClick={() => roll('attack')} aria-label="Attack การโจมตีหลัก">{signed(actor.attack)} โจมตี</button>
            <button type="button" onClick={() => roll('damage')} aria-label="Damage การโจมตีหลัก">{actor.damage}</button>
          </div>
          {attacks.map((attack, index) => <div className="sheet-attack" key={index}>
            <span className="sheet-attack-name"><Swords size={14} aria-hidden="true" /> {attack.name}{attack.notes && <small>{attack.notes}</small>}</span>
            <button type="button" disabled={!targetId || !onBoard} {...menu('attack', { weaponIndex: index })} onClick={() => roll('attack', { weaponIndex: index })} aria-label={'Attack ' + attack.name}>{signed(attack.bonus)} โจมตี</button>
            <button type="button" onClick={() => roll('damage', { weaponIndex: index })} aria-label={'Damage ' + attack.name}>{attack.damage}</button>
          </div>)}
        </div>
        {!onBoard && <p className="sheet-note">วาง Token ของตัวละครนี้ในฉากก่อนจึงจะโจมตีได้</p>}
        <ClassFeatures actor={actor} send={send} friends={targets.filter(item => !item.foe)} />
        <button type="button" className="sheet-wide" {...menu('initiative')} onClick={() => roll('initiative')}>ทอย Initiative {signed(actor.initiative)}</button>
      </>}

      {tab === 'spells' && <>
        <div className="sheet-spell-stats">
          <div className="sheet-stat"><Sparkles size={14} aria-hidden="true" /><b>{signed(actor.spellAttack)}</b><span>Spell attack</span></div>
          <div className="sheet-stat"><b>{actor.spellDC}</b><span>Spell DC</span></div>
        </div>
        {targeting}
        <Spellbook actor={actor} room={room} scene={scene} send={send} targets={targets} targetId={targetId} drawArea={drawArea} />
        <details className="sheet-manual-cast">
          <summary>เวทนอกคลัง (กรอกเอง)</summary>
        <label className="sheet-slot-pick">ใช้ช่องเวท<select aria-label="ใช้ช่องเวท" value={(usePact ? 'p' : '') + castLevel} onChange={event => {
          const value = event.target.value
          setUsePact(value.startsWith('p'))
          setSlotLevel(Number(value.replace('p', '')))
        }}>
          <option value={0}>Cantrip / ไม่ใช้ช่อง</option>
          {slotLevels.map(slot => <option key={slot.level} value={slot.level} disabled={slot.left < 1}>ระดับ {slot.level} (เหลือ {slot.left}/{slot.max})</option>)}
          {pactLevels.map(slot => <option key={'p' + slot.level} value={'p' + slot.level} disabled={slot.left < 1}>Pact ระดับ {slot.level} (เหลือ {slot.left}/{slot.max})</option>)}
        </select></label>
        <div className="sheet-inline">
          <label>สูตร Spell Damage<input value={spellDamage} onChange={event => setSpellDamage(event.target.value)} /></label>
          <button type="button" disabled={!targetId} {...menu('spellAttack', { slotLevel: castLevel })} onClick={() => roll('spellAttack', { slotLevel: castLevel })}>Spell Attack</button>
        </div>
        <form className="sheet-cast" onSubmit={event => {
          event.preventDefault()
          void send({ type: 'castSave', actorId: actor.id, targetId, sceneId: scene?.id, ability: saveAbility, label: spellName, half, formula: spellDamage, slotLevel: castLevel || undefined, ...(usePact && castLevel ? { pact: true } : {}) })
        }}>
          <h3>เวทที่ให้เป้าหมายทอย Save</h3>
          <label>ชื่อเวท<input value={spellName} onChange={event => setSpellName(event.target.value)} placeholder="เช่น Fireball" /></label>
          <label>Save ด้วย<select value={saveAbility} onChange={event => setSaveAbility(event.target.value as Ability)}>
            {abilities.map(key => <option key={key}>{key}</option>)}</select></label>
          <label className="sheet-toggle"><input type="checkbox" checked={half} onChange={event => setHalf(event.target.checked)} />ผ่านแล้วรับความเสียหายครึ่งหนึ่ง</label>
          <button disabled={!targetId || !spellName.trim()}>ขอ {saveAbility} Save · DC {actor.spellDC}</button>
        </form>
        </details>
        {actor.spells && <p className="sheet-note">โน้ตเวท / ความสามารถ · {actor.spells}</p>}
        <SlotTracker key={actor.slots} actor={actor} send={send} />
        {actor.pactSlots && <SlotTracker key={'pact' + actor.pactSlots} actor={actor} send={send} pact />}
      </>}

      {tab === 'overview' && dm && xpRoom && actor.kind === 'pc' && <GiveXp actorId={actor.id} send={send} />}
      {tab === 'overview' && <VisionFields key={actor.id + JSON.stringify(actor.vision ?? null)} actor={actor} dm={dm} send={send} />}
      {tab === 'rest' && <RestPanel actor={actor} send={send} inCombat={room.scenes.some(item => item.combat?.order.some(entry => entry.actorId === actor.id))} />}
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
        {dm && <DmNotes key={actor.id + (actor.dmNotes ?? '')} notes={actor.dmNotes} label="โน้ตลับของ DM" send={send} target={{ actorId: actor.id }} />}
      </div>}
    </div>
    {levelling && <LevelUpDialog actor={actor} send={send} close={() => setLevelling(false)} />}
  </article>
}

/**
 * Everyone this sheet could target in the scene: foes (the other side) first,
 * nearest first, with the distance in feet (5 ft. per square, diagonals count as one).
 */
function sortTargets(actor: Actor, room: Snapshot, scene?: Scene) {
  const own = scene?.tokens.find(token => token.actorId === actor.id)
  return room.publicActors.flatMap(item => {
    const token = scene?.tokens.find(entry => entry.actorId === item.id)
    if (item.id === actor.id || !token) return []
    const feet = own ? 5 * Math.max(Math.abs(token.x - own.x), Math.abs(token.y - own.y)) : undefined
    return [{ id: item.id, name: item.name, foe: (item.kind === 'monster') !== (actor.kind === 'monster'), down: item.hp === 0, feet }]
  }).sort((a, b) => Number(b.foe) - Number(a.foe) || Number(a.down) - Number(b.down) || (a.feet ?? 0) - (b.feet ?? 0) || a.name.localeCompare(b.name))
}
