import type { Actor, Scene } from '../../../shared/model.ts'
import { actionCount, attacksPerAction, freshUse } from '../../../shared/economy.ts'
import { hasCondition } from '../../../shared/effects.ts'

type Command = (command: Record<string, unknown>) => Promise<boolean>

/**
 * Action, Bonus Action, Reaction (and Disengage, Action Surge) for one creature
 * in a fight. Attacks and spells fill them in by themselves; a click marks the
 * rest by hand. Over the limit turns the chip red — nothing is ever blocked.
 */
export function TurnChips({ actor, scene, command, compact = false }: { actor: Actor; scene: Scene; command?: Command; compact?: boolean }) {
  const combat = scene.combat
  if (!combat?.order.some(entry => entry.actorId === actor.id)) return null
  const mine = combat.order[combat.turn]?.actorId === actor.id
  const use = { ...freshUse(), ...combat.uses?.[actor.id] }
  const perAction = attacksPerAction(actor)
  const actions = actionCount(use, perAction)
  const surge = actor.resources?.find(resource => resource.name === 'Action Surge')
  const set = (kind: string, value: unknown) => void command?.({ type: 'turnAction', actorId: actor.id, kind, value })
  const chip = (label: string, used: boolean, over: boolean, onClick?: () => void, title?: string) =>
    <button type="button" className={'turn-chip' + (used ? ' used' : '') + (over ? ' over' : '')} aria-pressed={used} disabled={!command || !onClick}
      onClick={onClick} title={title}>{label}</button>
  return <span className={'turn-chips' + (compact ? ' compact' : '')} role="group" aria-label={'การกระทำของ ' + actor.name}>
    {mine && chip('Action ' + actions.used + '/' + actions.allowed, actions.used >= actions.allowed, actions.used > actions.allowed,
      () => set('action', use.manualActions ? 0 : 1), 'โจมตีและร่ายเวทนับให้เอง · คลิกเพื่อทำเครื่องหมายว่าใช้ Action อื่น (Dash, Dodge, Help…)')}
    {mine && perAction > 1 && use.weaponAttacks > 0 && chip('Attack ' + (((use.weaponAttacks - 1) % perAction) + 1) + '/' + perAction,
      use.weaponAttacks % perAction === 0, false, undefined, 'โจมตีได้ ' + perAction + ' ครั้งต่อ Attack action')}
    {mine && chip('Bonus ' + use.bonus + '/1', use.bonus >= 1, use.bonus > 1, () => set('bonus', use.bonus ? 0 : 1))}
    {chip(use.reaction ? 'Reaction ใช้แล้ว' : 'Reaction', use.reaction, false, () => set('reaction', !use.reaction), 'คืนเมื่อเริ่มเทิร์นของตัวเอง')}
    {mine && chip('Disengage', use.disengaged, false, () => set('disengage', !use.disengaged), 'เดินออกจากระยะเอื้อมโดยไม่โดน Opportunity Attack')}
    {hasCondition(actor, 'Prone') && <button type="button" className="turn-chip" disabled={!command} title="ใช้ระยะเดินครึ่งหนึ่งของ Speed"
      onClick={() => void command?.({ type: 'standUp', actorId: actor.id })}>ลุกขึ้น</button>}
    {mine && surge && surge.used < surge.max && <button type="button" className="turn-chip surge" disabled={!command}
      onClick={() => set('surge', true)}>Action Surge</button>}
  </span>
}
