import { useState } from 'react'
import { Lock } from 'lucide-react'
import type { Send } from '../../state/useCommand.ts'

/** The DM's secret notes on a scene or a sheet (0.13): saved on the server, never sent to players. */
export function DmNotes({ notes, label, send, target }: {
  notes?: string; label: string; send: Send; target: { sceneId: string } | { actorId: string }
}) {
  const [text, setText] = useState(notes ?? '')
  const changed = text !== (notes ?? '')
  return <form className="dm-notes" onSubmit={event => { event.preventDefault(); void send({ type: 'dmNotes', ...target, notes: text.trim() }) }}>
    <label><span><Lock size={13} aria-hidden="true" /> {label} · ผู้เล่นไม่เห็น</span>
      <textarea value={text} rows={3} maxLength={5000} onChange={event => setText(event.target.value)} placeholder="เช่น กับดัก ความลับ แผนของศัตรู" /></label>
    <button disabled={!changed}>บันทึกโน้ต</button>
  </form>
}
