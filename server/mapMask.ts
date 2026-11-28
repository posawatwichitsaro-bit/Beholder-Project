import { Worker } from 'node:worker_threads'
import { resolve } from 'node:path'
import type { Grid } from './mapMaskRender.ts'
import type { MapAsset } from '../shared/model.ts'

/**
 * The map as one player may see it (0.14): every grid square they have never
 * seen is painted black on the server, so opening devtools shows nothing more
 * than the fog does. Same pixel size as the original, so the board lines up.
 *
 *   original ──► RGB ──► pixels outside the mask (known squares, row by row) set to the fog colour ──► WebP
 *
 * Renders are cached by map, player and the exact set of known squares, and
 * identical requests in flight share one render. Since 0.17 the pixel work
 * runs in one worker thread, so a big map no longer stalls other rooms' commands.
 */
export type { Grid } from './mapMaskRender.ts'
export { maskPixels } from './mapMaskRender.ts'

const cacheSize = 32
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

/** One long-lived worker; jobs are matched to replies by number. If it dies, waiting jobs fail and the next one starts a new worker. */
let worker: Worker | undefined
let next = 0
/** An idle worker is stopped after a few seconds (sharp inside it would otherwise keep the process alive). */
let idle: ReturnType<typeof setTimeout> | undefined
const idleMs = 5000
const waiting = new Map<number, { done: (bytes: Buffer) => void; fail: (error: Error) => void }>()
function renderInWorker(path: string, grid: Grid, known: Set<string>) {
  if (!worker) {
    const started = new Worker(new URL('./mapMaskWorker.ts', import.meta.url))
    started.unref()
    started.on('message', (reply: { job: number; bytes?: Uint8Array; error?: string }) => {
      const entry = waiting.get(reply.job)
      waiting.delete(reply.job)
      if (reply.bytes) entry?.done(Buffer.from(reply.bytes.buffer, reply.bytes.byteOffset, reply.bytes.byteLength))
      else entry?.fail(new Error(reply.error ?? 'ตัดภาพแผนที่ไม่สำเร็จ'))
      if (!waiting.size) {
        idle = setTimeout(() => { if (worker === started && !waiting.size) { worker = undefined; void started.terminate() } }, idleMs)
        idle.unref()
      }
    })
    const lost = (error: Error) => {
      if (worker === started) worker = undefined
      for (const entry of waiting.values()) entry.fail(error)
      waiting.clear()
    }
    started.on('error', lost)
    started.on('exit', () => lost(new Error('ตัวตัดภาพแผนที่หยุดทำงาน')))
    worker = started
  }
  clearTimeout(idle)
  const job = ++next
  const running = worker
  return new Promise<Buffer>((done, fail) => {
    waiting.set(job, { done, fail })
    running.postMessage({ job, path, grid, known: [...known] })
  })
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
  job = renderInWorker(resolve(assets, map.id), grid, known)
  job.catch(() => cache.delete(key))
  cache.set(key, job)
  while (cache.size > cacheSize) cache.delete(cache.keys().next().value!)
  return job
}
