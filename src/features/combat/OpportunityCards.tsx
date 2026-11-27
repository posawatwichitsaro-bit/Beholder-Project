import { Swords } from 'lucide-react'
import type { Scene, Snapshot } from '../../../shared/model.ts'
import type { Send } from '../../state/useCommand.ts'

/**
 * "Goblin ใช้ Reaction โจมตี Lyra ไหม": one card per Opportunity Attack this seat
 * can answer (the server only sends a player the cards for their own creatures).
 * Attack rolls the main attack and uses the Reaction; Pass closes the card.
 * Unanswered cards lapse when the turn moves on.
 */
export function OpportunityCards({ room, scene, send }: { room: Snapshot; scene?: Scene; send: Send }) {
  const prompts = scene?.combat?.prompts ?? []
  if (!prompts.length) return null
  const name = (id: string) => room.publicActors.find(actor => actor.id === id)?.name ?? room.actors.find(actor => actor.id === id)?.name ?? 'บางสิ่ง'
  return <section className="opportunity-cards" aria-label="Opportunity Attack">
    {prompts.map(prompt => <div key={prompt.id} className="opportunity-card" role="alertdialog" aria-label={'Opportunity Attack ของ ' + name(prompt.attackerId)}>
      <Swords size={16} aria-hidden="true" />
      <span><b>{name(prompt.attackerId)}</b> ใช้ Reaction โจมตี <b>{name(prompt.targetId)}</b> ที่เดินออกจากระยะเอื้อมไหม</span>
      <button type="button" className="primary" onClick={() => void send({ type: 'opportunity', promptId: prompt.id, attack: true })}>โจมตี</button>
      <button type="button" onClick={() => void send({ type: 'opportunity', promptId: prompt.id, attack: false })}>ผ่าน</button>
    </div>)}
  </section>
}
