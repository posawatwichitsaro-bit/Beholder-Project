import { tokenRoleLabels } from '../../../shared/model.ts'
import type { TokenRole } from '../../../shared/model.ts'

export function TokenRoleForm({ name, hasMain, save, cancel }: {
  name: string; hasMain: boolean; save: (role: TokenRole) => void; cancel: () => void
}) {
  return <div className="scrim"><section className="dialog compact token-role-dialog" role="dialog" aria-label="เลือกประเภท Token">
    <header><h2>{name}</h2><button onClick={cancel} aria-label="ปิด">×</button></header>
    <button className="token-role-option" aria-label={tokenRoleLabels.character} disabled={hasMain} onClick={() => save('character')}>
      <b>{tokenRoleLabels.character}</b><small>{hasMain ? 'ผู้เล่นนี้มีตัวละครหลักในฉากแล้ว' : 'ตัวละครหลักประจำฉาก · เคลื่อนที่ด้วยปุ่มลูกศร'}</small>
    </button>
    <button className="token-role-option" aria-label={tokenRoleLabels.companion} onClick={() => save('companion')}>
      <b>{tokenRoleLabels.companion}</b><small>ผู้ร่วมทาง · ใช้ชีตเต็มรูปแบบและลากเพื่อเคลื่อนที่</small>
    </button>
  </section></div>
}
