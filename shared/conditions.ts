/**
 * Conditions and spell slots, readable by the system but still stored in the
 * sheet's existing text fields so older sheets keep working:
 *   conditions: "Prone, Frightened:2, Hexed"   (":2" = rounds left; unknown names are kept as free text)
 *   slots:      "L1 2/4, L2 1/3"                (left / max per spell level)
 */

/** SRD 5.2.1 conditions, plus Concentration because it is tracked the same way at the table. */
export const srdConditions = [
  'Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
  'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious', 'Concentration'
] as const

export const conditionThai: Record<typeof srdConditions[number], string> = {
  Blinded: 'ตาบอด', Charmed: 'ถูกสะกด', Deafened: 'หูหนวก', Exhaustion: 'เหนื่อยล้า', Frightened: 'หวาดกลัว',
  Grappled: 'ถูกจับ', Incapacitated: 'ทำอะไรไม่ได้', Invisible: 'ล่องหน', Paralyzed: 'อัมพาต', Petrified: 'กลายเป็นหิน',
  Poisoned: 'ติดพิษ', Prone: 'ล้มคว่ำ', Restrained: 'ถูกตรึง', Stunned: 'มึนงง', Unconscious: 'หมดสติ', Concentration: 'ตั้งสมาธิ'
}

export type ActiveCondition = { name: string; rounds?: number }

export function parseConditions(value: string): ActiveCondition[] {
  return value.split(/[,،]/).map(part => part.trim()).filter(Boolean).map(part => {
    const match = /^(.*?):(\d{1,2})$/.exec(part)
    return match ? { name: match[1].trim(), rounds: Number(match[2]) } : { name: part }
  })
}

export function formatConditions(list: ActiveCondition[]) {
  return list.map(item => item.rounds ? item.name + ':' + item.rounds : item.name).join(', ')
}

/** At the start of a new round: count down timed conditions and drop the ones that ran out. */
export function tickConditions(value: string) {
  const list = parseConditions(value)
  const expired = list.filter(item => item.rounds === 1).map(item => item.name)
  const kept = list.flatMap(item => item.rounds === undefined ? [item] : item.rounds > 1 ? [{ ...item, rounds: item.rounds - 1 }] : [])
  return { value: formatConditions(kept), expired }
}

export type SlotLevel = { level: number; left: number; max: number }

/** Spell slots in "L1 2/4, L2 1/3" form; undefined when the text is free-form. */
export function parseSlots(value: string): SlotLevel[] | undefined {
  const text = value.trim()
  if (!text) return []
  const parts = text.split(',').map(part => part.trim()).filter(Boolean)
  const levels: SlotLevel[] = []
  for (const part of parts) {
    const match = /^L?(\d)\s+(\d{1,2})\s*\/\s*(\d{1,2})$/i.exec(part)
    if (!match) return undefined
    const level = Number(match[1])
    const max = Number(match[3])
    if (level < 1 || level > 9 || max < 1) return undefined
    levels.push({ level, left: Math.min(max, Number(match[2])), max })
  }
  return levels.sort((a, b) => a.level - b.level)
}

export function formatSlots(levels: SlotLevel[]) {
  return levels.map(slot => 'L' + slot.level + ' ' + slot.left + '/' + slot.max).join(', ')
}
