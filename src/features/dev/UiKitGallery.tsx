import { useState } from 'react'
import { Map as MapIcon, ScrollText, Settings, Swords } from 'lucide-react'
import {
  BeholderEyeIcon, Bookmarks, Button, Chip, CrossedSwordsIcon, D20Icon, Dialog, GrimoireIcon, HpBar,
  IconButton, Panel, PanelBody, Tabs, ToastViewport, toast
} from '../../ui/index.ts'

const conditions = ['Prone', 'Poisoned', 'Frightened', 'Restrained', 'Stunned'] as const

/**
 * `/ui-kit`: every UI kit component on one page, for reviewing the theme and
 * for checking a component change without opening a room.
 */
export function UiKitGallery() {
  const [tab, setTab] = useState<'overview' | 'actions' | 'spells'>('overview')
  const [page, setPage] = useState<'spells' | 'abilities' | 'bag'>('spells')
  const [active, setActive] = useState<string[]>(['Frightened'])
  const [dialog, setDialog] = useState(false)
  const [pending, setPending] = useState(false)
  const [hp, setHp] = useState(18)
  return <main style={{ minHeight: '100dvh', background: 'var(--bh-bg)', color: 'var(--bh-text)', fontFamily: 'var(--bh-font-body)', padding: 'var(--bh-space-6)', boxSizing: 'border-box' }}>
    <h1 className="bh-heading" style={{ margin: 0, fontSize: 'var(--bh-text-2xl)', color: 'var(--bh-text-strong)' }}>Beholder UI kit</h1>
    <p style={{ color: 'var(--bh-text-muted)' }}>ธีม Grimoire · ทุกส่วนประกอบในหน้าเดียว</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--bh-space-5)', alignItems: 'start' }}>
      <Panel surface="leather" title="Button">
        <PanelBody><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button variant="primary">เทิร์นถัดไป</Button>
          <Button variant="brass">เปิดให้ผู้เล่น</Button>
          <Button>ยกเลิก</Button>
          <Button variant="ghost">ข้าม</Button>
          <Button variant="danger">ลบฉาก</Button>
          <Button variant="primary" pending={pending} onClick={() => { setPending(true); setTimeout(() => setPending(false), 1500) }}>ส่งคำสั่ง</Button>
          <Button size="lg" variant="primary" icon={<D20Icon size={18} />}>ทอย d20</Button>
        </div></PanelBody>
      </Panel>
      <Panel surface="parchment" title="Button บนกระดาษ">
        <PanelBody><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button variant="primary">ยืนยัน</Button><Button>ครึ่ง</Button><Button variant="brass">บันทึก</Button><Button variant="danger">ลบ</Button>
        </div></PanelBody>
      </Panel>
      <Panel surface="leather" title="IconButton และ Tooltip">
        <PanelBody><div style={{ display: 'flex', gap: 8 }}>
          <IconButton label="ฉากและแผนที่" shortcut="S" icon={<MapIcon size={18} />} />
          <IconButton label="การต่อสู้" shortcut="F" icon={<Swords size={18} />} pressed />
          <IconButton label="บันทึกการผจญภัย" shortcut="L" icon={<ScrollText size={18} />} />
          <IconButton label="ตั้งค่า" icon={<Settings size={18} />} />
        </div></PanelBody>
      </Panel>
      <Panel surface="parchment" title="HP bar">
        <PanelBody><div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <HpBar hp={hp} max={24} temp={3} label="HP ของ Mira" surface="parchment" height={12} />
          <HpBar hp={9} max={24} label="HP ครึ่งหนึ่ง" surface="parchment" />
          <HpBar hp={4} max={10} side="foe" label="HP ของ Goblin" surface="parchment" />
          <div style={{ display: 'flex', gap: 6 }}>
            <Button size="sm" onClick={() => setHp(value => Math.max(0, value - 5))}>−5</Button>
            <Button size="sm" onClick={() => setHp(value => Math.min(24, value + 5))}>+5</Button>
          </div>
        </div></PanelBody>
      </Panel>
      <Panel surface="leather" title="HP bar บนพื้นมืด">
        <PanelBody><div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <HpBar hp={31} max={34} label="Hawk" />
          <HpBar hp={10} max={10} side="foe" label="Goblin 1" />
          <HpBar hp={2} max={10} side="foe" label="Goblin 3" />
        </div></PanelBody>
      </Panel>
      <Panel surface="parchment" title="Chip · Condition">
        <PanelBody><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {conditions.map(item => <Chip key={item} active={active.includes(item)}
            onToggle={() => setActive(list => list.includes(item) ? list.filter(value => value !== item) : [...list, item])}>{item}</Chip>)}
        </div></PanelBody>
      </Panel>
      <Panel surface="leather" title="Tabs">
        <Tabs label="ชีต" value={tab} onChange={setTab} items={[{ id: 'overview', label: 'ภาพรวม' }, { id: 'actions', label: 'Actions' }, { id: 'spells', label: 'Spells' }]} />
        <PanelBody><p style={{ margin: 0 }}>แท็บที่เลือก: {tab} · ใช้ลูกศรซ้าย/ขวาสลับได้</p></PanelBody>
      </Panel>
      <div style={{ display: 'flex', minHeight: 220 }}>
        <div style={{ paddingTop: 16 }}><Bookmarks label="หน้าหนังสือ" value={page} onChange={setPage}
          items={[{ id: 'spells', label: 'เวท' }, { id: 'abilities', label: 'ค่าพลัง' }, { id: 'bag', label: 'กระเป๋า' }]} /></div>
        <Panel surface="parchment" title="Bookmarks" style={{ flex: 1, borderRadius: 0, borderLeft: '4px solid var(--bh-line-strong)' }}>
          <PanelBody><p style={{ margin: 0 }}>หน้า: {page} · ใช้ลูกศรขึ้น/ลง</p></PanelBody>
        </Panel>
      </div>
      <Panel surface="leather" title="Dialog และ Toast">
        <PanelBody><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button onClick={() => setDialog(true)}>เปิด Dialog</Button>
          <Button onClick={() => toast('คัดลอกลิงก์แล้ว', 'success')}>Toast สำเร็จ</Button>
          <Button onClick={() => toast('ให้ Token เข้าใกล้เป้าหมายก่อน', 'error')}>Toast ผิดพลาด</Button>
        </div></PanelBody>
      </Panel>
      <Panel surface="leather" title="ไอคอน D&amp;D">
        <PanelBody><div style={{ display: 'flex', gap: 16, color: 'var(--bh-brass-bright)' }}>
          <D20Icon size={28} /><CrossedSwordsIcon size={28} /><GrimoireIcon size={28} /><BeholderEyeIcon size={28} />
        </div></PanelBody>
      </Panel>
    </div>
    {dialog && <Dialog title="ลบฉาก ลานหน้าประตู?" onClose={() => setDialog(false)}
      footer={<><Button onClick={() => setDialog(false)}>ยกเลิก</Button><Button variant="primary" onClick={() => setDialog(false)}>ยืนยันลบฉาก</Button></>}>
      <p style={{ margin: 0 }}>Token และ Object ในฉากนี้จะถูกลบด้วย กด Escape เพื่อปิด</p>
    </Dialog>}
    <ToastViewport />
  </main>
}
