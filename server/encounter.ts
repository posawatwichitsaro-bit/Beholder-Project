import { randomUUID } from 'node:crypto'
import { blankSheet } from '../shared/model.ts'
import type { Actor, Room, Scene } from '../shared/model.ts'

export function createRoadsideEncounter(room: Room, ownerId: string) {
  const scene: Scene = { id: randomUUID(), name: 'ด่านร้างริมทาง', cell: 56, originX: 0, originY: 0, tokens: [], objects: [] }
  const scouts = randomUUID()
  const monsters: { actor: Actor; x: number; y: number }[] = [
    { actor: { ...blankSheet('monster'), ownerId, id: randomUUID(), name: 'ยามด่าน', hp: 14, maxHp: 14, ac: 13, attack: 4, damage: '1d6+2', initiative: 1 }, x: 7, y: 4 },
    ...[3, 6].map((y, index) => ({
      actor: { ...blankSheet('monster'), ownerId, id: randomUUID(), templateId: scouts, name: 'ลูกสมุน ' + (index + 1), hp: 7, maxHp: 7, ac: 12, attack: 3, damage: '1d4+1', initiative: 2 },
      x: 9, y
    }))
  ]
  for (const { actor, x, y } of monsters) {
    actor.lootDc = 12
    actor.inventory = [
      { id: randomUUID(), name: 'เหรียญทองแดง', description: '', quantity: 5, lootTier: 'basic' },
      { id: randomUUID(), name: 'หินขัดตราด่าน', description: 'ของที่ซ่อนไว้ด้านในเสื้อคลุม', quantity: 1, lootTier: 'bonus' }
    ]
    room.actors.push(actor)
    scene.tokens.push({ id: randomUUID(), actorId: actor.id, x, y })
  }
  scene.objects!.push(
    { id: randomUUID(), kind: 'structure', name: 'แนวกั้นไม้', description: 'แนวกั้นเตี้ย ให้ Half Cover', x: 6, y: 3, width: 1, height: 3, hp: 12, maxHp: 12, ac: 12, cover: 2 },
    { id: randomUUID(), kind: 'container', name: 'หีบส่งเสบียง', description: 'หีบเก่าข้างด่าน', x: 8, y: 5, width: 1, height: 1, open: false,
      items: [{ id: randomUUID(), name: 'ยารักษา', description: 'ให้ DM ตัดสินผลเมื่อใช้' }], lock: { dc: 15, locked: true, tried: [] } },
    { id: randomUUID(), kind: 'prop', name: 'ป้ายด่าน', description: 'ซากป้ายประกาศที่หลุดจากเสา', x: 5, y: 6, width: 1, height: 1 }
  )
  room.scenes.push(scene)
  room.activeSceneId ??= scene.id
}
