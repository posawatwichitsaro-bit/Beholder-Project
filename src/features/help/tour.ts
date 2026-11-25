import type { Role } from '../../state/prefs.ts'

export type TourStep = {
  /** CSS selector of the thing being explained; missing or hidden targets show the card in the middle. */
  target?: string
  /** Shown instead when the target is hidden, e.g. the menu button while the rail is folded away on a phone. */
  fallback?: string
  title: string
  body: string
}
export type Rect = { left: number; top: number; width: number; height: number }
export type Size = { width: number; height: number }

const rail = (label: string) => `#hud-rail button[aria-label="${label}"]`

/** What each seat needs to know first, in the order they will need it. */
export const tours: Record<Role, TourStep[]> = {
  dm: [
    { title: 'ยินดีต้อนรับสู่โต๊ะของคุณ', body: 'ทัวร์สั้น ๆ 6 จุดสำหรับ DM กด “ถัดไป” หรือ “ข้าม” ได้ทุกเมื่อ และเปิดดูใหม่ได้ที่ ตั้งค่าการแสดงผล' },
    { target: rail('ฉากและแผนที่'), fallback: '.hud-menu', title: 'เริ่มจากฉาก', body: 'สร้างฉาก อัปโหลดแผนที่ ปรับ Grid และคัดลอกลิงก์เชิญผู้เล่นได้ที่นี่ หรือกดปุ่ม S' },
    { target: '.hud-location', title: 'ฉากเตรียมกับฉากที่ผู้เล่นเห็น', body: 'คุณดูและจัดฉากล่วงหน้าได้โดยผู้เล่นยังไม่เห็น พร้อมแล้วกด “เปิดให้ผู้เล่น” บนแถบนี้' },
    { target: '.workspace', title: 'กระดาน', body: 'ลากชื่อจากชีตลงช่องเพื่อวาง Token คลิกขวา (หรือกดค้างบนจอสัมผัส) ที่ช่องหรือ Token เพื่อดูคำสั่งทั้งหมด' },
    { target: '.hud-manage', title: 'ห้องเก็บของ DM', body: 'ดู Token, Item และฉากทั้งเรื่องในตารางเดียว เลือกหลายรายการแล้วจัดการพร้อมกันได้ กด M เพื่อเปิด' },
    { target: '.hud-search', title: 'ลืมว่าอยู่ตรงไหน ค้นหาได้', body: 'กด Ctrl K (⌘K บน Mac) แล้วพิมพ์สิ่งที่ต้องการ เช่น “ต่อสู้” “ทอย” หรือ “Grid”' }
  ],
  player: [
    { title: 'ยินดีต้อนรับนักผจญภัย', body: 'ทัวร์สั้น ๆ 5 จุด กด “ถัดไป” หรือ “ข้าม” ได้ทุกเมื่อ และเปิดดูใหม่ได้ที่ ตั้งค่าการแสดงผล' },
    { target: rail('ชีตในห้อง'), fallback: '.hud-menu', title: 'สร้างตัวละคร', body: 'เปิด ชีตในห้อง แล้วกด “+ ตัวละคร” ตัวช่วยจะพาสร้างทีละขั้น เสร็จแล้วลากชื่อลงกระดานเพื่อวาง Token' },
    { target: '.workspace', title: 'เดินบนกระดาน', body: 'ใช้ปุ่มลูกศรขยับตัวละครหลักได้ทันที หรือลาก Token ไปวาง คลิกขวาที่ Token เพื่อดูคำสั่ง' },
    { target: rail('ลูกเต๋า'), fallback: '.hud-menu', title: 'ทอยเต๋า', body: 'ทอยจากชีตได้เลยด้วยการกดที่ค่าความสามารถหรือการโจมตี หรือเปิดแผงลูกเต๋าด้วยปุ่ม D ผลทอยทุกคนเห็นพร้อมกัน' },
    { target: '.hud-search', title: 'หาอะไรไม่เจอ ค้นหาได้', body: 'กด Ctrl K (⌘K บน Mac) แล้วพิมพ์สิ่งที่ต้องการ เช่น “ทอย” “ชีต” หรือ “บันทึก”' }
  ]
}

/**
 * Where the tour card goes: below the target if it fits, else above, else
 * beside it, else centred — always kept inside the viewport with a margin.
 */
export function placeCard(target: Rect | undefined, card: Size, view: Size, gap = 12, margin = 12): { left: number; top: number; side: 'below' | 'above' | 'left' | 'right' | 'center' } {
  const clampX = (x: number) => Math.max(margin, Math.min(view.width - card.width - margin, x))
  const clampY = (y: number) => Math.max(margin, Math.min(view.height - card.height - margin, y))
  const center = { left: clampX((view.width - card.width) / 2), top: clampY((view.height - card.height) / 2), side: 'center' as const }
  if (!target) return center
  const middleX = clampX(target.left + target.width / 2 - card.width / 2)
  const middleY = clampY(target.top + target.height / 2 - card.height / 2)
  if (target.top + target.height + gap + card.height + margin <= view.height) return { left: middleX, top: target.top + target.height + gap, side: 'below' }
  if (target.top - gap - card.height >= margin) return { left: middleX, top: target.top - gap - card.height, side: 'above' }
  if (target.left - gap - card.width >= margin) return { left: target.left - gap - card.width, top: middleY, side: 'left' }
  if (target.left + target.width + gap + card.width + margin <= view.width) return { left: target.left + target.width + gap, top: middleY, side: 'right' }
  return center
}
