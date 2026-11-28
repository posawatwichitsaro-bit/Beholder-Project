import { parentPort } from 'node:worker_threads'
import { render } from './mapMaskRender.ts'
import type { Grid } from './mapMaskRender.ts'

/** Worker thread for server/mapMask.ts (0.17): renders masked maps off the main thread. */
parentPort!.on('message', async (message: { job: number; path: string; grid: Grid; known: string[] }) => {
  try {
    const bytes = await render(message.path, message.grid, new Set(message.known))
    const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    parentPort!.postMessage({ job: message.job, bytes: view })
  } catch (error) {
    parentPort!.postMessage({ job: message.job, error: (error as Error).message })
  }
})
