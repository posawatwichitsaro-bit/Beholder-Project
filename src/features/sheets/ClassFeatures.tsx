import { useState } from 'react'
import { Flame, HandHeart, Music, Zap } from 'lucide-react'
import type { Actor } from '../../../shared/model.ts'
import { bardicDie, featureResource, inspirationDie, isRaging, levelIn, rageDamage } from '../../../shared/classFeatures.ts'
import type { FeatureKey } from '../../../shared/classFeatures.ts'
import type { Send } from '../../state/useCommand.ts'

const keyOf = Object.fromEntries(Object.entries(featureResource).map(([key, name]) => [name, key as FeatureKey]))

/**
 * Class resource buttons on the Actions tab (0.13). Rage, Second Wind and
 * Bardic Inspiration do their rule; any other resource (Channel Divinity,
 * Lay On Hands…) is spent by one and written to the Adventure Log.
 */
export function ClassFeatures({ actor, send, friends }: { actor: Actor; send: Send; friends: { id: string; name: string }[] }) {
  const resources = actor.resources ?? []
  const [friend, setFriend] = useState('')
  const chosen = friends.some(item => item.id === friend) ? friend : friends[0]?.id
  const die = inspirationDie(actor)
  if (!resources.length && !die && !isRaging(actor)) return null
  return <section className="class-features" aria-label="ความสามารถของคลาส">
    <h3>ความสามารถของคลาส</h3>
    {(isRaging(actor) || die) && <p className="sheet-note">
      {isRaging(actor) && <><Flame size={13} aria-hidden="true" /> กำลัง Rage · ต้านทาน B/P/S · ความเสียหายอาวุธ +{rageDamage(levelIn(actor, 'Barbarian'))} </>}
      {die && <><Music size={13} aria-hidden="true" /> มี Bardic Inspiration d{die} · คลิกขวาที่ปุ่มทอย d20 แล้วเลือก “เพิ่ม Inspiration”</>}
    </p>}
    {resources.map((resource, index) => {
      const left = resource.max - resource.used
      const key = keyOf[resource.name]
      const count = <small>เหลือ {left}/{resource.max}</small>
      if (key === 'rage') return <button key={index} type="button" className="class-feature" disabled={!left || isRaging(actor)}
        onClick={() => void send({ type: 'classFeature', actorId: actor.id, feature: 'rage' })}>
        <Flame size={14} aria-hidden="true" /> เข้าสู่ Rage · Bonus Action {count}</button>
      if (key === 'secondWind') return <button key={index} type="button" className="class-feature" disabled={!left}
        onClick={() => void send({ type: 'classFeature', actorId: actor.id, feature: 'secondWind' })}>
        <HandHeart size={14} aria-hidden="true" /> Second Wind · 1d10+{levelIn(actor, 'Fighter')} {count}</button>
      if (key === 'bardicInspiration') return <div key={index} className="class-feature-row">
        <select aria-label="ให้ Bardic Inspiration แก่" value={chosen ?? ''} onChange={event => setFriend(event.target.value)}>
          {!friends.length && <option value="">ไม่มีเพื่อนในฉาก</option>}
          {friends.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button type="button" className="class-feature" disabled={!left || !chosen}
          onClick={() => void send({ type: 'classFeature', actorId: actor.id, feature: 'bardicInspiration', targetId: chosen })}>
          <Music size={14} aria-hidden="true" /> ให้ Bardic Inspiration d{bardicDie(levelIn(actor, 'Bard'))} {count}</button>
      </div>
      return <button key={index} type="button" className="class-feature" disabled={!left}
        onClick={() => void send({ type: 'useResource', actorId: actor.id, index, used: resource.used + 1, log: true })}>
        <Zap size={14} aria-hidden="true" /> ใช้ {resource.name} {count}</button>
    })}
  </section>
}
