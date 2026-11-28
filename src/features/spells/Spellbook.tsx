import { useState } from 'react'
import { Sparkles, Trash2 } from 'lucide-react'
import type { Actor, KnownSpell, Scene, Snapshot } from '../../../shared/model.ts'
import { parseSlots } from '../../../shared/conditions.ts'
import { characterLevel } from '../../../shared/progression.ts'
import { areaFor, scaledDice, scalesCleanly, spellLimits, spellsInText } from '../../../shared/spells.ts'
import type { Spell } from '../../../shared/spells.ts'
import type { Area } from '../../../shared/area.ts'
import type { Send } from '../../state/useCommand.ts'
import { levelName, useSpellCatalog } from './catalog.ts'
import { SpellDetails, SpellPicker } from './SpellPicker.tsx'

export type SpellTarget = { id: string; name: string; foe: boolean; down?: boolean; feet?: number }
/** Ask the board for a spell's template; `done` gets the area once it is placed. */
export type DrawArea = (shape: { kind: Area['kind']; squares: number; label: string }, done: (area: Area) => void) => void

const signed = (value: number) => (value >= 0 ? '+' : '') + value

/**
 * The sheet's SRD spells (0.13): cantrips and prepared spells by level, each
 * with its text and a "ร่าย" button. The owner and the DM add, prepare and
 * remove spells; going past the class table's count is only a warning.
 */
export function Spellbook({ actor, room, scene, send, targets, targetId, drawArea }: {
  actor: Actor; room: Snapshot; scene?: Scene; send: Send
  targets: SpellTarget[]; targetId?: string; drawArea?: DrawArea
}) {
  const { spells, error, retry } = useSpellCatalog()
  const [picking, setPicking] = useState(false)
  const [open, setOpen] = useState<string>()
  const [casting, setCasting] = useState<string>()
  const canEdit = room.me.role === 'dm' || actor.ownerId === room.me.id
  const book = actor.spellbook ?? []
  if (error) return <p role="alert">{error} <button type="button" onClick={retry}>ลองอีกครั้ง</button></p>
  if (!spells) return <p className="sheet-note">กำลังเปิดคลังเวท…</p>
  const byId = new Map(spells.map(spell => [spell.id, spell]))
  const entries = book.flatMap(entry => { const spell = byId.get(entry.id); return spell ? [{ entry, spell }] : [] })
    .sort((a, b) => a.spell.level - b.spell.level || a.spell.name.localeCompare(b.spell.name))
  const save = (next: KnownSpell[]) => send({ type: 'spellbook', actorId: actor.id, spellbook: next })
  const limits = actor.kind === 'pc' ? spellLimits(actor.classLevel) : undefined
  const prepared = entries.filter(({ entry, spell }) => spell.level > 0 && entry.prepared).length
  const cantrips = entries.filter(({ spell }) => spell.level === 0).length
  const fromText = actor.spells ? spellsInText(actor.spells, spells).filter(id => !book.some(entry => entry.id === id)) : []
  const fighting = room.scenes.some(item => item.combat?.order.some(entry => entry.actorId === actor.id))

  return <section className="spellbook" aria-label="เวทในชีต">
    <div className="spellbook-head">
      <h3>เวท</h3>
      {limits && <span className="spellbook-counts">
        <span data-over={cantrips > limits.cantrips || undefined}>Cantrip {cantrips}/{limits.cantrips}</span>
        <span data-over={prepared > limits.prepared || undefined}>เตรียมไว้ {prepared}/{limits.prepared}</span>
      </span>}
      {canEdit && <button type="button" onClick={() => setPicking(!picking)}>{picking ? 'ปิดคลังเวท' : 'เพิ่มเวท'}</button>}
    </div>
    {limits && (prepared > limits.prepared || cantrips > limits.cantrips) && <p className="spellbook-warn" role="status">
      เกินจำนวนในตารางคลาส {[cantrips > limits.cantrips && 'Cantrip', prepared > limits.prepared && 'เวทที่เตรียมไว้'].filter(Boolean).join(' และ ')} · ยังร่ายได้ตามปกติ</p>}
    {canEdit && fromText.length > 0 && <p className="sheet-note">พบชื่อเวท SRD {fromText.length} บทในช่องข้อความเดิม{' '}
      <button type="button" onClick={() => void save([...book, ...fromText.map(id => ({ id, ...((byId.get(id)?.level ?? 0) > 0 ? { prepared: true } : {}) }))])}>แปลงจากข้อความเดิม</button></p>}
    {picking && <SpellPicker spells={spells} classLevel={actor.classLevel} known={new Set(book.map(entry => entry.id))} close={() => setPicking(false)}
      add={spell => void save([...book, { id: spell.id, ...(spell.level > 0 ? { prepared: true } : {}) }])} />}
    {!entries.length && !picking && <p className="sheet-note">ยังไม่มีเวทในชีต{canEdit ? ' · กด “เพิ่มเวท” เพื่อเลือกจากคลัง SRD' : ''}</p>}
    {[...new Set(entries.map(({ spell }) => spell.level))].map(level => <div key={level} className="spellbook-level">
      <h4>{levelName(level)}</h4>
      <ul>{entries.filter(({ spell }) => spell.level === level).map(({ entry, spell }) => <li key={spell.id} className="spellbook-row" data-unprepared={spell.level > 0 && !entry.prepared && !entry.always || undefined}>
        <div className="spellbook-line">
          <button type="button" className="spellbook-name" aria-expanded={open === spell.id} onClick={() => setOpen(open === spell.id ? undefined : spell.id)}>
            {spell.name}<small>{[spell.castingTime, spell.range, spell.concentration && 'C', spell.ritual && 'R', spell.area && spell.area.size + ' ft ' + spell.area.shape].filter(Boolean).join(' · ')}</small>
          </button>
          {canEdit && spell.level > 0 && <select aria-label={'การเตรียม ' + spell.name} value={entry.always ? 'always' : entry.prepared ? 'prepared' : ''}
            onChange={event => void save(book.map(item => item.id === spell.id ? { id: item.id, ...(event.target.value === 'always' ? { always: true } : event.target.value === 'prepared' ? { prepared: true } : {}) } : item))}>
            <option value="">ไม่ได้เตรียม</option><option value="prepared">เตรียมไว้</option><option value="always">เตรียมเสมอ</option>
          </select>}
          <button type="button" className="primary" aria-expanded={casting === spell.id} onClick={() => setCasting(casting === spell.id ? undefined : spell.id)} aria-label={'ร่าย ' + spell.name}>
            <Sparkles size={14} aria-hidden="true" /> ร่าย</button>
          {canEdit && <button type="button" className="sheet-icon" aria-label={'นำ ' + spell.name + ' ออกจากชีต'} title="นำออกจากชีต"
            onClick={() => void save(book.filter(item => item.id !== spell.id))}><Trash2 size={14} aria-hidden="true" /></button>}
        </div>
        {open === spell.id && <SpellDetails spell={spell} />}
        {casting === spell.id && <CastPanel key={spell.id} actor={actor} spell={spell} scene={scene} send={send} targets={targets} targetId={targetId}
          fighting={fighting} drawArea={drawArea} done={() => setCasting(undefined)} />}
      </li>)}</ul>
    </div>)}
  </section>
}

