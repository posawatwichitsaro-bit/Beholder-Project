import type { Area } from './area.ts'
import type { CharacterCalculations, CheckBonus, Skill } from './characterStats.ts'

export const abilities = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const
export const damageKinds = {
  untyped: ['ทั่วไป', '#f8f0df'], bludgeoning: ['กระแทก', '#dfc298'], piercing: ['แทง', '#e9c7c0'],
  slashing: ['ฟัน', '#ff9c9c'], fire: ['ไฟ', '#ff884e'], cold: ['เย็น', '#91ddff'],
  lightning: ['สายฟ้า', '#ffdb69'], acid: ['กรด', '#bfe76f'], poison: ['พิษ', '#91e58f'],
  thunder: ['เสียง', '#c5b4ff'], radiant: ['แสง', '#ffe69f'], necrotic: ['เนโครติก', '#d5b5ed'],
  force: ['พลังเวท', '#86f0e6'], psychic: ['จิต', '#f5a0da']
} as const
export type DamageKind = keyof typeof damageKinds
export type DamageEvent = { id: string; actorId: string; amount: number; kind: DamageKind; at: number }
export const sizes = { Tiny: 0.5, Small: 1, Medium: 1, Large: 2, Huge: 3, Gargantuan: 4 }
export type Ability = typeof abilities[number]
export type Size = keyof typeof sizes
export type Member = { id: string; name: string; role: 'dm' | 'player' }
export type Account = { email: string; name: string }
/** One row of the lobby's "my tables" list (GET /api/account/rooms). */
export type TableSummary = {
  id: string; name: string; role: Member['role']
  /** Scene players currently see, if any. */
  sceneName?: string
  /** Thumbnail of the active scene's map; served only to seated members. */
  mapUrl?: string
  members: { name: string; role: Member['role']; online: boolean }[]
  /** ISO time of the last change at the table. */
  updatedAt: string
}
export type Sheet = {
  name: string; kind: 'pc' | 'monster'; size: Size; speed: number
  classLevel: string; abilities: Record<Ability, number>; proficiency: number
  skills: string; saves: string; hp: number; maxHp: number; tempHp: number; ac: number
  initiative: number; attack: number; damage: string; spellAttack: number; spellDC: number
  attacks?: { name: string; bonus: number; damage: string; damageKind?: DamageKind; notes?: string }[]
  spells: string; slots: string; conditions: string
  portrait?: string
  monsterReference?: { statBlock: string; page?: number }
  inventory?: InventoryItem[]
  itemProficiency?: ItemProficiency
  lootDc?: number
  lootSkill?: LootSkill
  calculations?: CharacterCalculations
  skillChecks?: Partial<Record<Skill, CheckBonus>>
  savingThrows?: Partial<Record<Ability, CheckBonus>>
  characterDetails?: { species?: string; background?: string; hitDice?: string; defenses?: string }
  successes: number; failures: number; life: 'active' | 'dying' | 'stable' | 'dead'
}
export type Actor = Sheet & { id: string; ownerId: string; templateId?: string; lootResult?: LootResult }
export type Template = { id: string; sheet: Sheet }
export type Library = { name: string; sheets: Template[]; objects: SavedObject[] }
export type MapAsset = { id: string; mime: string }
export const tokenRoleLabels = { character: 'Character Token', companion: 'Companion Token' } as const
export type TokenRole = keyof typeof tokenRoleLabels
export type Token = { id: string; actorId: string; x: number; y: number; role?: TokenRole }
export type ItemProficiency = { thievesTools: boolean; sleight: boolean; investigation: boolean; perception: boolean }
export type LootSkill = 'investigation' | 'perception'
export type LootResult = { passed: boolean; total: number; searcher: string; found: { name: string; quantity: number }[] }
export type InventoryItem = {
  id: string; name: string; description: string; image?: string
  quantity?: number; tool?: 'thievesTools'; lootTier?: 'basic' | 'bonus'
}
export type ObjectKind = 'container' | 'prop' | 'structure' | 'item'
export const objectLabels: Record<ObjectKind, string> = {
  container: 'กล่อง', prop: 'ของประกอบฉาก', structure: 'สิ่งก่อสร้าง', item: 'ไอเทม'
}
export type SceneObject = {
  id: string; name: string; description: string; image?: string
  x: number; y: number; width: number; height: number
} & (
  { kind: 'container'; open: boolean; items: InventoryItem[]; lock?: { dc: number; locked: boolean; tried: string[]; last?: { total: number; passed: boolean } } }
  | { kind: 'structure'; hp: number; maxHp: number; ac: number; cover: 0 | 2 | 5 | 99 }
  | { kind: 'item' | 'prop' }
)
export type ObjectDefinition = Pick<SceneObject, 'name' | 'description' | 'image' | 'width' | 'height'> & (
  { kind: 'container'; items: Omit<InventoryItem, 'id'>[]; lockDc?: number }
  | { kind: 'structure'; hp: number; ac: number; cover: 0 | 2 | 5 | 99 }
  | { kind: 'item' | 'prop' }
)
export type SavedObject = { id: string; definition: ObjectDefinition }

