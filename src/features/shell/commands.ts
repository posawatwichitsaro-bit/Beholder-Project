/** One entry in the Command Palette. */
export type PaletteCommand = {
  id: string
  label: string
  /** Heading the entry is listed under. */
  group: string
  keywords?: string
  shortcut?: string
  disabled?: boolean
  run: () => void
}

/**
 * Every word typed must appear somewhere in the label or keywords
 * (case-insensitive, any order). An empty query lists everything.
 */
export function filterCommands<T extends Pick<PaletteCommand, 'label' | 'keywords' | 'group'>>(items: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return items
  return items.filter(item => {
    const haystack = (item.label + ' ' + (item.keywords ?? '') + ' ' + item.group).toLowerCase()
    return words.every(word => haystack.includes(word))
  })
}
