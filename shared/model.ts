import type { Area } from './area.ts'
import type { ActorVision, SceneVision } from './vision.ts'
import type { TurnUse } from './economy.ts'
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
  /** Where a monster sheet came from: the stat block text, its SRD page, and the catalog id / D&D Beyond page when imported from the SRD catalog. */
  monsterReference?: { statBlock: string; page?: number; id?: string; url?: string }
  inventory?: InventoryItem[]
  itemProficiency?: ItemProficiency
  lootDc?: number
  lootSkill?: LootSkill
  calculations?: CharacterCalculations
  skillChecks?: Partial<Record<Skill, CheckBonus>>
  savingThrows?: Partial<Record<Ability, CheckBonus>>
  characterDetails?: { species?: string; background?: string; hitDice?: string; defenses?: string }
  successes: number; failures: number; life: 'active' | 'dying' | 'stable' | 'dead'
  /** Class resources (Rage, Focus Points…) and Hit Dice spent since the last Long Rest. */
  resources?: ClassResource[]
  hitDiceSpent?: Partial<Record<HitDie, number>>
  /** Conditions with a source, an end and saves (see shared/effects.ts); plain ones stay in `conditions`. */
  effects?: Effect[]
  /** Warlock Pact Magic kept apart from `slots` ("L3 2/2"): back on every Short Rest. Older single-class Warlocks keep it in `slots`. */
  pactSlots?: string
  /** Magical Cunning used since the last Long Rest. */
  cunningUsed?: boolean
  /** Experience points (rooms that level by XP). */
  xp?: number
  /** SRD subclass and feats picked when levelling; a few have effects worked out for you (shared/progression.ts). */
  subclass?: string
  feats?: string[]
  /** Weapon attacks per Attack action, when the DM sets it (else Multiattack or Extra Attack decide). */
  attacksPerAction?: number
  /** Vision range, Darkvision and a carried light (the DM sets these; players can light or put out their own light). */
  vision?: ActorVision
}
/**
 * One condition from one source. Poisoned from two sources is two effects shown as one mark;
 * ending one leaves the other. `concentration` ties it to the source's Concentration.
 */