export function objectDefinition(object: SceneObject): ObjectDefinition {
  const { kind, name, description, image, width, height } = object
  const fields = { name, description, image, width, height }
  if (kind === 'container') return {
    ...fields, kind, items: object.items.map(({ id: _id, ...item }) => item), lockDc: object.lock?.locked ? object.lock.dc : undefined
  }
  if (kind === 'structure') return { ...fields, kind, hp: object.maxHp, ac: object.ac, cover: object.cover }
  return { ...fields, kind }
}

export type Combat = {
  order: { actorId: string; initiative: number }[]; turn: number; round: number
  deathSaveAt?: string
}
export function nextLivingTurn(combat: Combat, isDead: (actorId: string) => boolean) {
  for (let offset = 1; offset <= combat.order.length; offset++) {
    const step = combat.turn + offset
    const turn = step % combat.order.length
    if (!isDead(combat.order[turn].actorId)) return { turn, round: combat.round + Math.floor(step / combat.order.length) }
  }
}
export type Scene = {
  id: string; name: string; cell: number; originX: number; originY: number
  map?: MapAsset; tokens: Token[]; combat?: Combat; objects?: SceneObject[]
  damageEvents?: DamageEvent[]; areaEffect?: { area: Area; kind: DamageKind; at: number }
}
export type Roll = {
  id: string; name: string; label: string; formula: string; faces: number[]
  total: number; modifier: number; outcome?: string; targetId?: string; applied?: boolean
  cast?: { ability: Ability; dc: number; targetId: string; damage?: string; half: boolean; resolved?: boolean }
  critical?: boolean; privateTo?: string; sceneId?: string; sourceId?: string; damageKind?: DamageKind
}
export type Room = {
  id: string; name: string; invite: string; dmInvite?: string; revision: number; members: (Member & { profileId?: string })[]
  activeSceneId?: string; scenes: Scene[]; actors: Actor[]; templates: Template[]; rolls: Roll[]
}
export type Snapshot = Omit<Room, 'invite' | 'dmInvite' | 'actors' | 'members'> & {
  me: Member; members: Member[]; invite?: string; dmInvite?: string; actors: Actor[]
  publicActors: (Pick<Actor, 'id' | 'name' | 'kind' | 'size' | 'portrait' | 'hp' | 'maxHp' | 'tempHp' | 'lootResult'> & { lootable?: boolean })[]
  combatQueue?: Roll[]
}
export function blankSheet(kind: Sheet['kind'] = 'pc'): Sheet {
  return {
    name: '', kind, size: 'Medium', speed: 30, classLevel: '', proficiency: 2,
    abilities: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    skills: '', saves: '', maxHp: 10, hp: 10, tempHp: 0, ac: 10,
    initiative: 0, attack: 0, damage: '1d6', spellAttack: 0, spellDC: 10,
    spells: '', slots: '', conditions: '', successes: 0, failures: 0, life: 'active'
  }
}
