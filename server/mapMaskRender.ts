import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

/** Map pixels for the fog (0.14), split out in 0.17 so they run in a worker thread (server/mapMaskWorker.ts). */
export type Grid = { cell: number; originX: number; originY: number }
/** The board's fog colour (#0b0806). */
const fog = { r: 11, g: 8, b: 6 }

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

export async function render(path: string, grid: Grid, known: Set<string>) {
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

