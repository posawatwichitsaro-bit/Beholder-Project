import { Menu, Search, Wifi, WifiOff } from 'lucide-react'
import { BeholderEyeIcon, Button } from '../../ui/index.ts'

/**
 * The 58 px bar above the map: menu toggle, where the table is, the DM's
 * publish button, the Command Palette and who you are.
 */
export function HudTopBar({ sceneName, roomName, preparing, live, canPublish, publish, railOpen, toggleRail, openPalette, online, me, dm }: {
  sceneName?: string; roomName: string
  /** DM is looking at a scene players cannot see yet. */
  preparing: boolean
  /** Players can see the scene on screen. */
  live: boolean
  canPublish: boolean; publish: () => void
  railOpen: boolean; toggleRail: () => void
  openPalette: () => void
  online: boolean; me: string; dm: boolean
}) {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return <header className="table-header hud-top">
    <button type="button" className="hud-menu" aria-label="เมนูโต๊ะ" aria-expanded={railOpen} aria-controls="hud-rail" onClick={toggleRail}>
      <Menu size={20} aria-hidden="true" />
    </button>
    <BeholderEyeIcon size={22} className="hud-brand" />
    <div className="table-location hud-location">
      <h1>{sceneName ?? 'กระดาน'}</h1>
      <span>
        {roomName}
        {sceneName && dm && <span className={'hud-scene-state' + (preparing ? ' preparing' : live ? ' live' : '')}>
          {preparing ? ' · ฉากเตรียม' : live ? ' · ผู้เล่นเห็นฉากนี้' : ''}
        </span>}
      </span>
    </div>
    {canPublish && <Button variant="brass" className="primary publish-scene" onClick={publish}>เปิดให้ผู้เล่น</Button>}
    <button type="button" className="hud-search" aria-label="ค้นหาคำสั่ง" aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'} onClick={openPalette}>
      <Search size={16} aria-hidden="true" />
      <span className="hud-search-text">ค้นหาคำสั่ง</span>
      <kbd className="bh-kbd" aria-hidden="true">{mac ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
    <div className="identity hud-identity">
      <span className={online ? 'online' : 'offline'} title={online ? 'เชื่อมต่อสด' : 'กำลังเชื่อมต่อใหม่'}>
        {online ? <Wifi size={14} aria-hidden="true" /> : <WifiOff size={14} aria-hidden="true" />}
        {online ? 'สด' : 'กำลังเชื่อมต่อ'}
      </span>
      <span className="hud-me">{me} · {dm ? 'DM' : 'ผู้เล่น'}</span>
    </div>
  </header>
}
