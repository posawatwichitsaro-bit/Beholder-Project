/** "2d6+1d4+3" from the dice picked in the panel (largest dice first) and a modifier; empty when no dice. */
export function composeFormula(pool: Partial<Record<number, number>>, modifier: number) {
  const groups = Object.entries(pool).filter(([, count]) => count && count > 0)
    .sort(([a], [b]) => Number(b) - Number(a)).map(([sides, count]) => count + 'd' + sides)
  if (!groups.length) return ''
  return groups.join('+') + (modifier ? (modifier > 0 ? '+' : '') + modifier : '')
}
