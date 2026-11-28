import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import type { MapAsset } from '../shared/model.ts'

/**
 * The map as one player may see it (0.14): every grid square they have never
 * seen is painted black on the server, so opening devtools shows nothing more
 * than the fog does. Same pixel size as the original, so the board lines up.
 *
 *   original ──► RGB ──► pixels outside the mask (known squares, row by row) set to the fog colour ──► WebP
 *
 * Renders are cached by map, player and the exact set of known squares, and
 * identical requests in flight share one render.
 */
export type Grid = { cell: number; originX: number; originY: number }

const cacheSize = 32
/** The board's fog colour (#0b0806). */
const fog = { r: 11, g: 8, b: 6 }
const cache = new Map<string, Promise<Buffer>>()

/** A short, order-free fingerprint of the known squares (FNV-1a over the sorted keys). */
function fingerprint(known: Set<string>) {
  let hash = 0x811c9dc5
  for (const item of [...known].sort()) for (let index = 0; index < item.length; index++) {
    hash ^= item.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36) + '.' + known.size
}

/** One byte per pixel: 255 inside a known square, 0 elsewhere. Each square row is built once and copied. */
export function maskPixels(width: number, height: number, grid: Grid, known: Set<string>) {
  const mask = Buffer.alloc(width * height)
  const column = new Int32Array(width)
  for (let x = 0; x < width; x++) column[x] = Math.floor((x + .5 - grid.originX) / grid.cell)
  let row = -Infinity
  let template = Buffer.alloc(width)
  for (let y = 0; y < height; y++) {
    const cellY = Math.floor((y + .5 - grid.originY) / grid.cell)
    if (cellY !== row) {
      row = cellY
      template = Buffer.alloc(width)
      for (let x = 0; x < width; x++) if (known.has(column[x] + ',' + cellY)) template[x] = 255
    }
    template.copy(mask, y * width)
  }
  return mask
}

async function render(path: string, grid: Grid, known: Set<string>) {
  const source = await readFile(path)
  const { width, height } = await sharp(source).metadata()
  if (!width || !height) throw new Error('อ่านขนาดภาพแผนที่ไม่ได้')
  const mask = maskPixels(width, height, grid, known)
  // Decode to RGB (a transparent map sits on the fog colour), paint unknown pixels, encode once.
  const rgb = await sharp(source).flatten({ background: fog }).removeAlpha().raw().toBuffer()
  for (let index = 0; index < mask.length; index++) {
    if (mask[index]) continue
    const at = index * 3
    rgb[at] = fog.r; rgb[at + 1] = fog.g; rgb[at + 2] = fog.b
  }
  return sharp(rgb, { raw: { width, height, channels: 3 } }).webp({ quality: 82 }).toBuffer()
}

/** The masked map for one player, as WebP bytes. */
export function maskedMap(assets: string, map: MapAsset, memberId: string, grid: Grid, known: Set<string>) {
  const key = [map.id, memberId, grid.cell, grid.originX, grid.originY, fingerprint(known)].join(':')
  let job = cache.get(key)
  if (job) {
    cache.delete(key)
    cache.set(key, job)
    return job
  }
  job = render(resolve(assets, map.id), grid, known)
  job.catch(() => cache.delete(key))
  cache.set(key, job)
  while (cache.size > cacheSize) cache.delete(cache.keys().next().value!)
  return job
}
