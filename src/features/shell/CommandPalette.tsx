import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, Search } from 'lucide-react'
import { filterCommands } from './commands.ts'
import type { PaletteCommand } from './commands.ts'

/**
 * Ctrl/⌘+K: type to find any panel or action. Arrow keys move, Enter runs,
 * Escape closes. Follows the combobox + listbox pattern so screen readers
 * announce the highlighted entry.
 */
export function CommandPalette({ commands, close }: { commands: PaletteCommand[]; close: () => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const listId = useId()
  const results = useMemo(() => filterCommands(commands, query), [commands, query])
  const current = results[Math.min(active, results.length - 1)]
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { setActive(0) }, [query])
  useEffect(() => {
    list.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' })
  }, [active])
  function run(item?: PaletteCommand) {
    if (!item || item.disabled) return
    close()
    item.run()
  }
  let lastGroup = ''
  return <div className="bh-scrim scrim hud-palette-scrim" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <div className="hud-palette" role="dialog" aria-modal="true" aria-label="ค้นหาคำสั่ง">
      <label className="hud-palette-search">
        <Search size={18} aria-hidden="true" />
        <input ref={input} value={query} placeholder="พิมพ์ชื่อแผงหรือคำสั่ง เช่น ทอย, ฉาก, ต่อสู้"
          role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={current ? listId + '-' + current.id : undefined} aria-label="ค้นหาคำสั่ง"
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(results.length - 1, index + 1)) }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)) }
            else if (event.key === 'Enter') { event.preventDefault(); run(current) }
            else if (event.key === 'Escape') { event.preventDefault(); close() }
          }} />
      </label>
      <ul ref={list} id={listId} role="listbox" aria-label="ผลการค้นหา" className="hud-palette-list">
        {results.map(item => {
          const header = item.group !== lastGroup ? item.group : ''
          lastGroup = item.group
          const selected = item === current
          return <li key={item.id} role="presentation">
            {header && <span className="hud-palette-group" aria-hidden="true">{header}</span>}
            <div id={listId + '-' + item.id} role="option" aria-selected={selected} aria-disabled={item.disabled || undefined}
              className="hud-palette-item" onMouseMove={() => setActive(results.indexOf(item))} onClick={() => run(item)}>
              <span>{item.label}</span>
              {item.shortcut && <kbd className="bh-kbd">{item.shortcut}</kbd>}
              {selected && <CornerDownLeft size={14} aria-hidden="true" className="hud-palette-enter" />}
            </div>
          </li>
        })}
        {!results.length && <li className="hud-palette-empty" role="presentation">ไม่พบคำสั่งที่ตรงกับ “{query}”</li>}
      </ul>
      <footer className="hud-palette-foot" aria-hidden="true"><span>↑ ↓ เลือก</span><span>Enter ใช้คำสั่ง</span><span>Esc ปิด</span></footer>
    </div>
  </div>
}
