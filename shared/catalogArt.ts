import { inventoryArt, monsterArt, objectArt } from './catalogArtData.ts'

const root = '/art/srd/'
const inventoryPath = root + 'inventory/'
const monsterPath = root + 'monsters/'
const objectPath = root + 'objects/'
const monsterImages = new Set(Object.values(monsterArt).map(file => monsterPath + file))
const inventoryImages = new Set(Object.values(inventoryArt).map(file => inventoryPath + file))

export const sceneArt = objectArt.map(({ name, file, ref }) => ({ name, image: objectPath + file, ref }))
const objectImages = new Map(sceneArt.map(entry => [entry.image, entry]))

export function itemIcon(id?: string) {
  return id && Object.hasOwn(inventoryArt, id) ? inventoryPath + inventoryArt[id] : undefined
}

export function monsterPortrait(id?: string) {
  return id && Object.hasOwn(monsterArt, id) ? monsterPath + monsterArt[id] : undefined
}

export const isMonsterArt = (image: string) => monsterImages.has(image)
export const sceneArtByImage = (image: string) => objectImages.get(image)
export const isCatalogArt = (image: string) => monsterImages.has(image) || inventoryImages.has(image) || objectImages.has(image)
