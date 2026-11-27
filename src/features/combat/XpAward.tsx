import { useState } from 'react'
import type { Scene, Snapshot } from '../../../shared/model.ts'
import type { Send } from '../../state/useCommand.ts'

/**
 * After a fight in an XP room: the defeated monsters' XP, shared equally
 * among the characters the DM keeps ticked. Shown to the DM only.
 */
export function XpAward({ room, scene, send }: { room: Snapshot; scene?: Scene; send: Send }) {
  const award = scene?.xpAward
  const [chosen, setChosen] = useState<string[]>()
  if (room.me.role !== 'dm' || !award || !scene) return null
  const ids = chosen ?? award.actorIds
  const characters = room.actors.filter(actor => actor.kind === 'pc' && scene.tokens.some(token => token.actorId === actor.id) || award.actorIds.includes(actor.id))
  const each = ids.length ? Math.floor(award.total / ids.length) : 0
  return <section className="xp-award damage-queue" aria-label="XP จากการต่อสู้">
    <header><h2>XP จากการต่อสู้ · {award.total.toLocaleString()}</h2></header>
    {characters.map(actor => <label key={actor.id} className="wizard-check">
      <input type="checkbox" checked={ids.includes(actor.id)}
        onChange={event => setChosen(event.target.checked ? [...ids, actor.id] : ids.filter(id => id !== actor.id))} />
      {actor.name} <small>({(actor.xp ?? 0).toLocaleString()} XP)</small></label>)}
    <div className="inline">
      <button type="button" className="primary" disabled={!ids.length}
        onClick={() => void send({ type: 'awardXp', sceneId: scene.id, fromFight: true, actorIds: ids, amount: each })}>แจกคนละ {each.toLocaleString()} XP</button>
      <button type="button" onClick={() => void send({ type: 'skipXp', sceneId: scene.id })}>ข้าม</button>
    </div>
  </section>
}

/** The DM gives XP by hand from a character's sheet. */
export function GiveXp({ actorId, send }: { actorId: string; send: Send }) {
  const [amount, setAmount] = useState(100)
  return <form className="sheet-inline" onSubmit={event => {
    event.preventDefault()
    void send({ type: 'awardXp', actorIds: [actorId], amount })
  }}>
    <label>ให้ XP<input type="number" min={0} max={100000} value={amount} onChange={event => setAmount(event.target.valueAsNumber || 0)} /></label>
    <button>ให้ XP</button>
  </form>
}
