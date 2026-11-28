import { useEffect, useMemo, useState } from 'react'
import { Pencil, Swords, Trash2 } from 'lucide-react'
import type { Snapshot } from '../../../shared/model.ts'
import { characterLevel } from '../../../shared/progression.ts'
import { difficulties, difficultyLabels, difficultyOf, encounterLimits, encounterXp, partyBudget, xpForCr } from '../../../shared/encounters.ts'
import type { Encounter, EncounterGroup } from '../../../shared/encounters.ts'
import type { ManualMonster } from '../../../shared/monsterManual.ts'
import { crNumber } from '../../../shared/monsterManual.ts'
import { loadMonsterCatalog } from '../manual/catalog.ts'
import { EmptyState } from '../../ui/index.ts'
import type { Send } from '../../state/useCommand.ts'
import './encounters.css'

/** What the board waits for: a saved encounter or a draft, placed with one click. */
export type EncounterPlacement = { label: string; start: boolean } & ({ encounterId: string } | { groups: Pick<EncounterGroup, 'monsterId' | 'count'>[] })

const xp = (value: number) => value.toLocaleString('en-US') + ' XP'
const verdict = (level: ReturnType<typeof difficultyOf>) => level === 'over' ? 'เกิน High' : level ? difficultyLabels[level] : 'ต่ำกว่า Low'

/**
 * Encounter builder (0.15, DM only): the party's XP budget from the SRD table,
 * monsters from the Manual, and a one-click placement. The budget is a guide;
 * the DM can go over it.
 */
