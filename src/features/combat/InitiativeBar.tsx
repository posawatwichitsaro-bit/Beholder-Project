import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { nextLivingTurn } from '../../../shared/model.ts'
import type { Scene, Snapshot } from '../../../shared/model.ts'
import { CrossedSwordsIcon, HpBar } from '../../ui/index.ts'
import { tokenInitials } from '../board/tokenAppearance.ts'
import { ConditionBadges } from './ConditionBadges.tsx'
import { usePrefs } from '../../state/prefs.ts'
import { playTurnSound } from '../dice/sound.ts'
import type { Send } from '../../state/useCommand.ts'

/**
 * The turn order across the top of the map while a fight is on.
 * The current combatant is larger with an ember ring; the next one is marked.
 * Clicking a portrait centres the camera for you only. The DM also gets
 * back / next controls. A new round flashes "รอบที่ N" over the map.
 */
export function InitiativeBar({ scene, room, focus, send }: {
  scene: Scene; room: Snapshot; focus: (actorId: string) => void; send: Send
}) {
  const fight = scene.combat!
  const dm = room.me.role === 'dm'
  const list = useRef<HTMLOListElement>(null)
  const [roundFlash, setRoundFlash] = useState<number>()
  const lastRound = useRef(fight.round)
  useEffect(() => {
    list.current?.querySelector('[aria-current=step]')?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [fight.turn, fight.round])
  useEffect(() => {
    if (fight.round === lastRound.current) return
    lastRound.current = fight.round
    setRoundFlash(fight.round)
    const timer = setTimeout(() => setRoundFlash(undefined), 1800)
    return () => clearTimeout(timer)
  }, [fight.round])
  const next = nextLivingTurn(fight, id => room.publicActors.find(actor => actor.id === id)?.hp === 0 &&
    room.publicActors.find(actor => actor.id === id)?.kind === 'monster')
  const owned = new Set(room.actors.map(actor => actor.id))

  return <>
    <div className="combat-vignette" aria-hidden="true" />
    <aside className="initiative-bar" aria-labelledby="turn-initiative-title">
      <div className="initiative-emblem">
        <CrossedSwordsIcon size={24} />
        <h2 id="turn-initiative-title" className="bh-visually-hidden">Turn Initiative</h2>
        <span className="initiative-label" aria-hidden="true">การต่อสู้</span>
        <span className="initiative-round">รอบ {fight.round}</span>
      </div>
      {dm && <button type="button" className="initiative-step" aria-label="ย้อนเทิร์น" title="ย้อนเทิร์น"
        onClick={() => void send({ type: 'previousTurn', sceneId: scene.id })}><ChevronLeft size={18} aria-hidden="true" /></button>}
      <ol ref={list}>{fight.order.map(({ actorId, initiative }, index) => {
        const actor = room.publicActors.find(item => item.id === actorId)
        if (!actor) return null
        const active = index === fight.turn
        const upNext = !active && next?.turn === index
        const tokenIndex = scene.tokens.findIndex(token => token.actorId === actorId)
        const side = actor.kind === 'monster' ? 'foe' : 'ally'
        return <li key={actorId}>
          <button type="button" aria-current={active ? 'step' : undefined} disabled={tokenIndex < 0} onClick={() => focus(actorId)}
            className={'initiative-entry' + (actor.hp === 0 ? ' turn-down' : '') + (owned.has(actorId) && !dm ? ' mine' : '')}
            style={{ '--_rim': side === 'foe' ? 'var(--bh-crimson)' : 'var(--bh-hp-ally)' } as CSSProperties}
            aria-label={tokenIndex < 0 ? actor.name + ' · ไม่มี Token ในฉาก' : 'ไปที่ Token ' + actor.name}
            title={actor.name + ' · Initiative ' + initiative + ' · HP ' + actor.hp + '/' + actor.maxHp}>
            <span className="initiative-tag" aria-hidden="true">{active ? 'กำลังเล่น' : upNext ? 'ถัดไป' : ''}</span>
            <span className="initiative-portrait" aria-hidden="true">{actor.portrait ? <img src={actor.portrait} alt="" /> : tokenInitials(actor.name)}</span>
            <HpBar hp={actor.hp} max={actor.maxHp} side={side} label={'HP ของ ' + actor.name} height={4} />
            <span className="initiative-name">{actor.name}</span>
            {(actor.conditions || actor.effects?.length) ? <ConditionBadges creature={actor} max={2} size={11} /> : null}
            <b className="initiative-score">{initiative}</b>
          </button>
        </li>
      })}</ol>
      {dm && <button type="button" className="initiative-step" aria-label="ไปเทิร์นถัดไป" title="ไปเทิร์นถัดไป"
        onClick={() => void send({ type: 'next', sceneId: scene.id })}><ChevronRight size={18} aria-hidden="true" /></button>}
    </aside>
    {roundFlash && <div className="round-flash" aria-hidden="true" data-text={'รอบที่ ' + roundFlash} />}
  </>
}

/** "ถึงเทิร์นของคุณ" for the player whose character is up, with their own End Turn button. */
export function TurnBanner({ scene, room, send }: { scene: Scene; room: Snapshot; send: Send }) {
  const fight = scene.combat!
  const current = fight.order[fight.turn]
  const mine = room.me.role !== 'dm' ? room.actors.find(actor => actor.id === current.actorId) : undefined
  // A chime when your turn starts (once per turn, not on reconnect into the same turn).
  const turnKey = mine ? scene.id + ':' + fight.round + ':' + fight.turn : ''
  const heard = useRef('')
  useEffect(() => {
    if (!turnKey || heard.current === turnKey) return
    const first = heard.current === ''
    heard.current = turnKey
    // On a fresh load mid-turn stay quiet, except when the fight has just begun with your turn.
    if ((!first || (fight.round === 1 && fight.turn === 0)) && usePrefs.getState().sound) playTurnSound()
  }, [turnKey])
  if (!mine) return null
  return <div className="turn-banner" role="status">
    <span className="turn-banner-text">ถึงเทิร์นของคุณ, {mine.name}</span>
    <button type="button" onClick={() => void send({ type: 'endTurn', sceneId: scene.id, actorId: mine.id })}>จบเทิร์น</button>
  </div>
}
