import type { Scene } from '../../../shared/model.ts'
import type { Send } from '../../state/useCommand.ts'

export type SceneOperation = { mode: 'copy' | 'delete'; scene: Scene }

export function SceneForm({ scene, save, cancel }: { scene?: Scene; save: Send; cancel: () => void }) {
  return <div className="scrim"><form className="dialog compact" onSubmit={async event => {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    if (await save({ type: 'scene', sceneId: scene?.id, name: fields.get('name'), cell: Number(fields.get('cell')), originX: Number(fields.get('x')), originY: Number(fields.get('y')) })) cancel()
  }}>
    <header><h2>{scene ? 'ตั้งค่า Grid' : 'สร้างฉาก'}</h2><button type="button" onClick={cancel} aria-label="ปิด">×</button></header>
    <label>ชื่อฉาก<input required name="name" maxLength={120} defaultValue={scene?.name} /></label>
    <label>ขนาดช่อง (px)<input required name="cell" type="number" min={12} max={300} defaultValue={scene?.cell ?? 48} /></label>
    <div className="form-grid">
      <label>จุดกำเนิด X<input required name="x" type="number" defaultValue={scene?.originX ?? 0} /></label>
      <label>จุดกำเนิด Y<input required name="y" type="number" defaultValue={scene?.originY ?? 0} /></label>
    </div>
    <footer><button type="button" onClick={cancel}>ยกเลิก</button><button className="primary">บันทึกฉาก</button></footer>
  </form></div>
}

export function SceneOperationForm({ operation, save, cancel }: {
  operation: SceneOperation; save: Send; cancel: () => void
}) {
  const { mode, scene } = operation
  const title = mode === 'copy' ? 'คัดลอกฉาก' : 'ลบฉาก'
  return <div className="scrim"><form className="dialog compact" role="dialog" aria-label={title} onSubmit={async event => {
    event.preventDefault()
    const name = new FormData(event.currentTarget).get('name')
    if (await save({ type: mode === 'copy' ? 'copyScene' : 'deleteScene', sceneId: scene.id, name })) cancel()
  }}>
    <header><h2>{title}</h2><button type="button" onClick={cancel} aria-label="ปิด">×</button></header>
    {mode === 'copy'
      ? <label>ชื่อฉากสำเนา<input name="name" required maxLength={120} defaultValue={scene.name.slice(0, 110) + ' (สำเนา)'} /></label>
      : <p>ลบฉาก <b>{scene.name}</b> พร้อม Token และ Object ที่วางในฉากนี้?</p>}
    <footer><button type="button" onClick={cancel}>ยกเลิก</button><button className={mode === 'copy' ? 'primary' : 'danger'}>
      {mode === 'copy' ? 'สร้างสำเนา' : 'ยืนยันลบฉาก'}</button></footer>
  </form></div>
}
