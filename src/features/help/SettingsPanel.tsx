import { usePrefs, uiScales } from '../../state/prefs.ts'
import type { Role } from '../shell/panelRegistry.ts'
import { appVersion } from '../../../shared/version.ts'
import { panelsFor } from '../shell/panelRegistry.ts'
import { useRoomStore } from '../../state/roomStore.ts'
import { sendCommand } from '../../state/useCommand.ts'

/**
 * Personal display settings for this device, the keyboard shortcuts for this
 * seat, and a way to replay the first-run tour.
 */
export function SettingsPanel({ role, replayTour }: { role: Role; replayTour: () => void }) {
  const prefs = usePrefs()
  const rules = useRoomStore(state => state.room?.settings)
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const shortcuts: [string, string][] = [
    [mac ? '⌘ K' : 'Ctrl K', 'ค้นหาคำสั่ง'],
    ...panelsFor(role).filter(panel => panel.shortcut && panel.inRail).map(panel => [panel.shortcut!, panel.label] as [string, string]),
    ...(role === 'dm' ? [['M', 'ห้องเก็บของ DM'] as [string, string]] : [['↑ ↓ ← →', 'ขยับตัวละครหลัก'] as [string, string]]),
    ['V', 'เลือกและลาก Token'], ['R', 'วัดระยะ'], ['G', 'แสดงหรือซ่อน Grid'], ['Space + ลาก', 'เลื่อนกระดาน'], ['Esc', 'ปิดแผงและยกเลิก']
  ]
  return <div className="settings-panel">
    <p className="settings-note">ค่าเหล่านี้เก็บไว้ในเครื่องนี้เท่านั้น เปลี่ยนเครื่องแล้วต้องตั้งใหม่</p>
    <fieldset className="settings-group">
      <legend>ขนาดหน้าจอ</legend>
      <div className="settings-chips" role="group" aria-label="ขนาดหน้าจอ">
        {uiScales.map(scale => <button key={scale} type="button" className="bh-chip" aria-pressed={prefs.uiScale === scale}
          onClick={() => prefs.update({ uiScale: scale })}>{Math.round(scale * 100)}%</button>)}
      </div>
    </fieldset>
    <fieldset className="settings-group">
      <legend>การแสดงผล</legend>
      <label className="settings-toggle"><input type="checkbox" checked={prefs.sound} onChange={event => prefs.update({ sound: event.target.checked })} />
        <span><b>เสียงในเกม</b><small>เสียงลูกเต๋า, ถึงเทิร์นของคุณ และจบการต่อสู้</small></span></label>
      <label className="settings-toggle"><input type="checkbox" checked={prefs.reduceMotion} onChange={event => prefs.update({ reduceMotion: event.target.checked })} />
        <span><b>ลดแอนิเมชัน</b><small>ปิดการเคลื่อนไหวและเอฟเฟกต์ (ถ้าเครื่องตั้งไว้แล้วจะลดให้อยู่แล้ว)</small></span></label>
      <label className="settings-toggle"><input type="checkbox" checked={prefs.showGrid} onChange={event => prefs.update({ showGrid: event.target.checked })} />
        <span><b>แสดงเส้น Grid บนกระดาน</b><small>Token ยังเดินตามช่องเหมือนเดิมแม้ซ่อนเส้น</small></span></label>
      <label className="settings-toggle"><input type="checkbox" checked={prefs.dice3d} disabled={prefs.reduceMotion} onChange={event => prefs.update({ dice3d: event.target.checked })} />
        <span><b>ลูกเต๋า 3D</b><small>ลูกเต๋ากลิ้งแล้วหยุดที่หน้าที่ทอยได้ (ปิดเองเมื่อเปิดลดแอนิเมชัน)</small></span></label>
    </fieldset>
    {role === 'dm' && <fieldset className="settings-group">
      <legend>กติกาของห้อง</legend>
      <label className="settings-toggle"><input type="checkbox" checked={rules?.encumbrance !== false}
        onChange={event => void sendCommand({ type: 'settings', settings: { encumbrance: event.target.checked } })} />
        <span><b>น้ำหนักบรรทุก</b><small>แบกเกิน STR × 15 lb แล้ว Speed เหลือ 5 ft (เหรียญ 50 เหรียญ = 1 lb)</small></span></label>
      <label>การเลื่อนระดับ<select value={rules?.advancement ?? 'milestone'}
        onChange={event => void sendCommand({ type: 'settings', settings: { advancement: event.target.value } })}>
        <option value="milestone">Milestone · DM สั่งเลื่อนระดับเอง</option>
        <option value="xp">XP · เก็บแต้มจากมอนสเตอร์ที่ล้ม</option>
      </select></label>
    </fieldset>}
    <fieldset className="settings-group">
      <legend>ความช่วยเหลือ</legend>
      <button type="button" onClick={replayTour}>เริ่มทัวร์แนะนำอีกครั้ง</button>
      <small className="settings-note settings-version">Beholder {appVersion}</small>
      <button type="button" disabled={!Object.keys(prefs.layout).length} onClick={() => prefs.update({ layout: {} })}>รีเซ็ตตำแหน่ง UI</button>
      <small className="settings-note">ลากที่ปุ่ม ⋮ ของแผง ถาดผลเต๋า แถบเทิร์น หรือแถบเครื่องมือ เพื่อย้ายตำแหน่ง (ยกเว้นเมนูด้านขวา)</small>
      <dl className="settings-shortcuts" aria-label="ปุ่มลัด">
        {shortcuts.map(([key, label]) => <div key={key + label}><dt><kbd className="bh-kbd">{key}</kbd></dt><dd>{label}</dd></div>)}
      </dl>
    </fieldset>
  </div>
}
