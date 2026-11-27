import type { Ability, Effect } from './model.ts'
import { hasCondition } from './effects.ts'

/**
 * Advantage and Disadvantage that conditions give a D20 Test (SRD 5.2.1
 * "Conditions"). Each reason is a short Thai phrase shown with the roll.
 * Having both kinds cancels to a normal roll, however many of each there are.
 */
type Creature = { conditions: string; effects?: Effect[] }

export type RollMode = 'normal' | 'advantage' | 'disadvantage'
export type Odds = { advantage: string[]; disadvantage: string[]; autoFail?: string }

const has = (creature: Creature | undefined, name: string) => Boolean(creature && hasCondition(creature, name))

/** An attack roll: the attacker's own conditions, the target's, and whether the attacker stands within 5 feet. */
export function attackOdds(attacker: Creature, target: Creature | undefined, adjacent: boolean): Odds {
  const advantage: string[] = []
  const disadvantage: string[] = []
  for (const name of ['Blinded', 'Poisoned', 'Prone', 'Restrained', 'Frightened']) if (has(attacker, name)) disadvantage.push('ผู้โจมตี ' + name)
  if (has(attacker, 'Invisible')) advantage.push('ผู้โจมตี Invisible')
  for (const name of ['Blinded', 'Paralyzed', 'Petrified', 'Restrained', 'Stunned', 'Unconscious']) if (has(target, name)) advantage.push('เป้าหมาย ' + name)
  if (has(target, 'Invisible')) disadvantage.push('เป้าหมาย Invisible')
  // Prone (and Unconscious, which leaves you Prone): close attackers gain, distant ones lose.
  if (has(target, 'Prone')) (adjacent ? advantage : disadvantage).push('เป้าหมาย Prone' + (adjacent ? '' : ' (ระยะไกล)'))
  return { advantage, disadvantage }
}

/** An ability check, saving throw or Initiative roll by this creature. */
export function rollOdds(creature: Creature, kind: 'check' | 'save' | 'initiative', ability?: Ability): Odds {
  const advantage: string[] = []
  const disadvantage: string[] = []
  if (kind !== 'save') for (const name of ['Poisoned', 'Frightened']) if (has(creature, name)) disadvantage.push(name)
  if (kind === 'initiative' && has(creature, 'Invisible')) advantage.push('Invisible')
  if (kind === 'save' && ability === 'DEX' && has(creature, 'Restrained')) disadvantage.push('Restrained')
  const autoFail = kind === 'save' && (ability === 'STR' || ability === 'DEX')
    ? ['Paralyzed', 'Petrified', 'Stunned', 'Unconscious'].find(name => has(creature, name)) : undefined
  return { advantage, disadvantage, ...(autoFail ? { autoFail } : {}) }
}

/** The mode the odds come to: any Advantage with any Disadvantage is a normal roll. */
export function oddsMode(odds: Odds): RollMode {
  const up = odds.advantage.length > 0
  const down = odds.disadvantage.length > 0
  return up === down ? 'normal' : up ? 'advantage' : 'disadvantage'
}

/**
 * The mode a roll uses: the roller's own choice when they made one (right-click
 * menu, Advantage toggles), otherwise what the conditions say. The note explains it.
 */
export function chooseMode(odds: Odds, chosen?: RollMode): { mode: RollMode; note: string } {
  const auto = oddsMode(odds)
  const reasons = auto === 'advantage' ? odds.advantage : auto === 'disadvantage' ? odds.disadvantage : [...odds.advantage, ...odds.disadvantage]
  if (chosen) return { mode: chosen, note: chosen === 'normal' ? '' : labels[chosen] + ' (เลือกเอง)' }
  if (auto === 'normal') return { mode: auto, note: reasons.length ? 'หักล้างกัน: ' + reasons.join(', ') : '' }
  return { mode: auto, note: labels[auto] + ' · ' + reasons.join(', ') }
}
const labels = { advantage: 'Advantage', disadvantage: 'Disadvantage' } as const

/** A command's explicit choice: `rollMode`, or the older `advantage` / `disadvantage` flags. Undefined means "let the rules decide". */
export function chosenMode(command: { rollMode?: unknown; advantage?: unknown; disadvantage?: unknown }): RollMode | undefined {
  if (command.rollMode === 'normal' || command.rollMode === 'advantage' || command.rollMode === 'disadvantage') return command.rollMode
  if (command.advantage === true && command.disadvantage !== true) return 'advantage'
  if (command.disadvantage === true && command.advantage !== true) return 'disadvantage'
  if (command.advantage === true && command.disadvantage === true) return 'normal'
  return undefined
}

/** Whether two tokens (top-left cell and size in squares) stand within 5 feet: less than a square between their edges. */
export function withinReach(a: { x: number; y: number }, aSize: number, b: { x: number; y: number }, bSize: number) {
  const gapX = Math.max(0, b.x - (a.x + aSize), a.x - (b.x + bSize))
  const gapY = Math.max(0, b.y - (a.y + aSize), a.y - (b.y + bSize))
  return Math.max(gapX, gapY) < 1
}