export type Effect = {
  id: string
  condition: string
  /** Exhaustion level. */
  level?: number
  sourceId?: string
  sourceLabel?: string
  concentration?: boolean
  /** Ends at the start or end of `actorId`'s turn, after `turns` such turns (1 = the next one). */
  ends?: { at: 'start' | 'end'; actorId: string; turns: number }
  /** Repeat save at the start or end of the affected creature's own turn; success ends it. */
  save?: { ability: Ability; dc: number; at: 'start' | 'end' }
  /** A save waiting to be rolled: a repeat save, or a Concentration check after damage. */
  pending?: { ability: Ability; dc: number; reason: 'repeat' | 'concentration' }
  /** Only the DM sees it. */
  hidden?: boolean
}
export type HitDie = 'd6' | 'd8' | 'd10' | 'd12'
/** What a Short Rest gives back: all uses, one use, or nothing (Long Rest only). */
export type ShortRestRecovery = 'all' | 'one' | 'none'
export type ClassResource = { name: string; max: number; used: number; short: ShortRestRecovery }
export type Actor = Sheet & { id: string; ownerId: string; temp?: true; templateId?: string; lootResult?: LootResult }
export type Template = { id: string; sheet: Sheet }
export type Library = { name: string; sheets: Template[]; objects: SavedObject[] }
export type MapAsset = { id: string; mime: string }
export const tokenRoleLabels = { character: 'Character Token', companion: 'Companion Token' } as const
export type TokenRole = keyof typeof tokenRoleLabels
export type Token = { id: string; actorId: string; x: number; y: number; role?: TokenRole; copyShared?: boolean }
export type ItemProficiency = { thievesTools: boolean; sleight: boolean; investigation: boolean; perception: boolean }
export type LootSkill = 'investigation' | 'perception'
export type LootResult = { passed: boolean; total: number; searcher: string; found: { name: string; quantity: number }[] }
export type InventoryItem = {
  id: string; name: string; description: string; image?: string
  quantity?: number; tool?: 'thievesTools'; lootTier?: 'basic' | 'bonus'
  /** Set when the item came from the SRD item catalog: the template id and a few facts shown with it. */
  ref?: string; category?: string; rarity?: string; attunement?: boolean; weight?: number
  /** A +1/+2/+3 weapon, armor, shield or ammunition: the magic bonus, and the plain catalog item it is made from. */
  bonus?: number; base?: string
}
export type ObjectKind = 'container' | 'prop' | 'structure' | 'item'
export const objectLabels: Record<ObjectKind, string> = {
  container: 'กล่อง', prop: 'ของประกอบฉาก', structure: 'สิ่งก่อสร้าง', item: 'ไอเทม'
}
export type SceneObject = {
  id: string; name: string; description: string; image?: string
  ownerId?: string; temp?: true; copyShared?: boolean
  /** The full inventory item an `item` object stands for, so picking it up keeps its catalog facts. */
  item?: InventoryItem
  /** A pile of dropped things on the floor: removed once it is empty. */
  pile?: true
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

export function objectOwner(object: SceneObject, members: Member[]) {
  return object.temp ? undefined : object.ownerId ?? members.find(member => member.role === 'dm')?.id
}

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
  /** Feet the creature whose turn it is has moved this turn (diagonals count 5 ft, 2024 rules). */
  moved?: { actorId: string; turnKey: string; feet: number }
  /** Action, Bonus Action and Reaction use per creature (shared/economy.ts); a creature's entry resets when its turn starts. */
  uses?: Record<string, TurnUse>
  /** Opportunity Attacks waiting for an answer this turn: the creature that may strike and the one that left its reach. */
  prompts?: { id: string; attackerId: string; targetId: string; at: number }[]
}
export function nextLivingTurn(combat: Combat, isDead: (actorId: string) => boolean) {
  for (let offset = 1; offset <= combat.order.length; offset++) {
    const step = combat.turn + offset
    const turn = step % combat.order.length
    if (!isDead(combat.order[turn].actorId)) return { turn, round: combat.round + Math.floor(step / combat.order.length) }
  }
}
/** XP waiting for the DM after a fight: the total from defeated monsters and who fought. */
export type XpAward = { total: number; actorIds: string[]; at: number }
/** One undo step: the units a command changed, with their old value and the fingerprint the command left (server/undo.ts). */
export type UndoStep = { at: number; label: string; units: { key: string; before: unknown; after: number }[]; rollIds?: string[] }
export type Scene = {
  /** XP from the last fight, until the DM shares it out or skips it. */
  xpAward?: XpAward
  id: string; name: string; cell: number; originX: number; originY: number
  map?: MapAsset; tokens: Token[]; combat?: Combat; objects?: SceneObject[]
  /** Who fought in this scene's last encounter, pre-selected for the next one. */
  lastParticipants?: string[]
  damageEvents?: DamageEvent[]; areaEffect?: { area: Area; kind: DamageKind; at: number }
  /** Walls, doors, light, darkness and what each player has explored (see shared/vision.ts). */
  vision?: SceneVision
  /** Sent to a player only: what their tokens see on this scene right now, as "x,y" cells. */
  view?: { visible: string[]; dimmed: string[]; darkvision: string[]; explored: string[] }
}
export type Roll = {
  id: string; name: string; label: string; formula: string; faces: number[]
  total: number; modifier: number; outcome?: string; targetId?: string; applied?: boolean
  cast?: { ability: Ability; dc: number; targetId: string; damage?: string; half: boolean; resolved?: boolean }
  critical?: boolean; privateTo?: string; sceneId?: string; sourceId?: string; damageKind?: DamageKind
  /** When the roll happened (ms). Older rolls have none. */
  at?: number
  /** The DM took this roll back (0.12 undo): it stays in the log, struck through. */
  undone?: boolean
}
/**
 * One line of the Adventure Log besides rolls: chat, scene changes, combat
 * milestones, HP changes and arrivals. Entries tied to a scene (`sceneId`)
 * are shown to players only while that scene is the one they can see.
 */
export type LogEntry = {
  id: string; at: number; kind: 'chat' | 'scene' | 'combat' | 'hp' | 'join'
  text: string; name?: string; sceneId?: string
}
export type Room = {
  id: string; name: string; invite: string; dmInvite?: string; revision: number; members: (Member & { profileId?: string })[]
  activeSceneId?: string; scenes: Scene[]; actors: Actor[]; templates: Template[]; rolls: Roll[]
  log?: LogEntry[]
  /** Each member's undo steps, newest last (server/undo.ts); never sent in snapshots. */
  undoSteps?: Record<string, UndoStep[]>
  /** Table rules the DM can switch. autoDamage: a hit applies its damage without waiting for the DM. */
  /**
   * Table rules the DM can switch. autoDamage: a hit applies its damage without waiting for the DM.
   * encumbrance (on unless false): carrying capacity limits Speed. advancement: level by milestone (default) or by XP.
   */
  settings?: { autoDamage?: boolean; encumbrance?: boolean; advancement?: 'milestone' | 'xp' }
}
export type Snapshot = Omit<Room, 'invite' | 'dmInvite' | 'actors' | 'members'> & {
  me: Member; members: Member[]; invite?: string; dmInvite?: string; actors: Actor[]
  publicActors: (Pick<Actor, 'id' | 'name' | 'kind' | 'size' | 'portrait' | 'hp' | 'maxHp' | 'tempHp' | 'lootResult' | 'conditions' | 'effects'> & { lootable?: boolean })[]
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