/**
 * One cast: pick the slot (lowest left by default, Pact Magic too), the targets, and go. The server
 * spends the slot and the Action and rolls; area spells place their template on the board first.
 */
function CastPanel({ actor, spell, scene, send, targets, targetId, fighting, drawArea, done }: {
  actor: Actor; spell: Spell; scene?: Scene; send: Send; targets: SpellTarget[]; targetId?: string
  fighting: boolean; drawArea?: DrawArea; done: () => void
}) {
  const slots = (parseSlots(actor.slots) ?? []).filter(slot => slot.level >= spell.level).map(slot => ({ ...slot, pact: false }))
  const pact = (parseSlots(actor.pactSlots ?? '') ?? []).filter(slot => slot.level >= spell.level).map(slot => ({ ...slot, pact: true }))
  const usable = [...slots, ...pact].filter(slot => slot.left > 0)
  const [slot, setSlot] = useState(usable[0] ? (usable[0].pact ? 'p' : '') + usable[0].level : '')
  const slotLevel = spell.level === 0 ? 0 : Number(slot.replace('p', '')) || spell.level
  const level = characterLevel(actor)
  const onBoard = Boolean(scene?.tokens.some(token => token.actorId === actor.id))
  const people = [{ id: actor.id, name: actor.name + ' (ตัวเอง)', foe: false }, ...targets]
  const first = spell.healing
    ? (targets.find(item => item.id === targetId && !item.foe)?.id ?? actor.id)
    : targetId
  const [chosen, setChosen] = useState<string[]>(first ? [first] : [])
  const [busy, setBusy] = useState(false)
  const damage = scaledDice(spell, spell.damage, slotLevel, level)
  const healing = scaledDice(spell, spell.healing, slotLevel, level)
  const bonus = spell.healingAddsModifier ? Math.max(0, actor.spellAttack - actor.proficiency) : 0
  const area = areaFor(spell)
  const upcastUnread = spell.level > 0 && slotLevel > spell.level && !scalesCleanly(spell) && spell.higherLevels
  const needsSlot = spell.level > 0
  const automated = Boolean(spell.attack || spell.save || spell.healing || spell.damage)
  const preview = [
    spell.attack && 'ทอยโจมตี ' + signed(actor.spellAttack),
    spell.save && spell.save + ' Save DC ' + actor.spellDC + (spell.half ? ' · ผ่านรับครึ่ง' : ''),
    damage && damage + ' ' + (spell.damageType ?? ''),
    healing && 'รักษา ' + healing + (bonus ? '+' + bonus : ''),
    spell.condition && 'พลาดเซฟ: ' + spell.condition,
    spell.concentration && 'Concentration',
    spell.castingTime
  ].filter(Boolean).join(' · ')

  async function cast(extra: Record<string, unknown> = {}) {
    setBusy(true)
    try {
      const ok = await send({ type: 'cast', actorId: actor.id, sceneId: scene?.id, spellId: spell.id,
        ...(needsSlot && !extra.ritual ? { slotLevel, ...(slot.startsWith('p') ? { pact: true } : {}) } : {}),
        ...(extra.area ? {} : { targetIds: chosen }), ...extra })
      if (ok) done()
    } finally { setBusy(false) }
  }
  const toggle = (id: string) => setChosen(chosen.includes(id) ? chosen.filter(item => item !== id) : [...chosen, id])

  return <div className="spell-cast" role="group" aria-label={'ร่าย ' + spell.name}>
    {needsSlot && <label>ช่องเวทที่ใช้<select aria-label={'ช่องเวทสำหรับ ' + spell.name} value={slot} onChange={event => setSlot(event.target.value)}>
      {!usable.length && <option value="">ไม่มีช่องเวทระดับ {spell.level}+ เหลือ</option>}
      {slots.map(entry => <option key={entry.level} value={String(entry.level)} disabled={entry.left < 1}>ระดับ {entry.level} (เหลือ {entry.left}/{entry.max})</option>)}
      {pact.map(entry => <option key={'p' + entry.level} value={'p' + entry.level} disabled={entry.left < 1}>Pact ระดับ {entry.level} (เหลือ {entry.left}/{entry.max})</option>)}
    </select></label>}
    <p className="spell-preview">{preview}</p>
    {upcastUnread && <p className="sheet-note"><b>ระดับสูงขึ้น (ปรับเอง):</b> {spell.higherLevels}</p>}
    {!automated && <p className="sheet-note">{spell.description.length > 320 ? spell.description.slice(0, 320) + '…' : spell.description}</p>}
    {(spell.attack || spell.save || spell.healing || spell.damage) && <fieldset className="spell-targets">
      <legend>เป้าหมาย</legend>
      {people.filter(item => spell.healing || item.id !== actor.id || !spell.attack).map(item =>
        <label key={item.id}><input type="checkbox" checked={chosen.includes(item.id)} onChange={() => toggle(item.id)} />
          {item.name}{item.feet !== undefined ? ' · ' + item.feet + ' ft.' : ''}</label>)}
    </fieldset>}
    <div className="sheet-inline">
      <button type="button" className="primary" disabled={busy || (needsSlot && !usable.length) || ((spell.attack || spell.save) && (!chosen.length || !onBoard))}
        onClick={() => void cast()}>ร่าย {spell.name}{needsSlot ? ' · ช่องระดับ ' + slotLevel : ''}</button>
      {area && spell.save && drawArea && onBoard && <button type="button" disabled={busy || (needsSlot && !usable.length)}
        onClick={() => drawArea({ kind: area.kind, squares: area.squares, label: spell.name + ' · ' + spell.area!.size + ' ft ' + spell.area!.shape },
          placed => void cast({ area: placed }))}>วางพื้นที่บนกระดาน</button>}
      {spell.ritual && !fighting && <button type="button" disabled={busy} onClick={() => void cast({ ritual: true })}>ร่ายแบบ Ritual (+10 นาที)</button>}
    </div>
    {(spell.attack || spell.save) && !onBoard && <p className="sheet-note">วาง Token ของตัวละครนี้ในฉากก่อนจึงจะร่ายใส่เป้าหมายได้</p>}
  </div>
}
