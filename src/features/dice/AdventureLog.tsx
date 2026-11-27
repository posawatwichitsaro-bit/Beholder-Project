import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Dices, Flag, HeartPulse, Map as MapIcon, MessageCircle, Send, Swords, UserPlus, Volume2, VolumeX } from 'lucide-react'
import type { LogEntry, Snapshot } from '../../../shared/model.ts'
import type { Send as SendCommand } from '../../state/useCommand.ts'
import { usePrefs } from '../../state/prefs.ts'
import { diceOutcome } from './diceOutcome.ts'
import { timeline } from './timeline.ts'

const icons: Record<LogEntry['kind'], ReactNode> = {
  chat: <MessageCircle size={14} />, scene: <MapIcon size={14} />, combat: <Swords size={14} />,
  hp: <HeartPulse size={14} />, join: <UserPlus size={14} />
}
const clock = (at: number) => at ? new Date(at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : ''

/**
 * The table's story in one timeline: rolls, chat, HP changes, combat and scene
 * changes. Players who drop out or join late can scroll back instead of
 * asking. "/r 2d6+3" in the message box rolls dice.
 */
export function AdventureLog({ room, send }: { room: Snapshot; send: SendCommand }) {
  const [message, setMessage] = useState('')
  const sound = usePrefs(state => state.sound)
  const setSound = usePrefs(state => state.setSound)
  const list = useRef<HTMLOListElement>(null)
  const pinnedToBottom = useRef(true)
  const entries = useMemo(() => timeline(room.rolls, room.log ?? []), [room.rolls, room.log])
  useEffect(() => {
    const element = list.current
    if (element && pinnedToBottom.current) element.scrollTop = element.scrollHeight
  }, [entries.length])

  async function submit() {
    const text = message.trim()
    if (!text) return
    const rollCommand = /^\/r(?:oll)?\s+(.+)$/i.exec(text)
    const ok = await send(rollCommand ? { type: 'roll', formula: rollCommand[1].replace(/\s+/g, '') } : { type: 'chat', text })
    if (ok) setMessage('')
  }

  return <section className="adventure-log" aria-label="บันทึกการผจญภัย">
    <div className="adventure-log-tools">
      <span>{entries.length ? entries.length + ' เหตุการณ์ล่าสุด' : 'ยังไม่มีเหตุการณ์'}</span>
      <button type="button" className="adventure-log-sound" aria-pressed={sound} onClick={() => setSound(!sound)}
        aria-label={sound ? 'ปิดเสียงลูกเต๋า' : 'เปิดเสียงลูกเต๋า'} title={sound ? 'ปิดเสียงลูกเต๋า' : 'เปิดเสียงลูกเต๋า'}>
        {sound ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}
      </button>
    </div>
    <ol ref={list} className="adventure-log-list" aria-live="polite"
      onScroll={event => {
        const element = event.currentTarget
        pinnedToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40
      }}>
      {entries.map(item => {
        if (item.type === 'roll') {
          const roll = item.roll
          const outcome = diceOutcome(roll)
          return <li key={item.id} className={'log-roll' + (roll.undone ? ' log-undone' : '')} data-outcome={outcome}>
            <span className="log-icon" aria-hidden="true"><Dices size={14} /></span>
            <span className="log-body">
              <span className="log-who">{roll.name}</span> {roll.label}{roll.privateTo ? ' · ลับ' : ''}
              <span className="log-formula"> · {roll.formula}{roll.faces.length > 1 ? ' [' + roll.faces.join(', ') + ']' : ''}</span>
              {roll.outcome && <span className="log-outcome"> · {roll.outcome}</span>}
              {roll.applied === false && !roll.undone && <span className="log-outcome roll-waiting"> · รอ DM ยืนยัน</span>}
              {roll.undone && <span className="log-outcome log-undone-tag"> · ย้อนแล้ว</span>}
              {outcome !== 'normal' && <span className="log-badge">{outcome === 'critical' ? 'Natural 20' : 'Natural 1'}</span>}
            </span>
            <b className="log-total">{roll.total}</b>
            <time className="log-time">{clock(item.at)}</time>
          </li>
        }
        const entry = item.entry
        return <li key={item.id} className={'log-' + entry.kind}>
          <span className="log-icon" aria-hidden="true">{entry.kind === 'combat' && entry.text === 'จบการต่อสู้' ? <Flag size={14} /> : icons[entry.kind]}</span>
          <span className="log-body">{entry.name && <span className="log-who">{entry.name}</span>} {entry.text}</span>
          <time className="log-time">{clock(entry.at)}</time>
        </li>
      })}
    </ol>
    <form className="adventure-log-form" onSubmit={event => { event.preventDefault(); void submit() }}>
      <input aria-label="ข้อความถึงโต๊ะ" value={message} maxLength={500} placeholder="พิมพ์ข้อความ หรือ /r 2d6+3 เพื่อทอย"
        onChange={event => setMessage(event.target.value)} />
      <button className="primary" aria-label="ส่ง" disabled={!message.trim()}><Send size={15} aria-hidden="true" /></button>
    </form>
  </section>
}