export function EncounterPanel({ room, sceneId, send, place }: {
  room: Snapshot; sceneId?: string; send: Send; place: (placement: EncounterPlacement) => void
}) {
  const scene = room.scenes.find(item => item.id === sceneId)
  const pcs = room.actors.filter(actor => actor.kind === 'pc')
  const onScene = pcs.filter(actor => scene?.tokens.some(token => token.actorId === actor.id))
  const [party, setParty] = useState<string[]>(() => (onScene.length ? onScene : pcs).map(actor => actor.id))
  const [catalog, setCatalog] = useState<ManualMonster[]>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<EncounterGroup[]>([])
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string>()
  const [forScene, setForScene] = useState(true)
  const [start, setStart] = useState(false)
  useEffect(() => {
    loadMonsterCatalog().then(setCatalog).catch(() => setError('เปิด Monster Manual ไม่สำเร็จ'))
  }, [])
  const chosen = pcs.filter(actor => party.includes(actor.id))
  const budget = partyBudget(chosen.map(actor => characterLevel(actor)))
  const total = encounterXp(draft)
  const level = difficultyOf(total, budget)
  const words = query.trim().toLowerCase()
  const matches = useMemo(() => words ? catalog.filter(monster => (monster.name + ' ' + monster.type).toLowerCase().includes(words)).slice(0, 12) : [], [catalog, words])
  const saved = (room.encounters ?? []).filter(item => !item.sceneId || item.sceneId === sceneId)

  function add(monster: ManualMonster) {
    setDraft(list => list.some(group => group.monsterId === monster.id)
      ? list.map(group => group.monsterId === monster.id ? { ...group, count: Math.min(encounterLimits.count, group.count + 1) } : group)
      : [...list, { monsterId: monster.id, name: monster.name, cr: monster.cr, count: 1 }])
  }
  function edit(item: Encounter) {
    setEditing(item.id); setName(item.name); setDraft(item.groups.map(group => ({ ...group }))); setForScene(Boolean(item.sceneId))
  }
  function clear() {
    setEditing(undefined); setName(''); setDraft([])
  }
  async function save() {
    const ok = await send({ type: 'encounter', ...(editing ? { encounterId: editing } : {}), name: name.trim() || 'Encounter',
      sceneId: forScene && sceneId ? sceneId : null, groups: draft.map(({ monsterId, count }) => ({ monsterId, count })) })
    if (ok) clear()
  }
  const meterMax = Math.max(budget.high, total) || 1

  return <div className="encounters">
    <div className="section-head"><h2>Encounter</h2></div>
    <section className="encounter-party" aria-label="ปาร์ตี้">
      <h3>ปาร์ตี้</h3>
      {!pcs.length ? <p className="muted">ยังไม่มีชีตผู้เล่นในห้อง</p> : <ul>{pcs.map(actor => <li key={actor.id}>
        <label className="inline"><input type="checkbox" checked={party.includes(actor.id)}
          onChange={event => setParty(list => event.target.checked ? [...list, actor.id] : list.filter(id => id !== actor.id))} />
          {actor.name} <small>เลเวล {characterLevel(actor) || '?'}</small></label>
      </li>)}</ul>}
      <dl className="encounter-budget">{difficulties.map(key => <div key={key} data-level={key}><dt>{difficultyLabels[key]}</dt><dd>{xp(budget[key])}</dd></div>)}</dl>
      <small className="muted">งบ XP ต่อคนตามเลเวล (SRD 5.2.1) · เป็นแนวทาง เกินได้ตามที่โต๊ะต้องการ</small>
    </section>

    <section className="encounter-draft" aria-label={editing ? 'แก้ Encounter' : 'Encounter ใหม่'}>
      <h3>{editing ? 'แก้ Encounter' : 'Encounter ใหม่'}</h3>
      <label>ค้นมอนสเตอร์<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="เช่น Goblin, Ogre" /></label>
      {error && <p role="alert">{error}</p>}
      {matches.length > 0 && <ul className="encounter-matches">{matches.map(monster => <li key={monster.id}>
        <span><b>{monster.name}</b><small>CR {monster.cr} · {xp(xpForCr(monster.cr))}</small></span>
        <button aria-label={'เพิ่ม ' + monster.name} onClick={() => add(monster)}>+</button>
      </li>)}</ul>}
      {draft.length ? <ul className="encounter-groups">{[...draft].sort((a, b) => crNumber(b.cr) - crNumber(a.cr)).map(group => <li key={group.monsterId}>
        <span><b>{group.name}</b><small>CR {group.cr} · {xp(xpForCr(group.cr) * group.count)}</small></span>
        <input type="number" min={1} max={encounterLimits.count} value={group.count} aria-label={'จำนวน ' + group.name}
          onChange={event => {
            const count = Math.max(1, Math.min(encounterLimits.count, Math.floor(event.target.valueAsNumber) || 1))
            setDraft(list => list.map(entry => entry.monsterId === group.monsterId ? { ...entry, count } : entry))
          }} />
        <button aria-label={'เอา ' + group.name + ' ออก'} onClick={() => setDraft(list => list.filter(entry => entry.monsterId !== group.monsterId))}>×</button>
      </li>)}</ul> : <p className="muted">ค้นแล้วกด + เพื่อใส่มอนสเตอร์</p>}
      <div className="encounter-total" data-level={level ?? 'none'}>
        <div><b>{xp(total)}</b><span>{verdict(level)}</span></div>
        <div className="encounter-meter" aria-hidden="true">
          {difficulties.map(key => <i key={key} style={{ left: budget[key] / meterMax * 100 + '%' }} />)}
          <b style={{ width: Math.min(100, total / meterMax * 100) + '%' }} />
        </div>
      </div>
      {draft.length > 0 && <>
        <label>ชื่อ Encounter<input maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="เช่น ซุ่มโจมตีที่สะพาน" /></label>
        {scene && <label className="inline"><input type="checkbox" checked={forScene} onChange={event => setForScene(event.target.checked)} />ผูกกับฉาก {scene.name}</label>}
        <label className="inline"><input type="checkbox" checked={start} onChange={event => setStart(event.target.checked)} />เริ่มต่อสู้ทันทีหลังวาง</label>
        <div className="inline">
          <button className="primary" disabled={!scene} onClick={() => place({ label: name.trim() || 'Encounter', start,
            groups: draft.map(({ monsterId, count }) => ({ monsterId, count })) })}>วางลงฉาก</button>
          <button onClick={() => void save()}>{editing ? 'บันทึกการแก้' : 'บันทึกไว้ใช้ทีหลัง'}</button>
          <button onClick={clear}>ล้าง</button>
        </div>
      </>}
    </section>

    <section aria-label="Encounter ที่เตรียมไว้">
      <h3>เตรียมไว้</h3>
      {!saved.length ? <EmptyState title="ยังไม่มี Encounter ที่บันทึกไว้" hint="ผู้เล่นมองไม่เห็นรายการนี้" />
        : <ul className="encounter-saved">{saved.map(item => {
          const total = encounterXp(item.groups)
          return <li key={item.id}>
            <span><b>{item.name}</b><small>{item.groups.map(group => group.name + ' ×' + group.count).join(', ')} · {xp(total)} · {verdict(difficultyOf(total, budget))}</small></span>
            <span className="encounter-actions">
              <button className="primary" disabled={!scene} aria-label={'วาง ' + item.name} onClick={() => place({ label: item.name, start, encounterId: item.id })}><Swords size={14} aria-hidden="true" /> วาง</button>
              <button aria-label={'แก้ ' + item.name} onClick={() => edit(item)}><Pencil size={14} aria-hidden="true" /></button>
              <button aria-label={'ลบ ' + item.name} onClick={() => void send({ type: 'encounter', encounterId: item.id, remove: true })}><Trash2 size={14} aria-hidden="true" /></button>
            </span>
          </li>
        })}</ul>}
    </section>
  </div>
}
