import { useEffect, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import type { Scene } from '../../../shared/model.ts'
import { Button } from '../../ui/index.ts'
import { fitGrid } from './gridFit.ts'
import type { GridFit, MapRect } from './gridFit.ts'

/**
 * Floating helper for lining the grid up with a map: drag a box over one
 * square (or several, and say how many), watch the grid follow live, nudge it
 * a pixel at a time, then save. Typing numbers stays available in "ตั้งค่า Grid".
 */
export function GridCalibrator({ scene, rect, preview, save, cancel }: {
  scene: Scene; rect?: MapRect; preview: (fit: GridFit) => void
  save: (fit: GridFit) => Promise<boolean>; cancel: () => void
}) {
  const [across, setAcross] = useState(1)
  const [fit, setFit] = useState<GridFit>({ cell: scene.cell, originX: scene.originX, originY: scene.originY })
  useEffect(() => { if (rect) setFit(fitGrid(rect, across)) }, [rect, across])
  useEffect(() => { preview(fit) }, [fit])
  const nudge = (key: keyof GridFit, delta: number) => setFit(current => ({ ...current, [key]: key === 'cell' ? Math.max(12, Math.min(300, current[key] + delta)) : current[key] + delta }))
  const stepper = (key: keyof GridFit, label: string) => <div className="grid-stepper">
    <span>{label}</span>
    <button type="button" aria-label={'ลด ' + label} onClick={() => nudge(key, -1)}><Minus size={14} aria-hidden="true" /></button>
    <b>{fit[key]}</b>
    <button type="button" aria-label={'เพิ่ม ' + label} onClick={() => nudge(key, 1)}><Plus size={14} aria-hidden="true" /></button>
  </div>
  return <section className="grid-calibrator bh-on-parchment" aria-label="ปรับ Grid บนภาพ">
    <h2>ปรับ Grid บนภาพ · {scene.name}</h2>
    <p>{rect ? 'ดูเส้น Grid บนแผนที่ ถ้ายังไม่ตรงให้ลากกรอบใหม่หรือขยับทีละพิกเซล' : 'ลากกรอบทับช่องสี่เหลี่ยม 1 ช่องบนแผนที่ (ลากทับหลายช่องจะแม่นกว่า แล้วบอกจำนวนช่องด้านล่าง)'}</p>
    <label>กรอบครอบกี่ช่อง (แนวนอน)<input type="number" min={1} max={40} value={across} onChange={event => setAcross(Math.max(1, Math.min(40, event.target.valueAsNumber || 1)))} /></label>
    {stepper('cell', 'ขนาดช่อง (px)')}
    {stepper('originX', 'จุดกำเนิด X')}
    {stepper('originY', 'จุดกำเนิด Y')}
    <div className="grid-calibrator-actions">
      <Button onClick={cancel}>ยกเลิก</Button>
      <Button variant="primary" onClick={() => void save(fit)}>บันทึก Grid</Button>
    </div>
  </section>
}
