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

export type ConditionName = typeof srdConditions[number]

/**
 * What each condition does, in short Thai (paraphrased from SRD 5.2.1), and
 * how it ranks for display: the badges on a token show the most limiting first.
 * `glyph` is the two-letter mark drawn on the canvas, where icons do not fit.
 */
export const conditionInfo: Record<ConditionName, { glyph: string; rank: number; summary: string }> = {
  Unconscious: { glyph: 'Un', rank: 1, summary: 'ติด Incapacitated และ Prone ทำของหล่น Speed 0 พลาด STR/DEX save อัตโนมัติ ถูกโจมตีด้วย Advantage และโดนระยะประชิดเป็น Critical' },
  Paralyzed: { glyph: 'Pa', rank: 2, summary: 'ติด Incapacitated Speed 0 พลาด STR/DEX save อัตโนมัติ ถูกโจมตีด้วย Advantage และโดนระยะประชิดเป็น Critical' },
  Petrified: { glyph: 'Pe', rank: 3, summary: 'กลายเป็นหิน ติด Incapacitated Speed 0 ต้านทาน damage ทุกชนิด ถูกโจมตีด้วย Advantage' },
  Stunned: { glyph: 'St', rank: 4, summary: 'ติด Incapacitated พลาด STR/DEX save อัตโนมัติ ถูกโจมตีด้วย Advantage' },
  Incapacitated: { glyph: 'In', rank: 5, summary: 'ใช้ Action, Bonus Action และ Reaction ไม่ได้ พูดไม่ได้ Concentration ขาด' },
  Restrained: { glyph: 'Re', rank: 6, summary: 'Speed 0 โจมตีด้วย Disadvantage ถูกโจมตีด้วย Advantage และ DEX save มี Disadvantage' },
  Grappled: { glyph: 'Gr', rank: 7, summary: 'Speed 0 โจมตีเป้าหมายอื่นที่ไม่ใช่ผู้จับด้วย Disadvantage ผู้จับลากไปได้' },
  Prone: { glyph: 'Pr', rank: 8, summary: 'คลานหรือใช้ระยะเคลื่อนที่ครึ่งหนึ่งเพื่อลุก โจมตีด้วย Disadvantage ถูกโจมตีระยะประชิดด้วย Advantage ระยะไกลด้วย Disadvantage' },
  Blinded: { glyph: 'Bl', rank: 9, summary: 'มองไม่เห็น พลาด check ที่ต้องใช้สายตา โจมตีด้วย Disadvantage ถูกโจมตีด้วย Advantage' },
  Frightened: { glyph: 'Fr', rank: 10, summary: 'Disadvantage ใน check และการโจมตีเมื่อเห็นต้นเหตุ เข้าใกล้ต้นเหตุไม่ได้' },
  Charmed: { glyph: 'Ch', rank: 11, summary: 'โจมตีผู้สะกดไม่ได้ ผู้สะกดมี Advantage ใน check ทางสังคมกับคุณ' },
  Poisoned: { glyph: 'Po', rank: 12, summary: 'Disadvantage ในการโจมตีและ ability check' },
  Deafened: { glyph: 'De', rank: 13, summary: 'ไม่ได้ยิน พลาด check ที่ต้องใช้การได้ยิน' },
  Invisible: { glyph: 'Iv', rank: 14, summary: 'มองไม่เห็นตัว โจมตีด้วย Advantage ถูกโจมตีด้วย Disadvantage (ยกเว้นผู้มองเห็นได้)' },
  Exhaustion: { glyph: 'Ex', rank: 15, summary: 'หัก D20 Test 2 ต่อระดับ ลด Speed 5 ฟุตต่อระดับ ระดับ 6 ตาย พักยาวลด 1 ระดับ' },
  Concentration: { glyph: 'Co', rank: 16, summary: 'กำลังตั้งสมาธิกับเวท เสียสมาธิเมื่อ Incapacitated หรือพลาด CON save หลังโดน damage (DC 10 หรือครึ่งหนึ่งของ damage)' }
}

/** "Exhaustion 2" → { base: 'Exhaustion', level: 2 }; other names have no level. "Exhaustion" alone is level 1. */
export function conditionBase(name: string): { base: string; level?: number } {
  const exhaustion = /^Exhaustion(?:\s+([1-6]))?$/i.exec(name.trim())
  return exhaustion ? { base: 'Exhaustion', level: Number(exhaustion[1] ?? 1) } : { base: name.trim() }
}
export const isSrdCondition = (name: string): name is ConditionName => (srdConditions as readonly string[]).includes(name)

/** Exhaustion penalties for a level (0 – 6). */
export function exhaustionEffects(level: number) {
  const steps = Math.max(0, Math.min(6, level))
  return { d20: -2 * steps, speed: -5 * steps, dead: steps >= 6 }
}

export type ActiveCondition = { name: string; rounds?: number }

/** Most limiting first; free-text conditions after the SRD ones, in the order they were added. */
export function rankConditions(list: ActiveCondition[]) {
  const rank = (item: ActiveCondition) => {
    const { base } = conditionBase(item.name)
    return isSrdCondition(base) ? conditionInfo[base].rank : 100
  }
  return list.map((item, index) => ({ item, index })).sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index).map(entry => entry.item)
}

/** Two-letter canvas mark: "Pa" for Paralyzed, "E2" for Exhaustion 2, first letters for free text. */
export function conditionGlyph(name: string) {
  const { base, level } = conditionBase(name)
  if (base === 'Exhaustion') return 'E' + level
  return isSrdCondition(base) ? conditionInfo[base].glyph : (base.replace(/\s+/g, '').slice(0, 2) || '?')
}

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
