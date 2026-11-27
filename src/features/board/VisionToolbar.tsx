import { BrickWall, DoorOpen, Eraser, Eye, Flame, Moon, Sparkles, SunDim } from 'lucide-react'
import type { Member, Scene } from '../../../shared/model.ts'
import { ambientLabels } from '../../../shared/vision.ts'
import type { Ambient } from '../../../shared/vision.ts'
import type { VisionTool } from './visionTools.ts'

type Command = (command: Record<string, unknown>) => Promise<boolean>

const tools: { id: VisionTool; label: string; hint: string; icon: typeof BrickWall }[] = [
  { id: 'wall', label: 'ผนัง', hint: 'คลิกทีละมุมเพื่อลากผนังต่อกัน · Esc หรือคลิกขวาเพื่อจบเส้น', icon: BrickWall },
  { id: 'door', label: 'ประตู', hint: 'คลิกสองจุดเป็นบานประตู · คลิกขวาที่ประตูเพื่อล็อก ตั้ง DC หรือทำเป็นประตูลับ', icon: DoorOpen },
  { id: 'light', label: 'แหล่งแสง', hint: 'คลิกช่องเพื่อวางคบไฟ (สว่าง 20 ฟุต สลัวอีก 20 ฟุต) · คลิกที่แสงเดิมเพื่อเปิดหรือปิด', icon: Flame },
  { id: 'dark', label: 'ถมมืด', hint: 'ลากระบายช่องที่มืด · Darkvision ยังเห็น และแสงส่องได้', icon: Moon },
  { id: 'magic', label: 'ถมมืดเวท', hint: 'ลากระบายความมืดเวท · Darkvision มองไม่เห็นและแสงธรรมดาส่องไม่ถึง', icon: Sparkles },
  { id: 'clear', label: 'ล้างความมืด', hint: 'ลากเพื่อลบความมืดที่ระบายไว้', icon: SunDim },
  { id: 'erase', label: 'ลบผนังหรือแสง', hint: 'คลิกที่เส้นผนัง ประตู หรือแหล่งแสงเพื่อลบ', icon: Eraser }
]

/** The DM's vision controls: switch, scene light, drawing tools and "see as" a player. */
export function VisionToolbar({ scene, members, tool, setTool, viewAs, setViewAs, command }: {
  scene: Scene; members: Member[]; tool?: VisionTool; setTool: (tool?: VisionTool) => void
  viewAs: string; setViewAs: (memberId: string) => void; command: Command
}) {
  const vision = scene.vision
  const enabled = vision?.enabled === true
  const players = members.filter(member => member.role === 'player')
  const current = tools.find(item => item.id === tool)
  return <div className="vision-tools" role="toolbar" aria-label="เครื่องมือการมองเห็น">
    <label className="vision-switch"><input type="checkbox" checked={enabled}
      onChange={event => void command({ type: 'visionSettings', enabled: event.target.checked })} />ระบบมองเห็น</label>
    <select aria-label="แสงของฉาก" value={vision?.ambient ?? 'day'}
      onChange={event => void command({ type: 'visionSettings', ambient: event.target.value as Ambient })}>
      {(Object.keys(ambientLabels) as Ambient[]).map(value => <option key={value} value={value}>{ambientLabels[value]}</option>)}
    </select>
    <span className="vision-tool-buttons">
      {tools.map(item => <button key={item.id} type="button" aria-label={item.label} title={item.label + ' · ' + item.hint}
        aria-pressed={tool === item.id} onClick={() => setTool(tool === item.id ? undefined : item.id)}><item.icon size={15} aria-hidden="true" /></button>)}
    </span>
    <label className="vision-viewas"><Eye size={14} aria-hidden="true" /><select aria-label="ดูจากมุมมองของ" value={viewAs} onChange={event => setViewAs(event.target.value)}>
      <option value="">DM (เห็นทั้งหมด)</option>
      {players.map(member => <option key={member.id} value={member.id}>มุมมองของ {member.name}</option>)}
    </select></label>
    <button type="button" onClick={() => void command({ type: 'visionSettings', clearExplored: true })} disabled={!vision?.explored}>ล้างพื้นที่สำรวจ</button>
    {current && <small className="vision-hint">{current.hint}</small>}
    {enabled && !vision?.walls?.length && <small className="vision-hint vision-warn" role="note">ยังไม่มีผนังในฉาก ผู้เล่นจะเห็นทุกอย่างในระยะสายตาและแสง</small>}
  </div>
}
