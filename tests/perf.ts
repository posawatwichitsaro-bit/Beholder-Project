/**
 * Board smoothness check (0.08): a 4096 px map, 50 tokens and 50 objects,
 * then a scripted pan and wheel zoom while counting animation frames.
 * Prints fps and frame-time numbers; with BEHOLDER_PERF_ASSERT=1 it fails
 * below the release bar (60 fps desktop). Runs a visible browser window by
 * default because headless browsers draw WebGL in software, which says
 * nothing about real machines; BEHOLDER_PERF_HEADLESS=1 runs it headless.
 *
 *   pnpm perf            (needs the app on :3000)
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'
import type { Page } from 'playwright-core'
import { blankSheet } from '../shared/model.ts'
import type { Snapshot } from '../shared/model.ts'

const base = process.env.BEHOLDER_TEST_URL ?? 'http://127.0.0.1:3000'
const browser = await chromium.launch({
  ...(process.env.BEHOLDER_BROWSER ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' }),
  headless: process.env.BEHOLDER_PERF_HEADLESS === '1'
})
// BEHOLDER_PERF_DPR=2 with a tablet-sized window stands in for an iPad screen.
const ratio = Number(process.env.BEHOLDER_PERF_DPR ?? 1)
const viewport = ratio > 1 ? { width: 1366, height: 1024 } : { width: 1280, height: 800 }
const page = await browser.newPage({ viewport, deviceScaleFactor: ratio })
await page.addInitScript(() => localStorage.setItem('beholder.prefs', JSON.stringify({ tourSeen: { dm: true, player: true } })))

const room: Snapshot = await (await page.request.post(base + '/api/rooms', { data: { name: 'Perf board', member: 'DM' } })).json()
const path = base + '/api/rooms/' + room.id
let revision = room.revision
async function command(body: Record<string, unknown>) {
  revision = ((await (await page.request.get(path)).json()) as Snapshot).revision
  const response = await page.request.post(path + '/commands', { data: { ...body, commandId: randomUUID(), revision } })
  assert.equal(response.status(), 200, await response.text())
  revision = ((await (await page.request.get(path)).json()) as Snapshot).revision
}
await command({ type: 'scene', name: 'Big map', cell: 48, originX: 0, originY: 0 })
const sceneId = ((await (await page.request.get(path)).json()) as Snapshot).scenes[0].id

// A 4096 × 4096 JPEG with enough detail that the browser cannot shortcut drawing it.
await page.goto(base + '/')
const jpeg = await page.evaluate(async () => {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 4096
  const ctx = canvas.getContext('2d')!
  for (let y = 0; y < 4096; y += 64) for (let x = 0; x < 4096; x += 64) {
    ctx.fillStyle = `hsl(${(x * 7 + y * 3) % 360} 30% ${25 + ((x ^ y) % 20)}%)`
    ctx.fillRect(x, y, 64, 64)
  }
  const blob: Blob = await new Promise(resolve => canvas.toBlob(value => resolve(value!), 'image/jpeg', .8))
  return Array.from(new Uint8Array(await blob.arrayBuffer()))
})
const upload = await page.request.put(path + '/scenes/' + sceneId + '/map', { data: Buffer.from(jpeg), headers: { 'Content-Type': 'image/jpeg' } })
assert.equal(upload.status(), 204)

// 50 monsters in rows 0–4, 50 objects in rows 6–10, columns 0–9: the right side stays empty for panning.
for (let index = 0; index < 50; index++) {
  await command({ type: 'place', sceneId, kind: 'monster', sheet: { ...blankSheet('monster'), name: 'Goblin', hp: 7, maxHp: 7, conditions: index % 5 ? '' : 'Prone' },
    x: index % 10, y: Math.floor(index / 10) })
}
for (let index = 0; index < 50; index++) {
  await command({ type: 'importObject', sceneId, kind: index % 2 ? 'container' : 'prop', name: 'Crate ' + index, items: [],
    x: index % 10, y: 6 + Math.floor(index / 10) })
}

await page.goto(base + '/room/' + room.id)
const canvas = page.locator('canvas')
await canvas.waitFor()
await page.waitForTimeout(1500)
const box = (await canvas.boundingBox())!

async function measure(name: string, act: () => Promise<void>) {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __run: number }
    // A new run number stops any earlier counting loop that is still scheduled.
    const run = (w.__run ?? 0) + 1
    w.__run = run
    w.__frames = []
    const tick = (time: number) => { if (w.__run !== run) return; w.__frames.push(time); requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
  await act()
  const frames: number[] = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __run: number }
    w.__run += 1
    return w.__frames
  })
  const gaps = frames.slice(1).map((time, index) => time - frames[index]).sort((a, b) => a - b)
  const seconds = (frames.at(-1)! - frames[0]) / 1000
  const result = {
    name, fps: Math.round(frames.length / seconds), p95ms: Math.round(gaps[Math.floor(gaps.length * .95)] * 10) / 10,
    worstMs: Math.round(gaps.at(-1)! * 10) / 10, frames: frames.length
  }
  console.log(JSON.stringify(result))
  return result
}

async function pan(page: Page) {
  const from = { x: box.x + 900, y: box.y + 420 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let step = 0; step < 150; step++) {
    const angle = step / 150 * Math.PI * 4
    await page.mouse.move(from.x + Math.cos(angle) * 260 - 260, from.y + Math.sin(angle) * 180)
    await page.waitForTimeout(12)
  }
  await page.mouse.up()
}
async function zoom(page: Page) {
  await page.mouse.move(box.x + 800, box.y + 400)
  for (let step = 0; step < 60; step++) {
    await page.mouse.wheel(0, step < 30 ? -100 : 100)
    await page.waitForTimeout(25)
  }
}

// CPU slowdown stands in for a tablet (×4) and a phone (×6); the screen's own refresh rate is the idle figure.
const cdp = await page.context().newCDPSession(page)
const results = []
for (const rate of [1, 4, 6]) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate })
  const tag = rate === 1 ? '' : ' ×' + rate + ' CPU'
  results.push(await measure('idle' + tag, () => page.waitForTimeout(1500)))
  results.push(await measure('pan' + tag, () => pan(page)))
  results.push(await measure('wheel zoom' + tag, () => zoom(page)))
}
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
mkdirSync('.data/perf', { recursive: true })
const file = '.data/perf/board-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'
writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), ratio, headless: process.env.BEHOLDER_PERF_HEADLESS === '1', results }, null, 2))
console.log('saved ' + file)
await browser.close()
if (process.env.BEHOLDER_PERF_ASSERT === '1') {
  for (const result of results) {
    const bar = result.name.includes('×6') ? 30 : 58
    assert.ok(Math.min(result.fps, 60) >= bar, result.name + ': ' + result.fps + ' fps is under the ' + bar + ' fps bar')
  }
}
