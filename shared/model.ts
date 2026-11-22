export const abilities = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const
export const sizes = { Tiny: 0.5, Small: 1, Medium: 1, Large: 2, Huge: 3, Gargantuan: 4 }
export type Ability = typeof abilities[number]
export type Size = keyof typeof sizes
export type Member = { id: string; name: string; role: 'dm' | 'player' }
export type Sheet = {
  name: string; kind: 'pc' | 'monster'; size: Size; speed: number
  classLevel: string; abilities: Record<Ability, number>; proficiency: number
  skills: string; saves: string; hp: number; maxHp: number; tempHp: number; ac: number
  initiative: number; attack: number; damage: string; spellAttack: number; spellDC: number
  attacks?: { name: string; bonus: number; damage: string }[]
  spells: string; slots: string; conditions: string
  successes: number; failures: number; life: 'active' | 'dying' | 'stable' | 'dead'
}
export type Actor = Sheet & { id: string; ownerId: string; templateId?: string }
export type Template = { id: string; sheet: Sheet }
export type MapAsset = { id: string; mime: string }
export type Token = { id: string; actorId: string; x: number; y: number }
export type Combat = {
  order: { actorId: string; initiative: number }[]; turn: number; round: number
  deathSaveAt?: string
}
export type Scene = {
  id: string; name: string; cell: number; originX: number; originY: number
  map?: MapAsset; tokens: Token[]; combat?: Combat
}
export type Roll = {
  id: string; name: string; label: string; formula: string; faces: number[]
  total: number; modifier: number; outcome?: string; targetId?: string; applied?: boolean
  cast?: { ability: Ability; dc: number; targetId: string; damage?: string; half: boolean; resolved?: boolean }
  critical?: boolean
}
export type Room = {
  id: string; name: string; invite: string; revision: number; members: Member[]
  activeSceneId?: string; scenes: Scene[]; actors: Actor[]; templates: Template[]; rolls: Roll[]
}
export type Snapshot = Omit<Room, 'invite' | 'actors'> & {
  me: Member; invite?: string; actors: Actor[]
  publicActors: Pick<Actor, 'id' | 'name' | 'kind' | 'size'>[]
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
