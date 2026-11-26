/**
 * One field for HP: a plain or "+" number heals, a "-" number is damage.
 * Returns undefined for anything else (empty, zero, not a whole number, over 9999).
 */
export function readHpChange(text: string): { mode: 'heal' | 'damage'; amount: number } | undefined {
  const match = /^\s*([+\-−]?)\s*(\d{1,4})\s*$/.exec(text)
  if (!match) return undefined
  const amount = Number(match[2])
  if (!amount) return undefined
  return { mode: match[1] === '-' || match[1] === '−' ? 'damage' : 'heal', amount }
}
