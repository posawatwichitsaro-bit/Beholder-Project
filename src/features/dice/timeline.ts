import type { LogEntry, Roll } from '../../../shared/model.ts'

export type TimelineEntry =
  | { type: 'roll'; id: string; at: number; roll: Roll }
  | { type: 'log'; id: string; at: number; entry: LogEntry }

/**
 * One Adventure Log: rolls and log lines in the order they happened.
 * Rolls saved before rolls had times keep their order at the start.
 */
export function timeline(rolls: Roll[], log: LogEntry[]): TimelineEntry[] {
  const untimed = rolls.filter(roll => roll.at === undefined)
  const timed: TimelineEntry[] = [
    ...rolls.filter(roll => roll.at !== undefined).map(roll => ({ type: 'roll' as const, id: roll.id, at: roll.at!, roll })),
    ...log.map(entry => ({ type: 'log' as const, id: entry.id, at: entry.at, entry }))
  ].sort((a, b) => a.at - b.at)
  return [...untimed.map(roll => ({ type: 'roll' as const, id: roll.id, at: 0, roll })), ...timed]
}
