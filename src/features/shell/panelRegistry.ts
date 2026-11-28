/**
 * Panel Registry: every panel the table can show, described once.
 *
 * The rail, the keyboard shortcuts and the Command Palette are all built from
 * this list, so a new feature (shop, quest log, world map…) adds one entry
 * here and its content in Table. `roles` hides panels a seat cannot use, so
 * players never see DM tools.
 */
export type PanelId = 'scenes' | 'sheets' | 'actor' | 'objects' | 'combat' | 'dice' | 'log' | 'handouts' | 'world' | 'encounters' | 'manual' | 'items' | 'library' | 'account' | 'settings'
export type PanelGroup = 'board' | 'play' | 'personal'
export type Role = 'dm' | 'player'

export type PanelDef = {
  id: PanelId
  /** Accessible name and tooltip. Browser tests find rail buttons by this text. */
  label: string
  group: PanelGroup
  roles: readonly Role[]
  /** Single key that toggles the panel when focus is not in a text field. */
  shortcut?: string
  /** False for panels opened from elsewhere (the actor sheet opens from a token or list). */
  inRail: boolean
  /** Extra words the Command Palette matches. */
  keywords?: string
}

const everyone = ['dm', 'player'] as const

export const panels: readonly PanelDef[] = [
  { id: 'scenes', label: 'ฉากและแผนที่', group: 'board', roles: everyone, shortcut: 'S', inRail: true, keywords: 'scene map grid invite เชิญ แผนที่' },
  { id: 'sheets', label: 'ชีตในห้อง', group: 'board', roles: everyone, shortcut: 'T', inRail: true, keywords: 'sheet character monster token ตัวละคร มอนสเตอร์ วาง' },
  { id: 'objects', label: 'Object', group: 'board', roles: everyone, shortcut: 'O', inRail: true, keywords: 'object chest item กล่อง ของ' },
  { id: 'combat', label: 'การต่อสู้', group: 'play', roles: everyone, shortcut: 'F', inRail: true, keywords: 'combat initiative turn fight ต่อสู้ เทิร์น' },
  { id: 'dice', label: 'ลูกเต๋า', group: 'play', roles: everyone, shortcut: 'D', inRail: true, keywords: 'dice roll d20 ทอย ผลทอย' },
  { id: 'log', label: 'บันทึกการผจญภัย', group: 'play', roles: everyone, shortcut: 'L', inRail: true, keywords: 'adventure log chat history message แชท ข้อความ บันทึก ประวัติ' },
  { id: 'handouts', label: 'เอกสาร', group: 'play', roles: everyone, shortcut: 'H', inRail: true, keywords: 'handout letter document canva presentation slide เอกสาร จดหมาย นำเสนอ ภาพ' },
  { id: 'world', label: 'แผนที่โลก', group: 'play', roles: everyone, shortcut: 'W', inRail: true, keywords: 'world map region city travel pin party แผนที่โลก ภูมิภาค เมือง หมุด เดินทาง ปาร์ตี้' },
  { id: 'encounters', label: 'Encounter', group: 'play', roles: ['dm'], shortcut: 'E', inRail: true, keywords: 'encounter builder xp budget difficulty monster group ambush ต่อสู้ มอนสเตอร์ งบ xp ความยาก' },
  { id: 'manual', label: 'Monster Manual', group: 'play', roles: everyone, shortcut: 'N', inRail: true, keywords: 'monster srd bestiary มอนสเตอร์' },
  { id: 'items', label: 'คลังไอเทม SRD', group: 'play', roles: everyone, shortcut: 'I', inRail: true, keywords: 'item catalog equipment loot srd ไอเทม ของ อาวุธ วางบนฉาก' },
  { id: 'library', label: 'คลังส่วนตัว', group: 'personal', roles: everyone, shortcut: 'B', inRail: true, keywords: 'library saved คลัง' },
  { id: 'account', label: 'ตั้งค่าบัญชี', group: 'personal', roles: everyone, inRail: true, keywords: 'account settings name logout บัญชี ออกจากระบบ' },
  { id: 'settings', label: 'ตั้งค่าการแสดงผล', group: 'personal', roles: everyone, shortcut: 'P', inRail: true, keywords: 'settings preferences size scale sound motion grid tour help shortcut ตั้งค่า ขนาด เสียง แอนิเมชัน ทัวร์ ปุ่มลัด' },
  { id: 'actor', label: 'ชีตตัวละคร', group: 'board', roles: everyone, inRail: false }
]

export const groupLabels: Record<PanelGroup, string> = { board: 'กระดาน', play: 'การเล่น', personal: 'ส่วนตัว' }

export function panelsFor(role: Role) {
  return panels.filter(panel => panel.roles.includes(role))
}

export function panelById(id: PanelId) {
  return panels.find(panel => panel.id === id)!
}

/** The panel a single-key shortcut opens for this role, if any. */
export function panelForShortcut(key: string, role: Role) {
  const upper = key.toUpperCase()
  return panelsFor(role).find(panel => panel.shortcut === upper)
}
