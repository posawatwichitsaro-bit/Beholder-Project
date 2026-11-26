/**
 * Scripted playtest of the Phase 1 scenario (Context/PHASE_1_PLAN.md, "ทดลองเล่นก่อนปิดระยะ"):
 * one DM and two players in separate Edge sessions, driven through the real UI.
 * Not part of the test suite: it records what happened step by step and saves
 * screenshots so friction can be reviewed. Needs the app running on :3000 and
 * Docker for the restart step. Usage: pnpm playtest [outDir] (default .data/playtest)
 */
import { chromium } from 'playwright-core'
import type { Page } from 'playwright-core'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'

const base = 'http://127.0.0.1:3000'
const out = process.argv[2] ?? '.data/playtest'
mkdirSync(out, { recursive: true })
const exact = (name: string) => ({ name, exact: true })
const notes: string[] = []
const log = (line: string) => { notes.push(line); console.log(line) }
let shot = 0
const snap = async (page: Page, name: string) => { await page.waitForTimeout(400); await page.screenshot({ path: `${out}/pt-${String(++shot).padStart(2, '0')}-${name}.png` }) }
async function step(name: string, run: () => Promise<void>) {
  const started = Date.now()
  try { await run(); log(`✔ ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`) }
  catch (error) {
    log(`✖ ${name}: ${String(error).split('\n')[0]}`)
    for (const [who, page] of [['dm', dm], ['mira', mira], ['bram', bram]] as const) await page.screenshot({ path: `${out}/fail-${++shot}-${who}.png` }).catch(() => {})
  }
}

const browser = await chromium.launch({ channel: 'msedge' })
const seat = async () => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 820 } })
  page.setDefaultTimeout(8000)
  await page.addInitScript(() => localStorage.setItem('beholder.prefs', JSON.stringify({ tourSeen: { dm: true, player: true } })))
  return page
}
const dm = await seat()
const mira = await seat()
const bram = await seat()
let path = ''
const state = async (page: Page) => (await (await page.request.get(path)).json())
const toast = async (page: Page, who: string) => {
  const text = await page.locator('.toast').allTextContents()
  if (text.length) log(`  ! toast (${who}): ${text.join(' | ')}`)
}
async function openPanel(page: Page, name: string) {
  const menu = page.getByRole('button', exact('เมนูโต๊ะ'))
  if (await menu.getAttribute('aria-expanded') === 'false') await menu.click()
  const tab = page.getByRole('navigation', { name: 'ระบบในห้อง' }).getByRole('button', exact(name))
  if (await tab.getAttribute('aria-pressed') === 'false') await tab.click()
}

// ---------- 1. Setup: room, two scenes, players join and build characters ----------
await step('DM opens a table from the lobby', async () => {
  await dm.goto(base)
  await dm.getByLabel('ชื่อห้อง').fill('Playtest 0.05')
  await dm.getByLabel('ชื่อที่ใช้บนโต๊ะ').fill('DM')
  await dm.getByRole('button', exact('สร้างห้อง DM')).click()
  await dm.getByRole('button', exact('เมนูโต๊ะ')).waitFor()
  path = base + '/api/rooms/' + new URL(dm.url()).pathname.split('/').pop()
})
await step('DM creates scenes ทางเข้า and ห้องด้านใน', async () => {
  for (const name of ['ทางเข้า', 'ห้องด้านใน']) {
    await openPanel(dm, 'ฉากและแผนที่')
    await dm.locator('.scene-panel').getByRole('button', exact('สร้างฉาก')).click()
    await dm.getByLabel('ชื่อฉาก').fill(name)
    await dm.getByRole('button', exact('บันทึกฉาก')).click()
    await dm.getByRole('button', exact('บันทึกฉาก')).waitFor({ state: 'detached' })
  }
  const s = await state(dm)
  log(`  scenes: ${s.scenes.map((x: { name: string }) => x.name).join(', ')} · active: ${s.scenes.find((x: { id: string }) => x.id === s.activeSceneId)?.name}`)
})
let invite = ''
await step('DM copies the player invite', async () => {
  await openPanel(dm, 'ฉากและแผนที่')
  await dm.getByText('เชิญผู้เล่น', { exact: true }).click()
  invite = await dm.getByLabel('ลิงก์เชิญ').inputValue()
  await dm.keyboard.press('Escape')
})
for (const [page, name] of [[mira, 'Mira player'], [bram, 'Bram player']] as const) {
  await step(`${name} joins by invite`, async () => {
    await page.goto(invite)
    await page.getByLabel('ชื่อที่ใช้บนโต๊ะ').fill(name)
    await page.getByRole('button', exact('เข้าร่วม')).click()
    await page.getByRole('button', exact('เมนูโต๊ะ')).waitFor()
  })
}
await snap(mira, 'player-joined')

async function buildCharacter(page: Page, name: string, species: string, background: string, className: string) {
  await openPanel(page, 'ชีตในห้อง')
  await page.getByRole('button', exact('+ ตัวละคร')).click()
  const wizard = page.getByRole('dialog', { name: 'สร้างตัวละคร' })
  await wizard.getByLabel('ชื่อตัวละคร').fill(name)
  await wizard.getByRole('button', exact('ถัดไป')).click()
  await wizard.getByRole('radio', { name: new RegExp('^' + species) }).click()
  await wizard.getByRole('radio', { name: new RegExp('^' + background) }).click()
  await wizard.getByRole('button', exact('ถัดไป')).click()
  await wizard.getByRole('radio', { name: new RegExp('^' + className) }).click()
  await wizard.getByLabel('เลเวล').fill('3')
  for (let i = 0; i < 3; i++) await wizard.getByRole('button', exact('ถัดไป')).click()
  await snap(page, 'wizard-review-' + name)
  await wizard.getByRole('button', exact('สร้างตัวละคร')).click()
  await wizard.waitFor({ state: 'hidden' })
}
await step('Mira builds a Human Acolyte Cleric 3 with the wizard', () => buildCharacter(mira, 'Mira', 'Human', 'Acolyte', 'Cleric'))
await step('Bram builds a Dwarf Soldier Fighter 3 with the wizard', () => buildCharacter(bram, 'Bram', 'Dwarf', 'Soldier', 'Fighter'))

async function placeOwn(page: Page, name: string, x: number, y: number) {
  await page.keyboard.press('Escape')
  await openPanel(page, 'ชีตในห้อง')
  await page.getByRole('button', exact('วาง ' + name)).click()
  await page.locator('canvas').click({ position: { x, y } })
  await page.waitForTimeout(500)
}
await step('Players place their own tokens at the entrance', async () => {
  await placeOwn(mira, 'Mira', 300, 300)
  await placeOwn(bram, 'Bram', 348, 300)
  const s = await state(dm)
  log(`  entrance tokens: ${s.scenes[0].tokens.length}`)
})
await snap(bram, 'entrance-player-view')

await step('DM prepares two Goblin Warriors in the inner room (players must not see it)', async () => {
  await openPanel(dm, 'ฉากและแผนที่')
  await dm.locator('.scene-item').filter({ hasText: 'ห้องด้านใน' }).click()
  await openPanel(dm, 'Monster Manual')
  for (const x of [500, 548]) {
    await dm.getByLabel('ค้นหาชื่อหรือประเภท').fill('Goblin Warrior')
    await dm.locator('.manual-list button').first().click()
    await dm.getByRole('button', exact('วางมอนสเตอร์ในฉาก')).click()
    await dm.locator('canvas').click({ position: { x, y: 300 } })
    await dm.waitForTimeout(500)
    await openPanel(dm, 'Monster Manual')
    const back = dm.getByRole('button', exact('← กลับไปยังรายการ'))
    if (await back.count()) await back.click()
  }
  const p = await state(mira)
  log(`  player sees scenes: ${p.scenes.map((x: { name: string }) => x.name).join(', ')}`)
})
await snap(dm, 'dm-inner-prep')

// ---------- 2. Perception at the entrance ----------
await step('Mira looks for tracks: Perception check from her sheet', async () => {
  await openPanel(mira, 'ชีตในห้อง')
  await mira.getByRole('button', exact('Mira')).click()
  const sheet = mira.getByRole('article', { name: 'ชีต Mira' })
  const perception = sheet.getByRole('button', exact('Perception check'))
  if (await perception.count()) await perception.click()
  else { log('  ! no Perception button on the sheet (untrained skills are not listed) — rolled WIS check instead'); await sheet.getByRole('button', exact('WIS check')).click() }
  await mira.waitForTimeout(600)
  const last = (await state(dm)).rolls.at(-1)
  log(`  DM sees: ${last?.label} = ${last?.total}`)
})
await snap(dm, 'dm-sees-perception')

// ---------- 3. Move to the inner room, fight a round ----------
await step('DM moves the party: publish the inner room', async () => {
  await dm.keyboard.press('Escape')
  await dm.getByRole('button', exact('เปิดให้ผู้เล่น')).click()
  await mira.waitForTimeout(800)
  const p = await state(mira)
  log(`  player now sees: ${p.scenes.map((x: { name: string }) => x.name).join(', ')} · their tokens there: ${p.scenes[0].tokens.filter((t: { actorId: string }) => p.actors.some((a: { id: string }) => a.id === t.actorId)).length}`)
})
await snap(mira, 'inner-player-view')
await step('DM brings the party into the inner room with one click', async () => {
  await dm.getByRole('button', { name: /^พาผู้เล่นมา/ }).click()
  await dm.waitForTimeout(600)
  log(`  inner tokens: ${(await state(dm)).scenes.find((x: { name: string }) => x.name === 'ห้องด้านใน').tokens.length}`)
})
await step('DM starts combat from the combat panel', async () => {
  await dm.getByRole('button', exact('เตรียมการต่อสู้')).click()
  const combat = dm.getByRole('complementary', { name: 'แผงต่อสู้ DM' })
  await combat.getByRole('button', exact('ทอย Initiative')).click()
  await mira.getByRole('complementary', { name: 'Turn Initiative' }).waitFor()
  const s = await state(dm)
  const fight = s.scenes.find((x: { combat?: unknown }) => x.combat).combat
  log(`  order: ${fight.order.map((e: { actorId: string; initiative: number }) => s.actors.find((a: { id: string; name: string }) => a.id === e.actorId)?.name + ' ' + e.initiative).join(' → ')}`)
})
await snap(dm, 'dm-combat-started')

const whoseTurn = async () => {
  const s = await state(dm)
  const fight = s.scenes.find((x: { combat?: unknown }) => x.combat)?.combat
  return s.actors.find((a: { id: string }) => a.id === fight?.order[fight.turn].actorId)?.name as string
}
const goblinPixel = { x: 500, y: 300 }
async function playerTurn(page: Page, name: string) {
  // Step toward the goblins with the arrow keys, then attack from the goblin's token bar.
  await page.locator('canvas').click({ position: { x: 700, y: 600 } })
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(400)
  await page.locator('canvas').click({ position: goblinPixel })
  const bar = page.getByRole('toolbar', { name: /^คำสั่งของ Goblin/ })
  await bar.waitFor()
  await snap(page, 'turn-' + name + '-bar')
  await bar.getByRole('button', { name: new RegExp('^โจมตีด้วย ' + name) }).click()
  await page.waitForTimeout(700)
  const last = (await state(page)).rolls.filter((r: { label: string }) => r.label.includes(name)).at(-1)
  log(`  ${name} attack: ${last?.label} → ${last?.total} ${last?.outcome ?? ''}`)
  await toast(page, name)
}
async function clericSpell(page: Page) {
  await page.keyboard.press('Escape')
  await openPanel(page, 'ชีตในห้อง')
  await page.getByRole('button', exact('Mira')).click()
  const sheet = page.getByRole('article', { name: 'ชีต Mira' })
  await sheet.getByRole('tab', exact('Spells')).click()
  await sheet.getByLabel('ชื่อเวท').fill('Command')
  await sheet.getByLabel('ใช้ช่องเวท').selectOption('1')
  await sheet.getByRole('button', { name: /^ขอ DEX Save/ }).click()
  await page.waitForTimeout(500)
  await snap(page, 'mira-spell')
  await toast(page, 'Mira')
}
await step('One full round', async () => {
  for (let turn = 0; turn < 4; turn++) {
    const name = await whoseTurn()
    log(` turn: ${name}`)
    if (name === 'Bram') await step('Bram moves and attacks', () => playerTurn(bram, 'Bram'))
    else if (name === 'Mira') {
      await step('Mira casts a save spell and marks a slot', () => clericSpell(mira))
      await step('Mira refreshes mid-turn and ends her turn', async () => {
        await mira.reload()
        await mira.getByRole('button', exact('เมนูโต๊ะ')).waitFor()
        await mira.getByRole('button', { name: /จบเทิร์น/ }).first().click()
      })
    } else {
      await step(`DM resolves pending results and plays ${name}`, async () => {
        const queue = dm.getByRole('region', { name: 'ผลรอจัดการ' })
        while (await queue.count() && await queue.getByRole('button').first().count()) {
          const apply = queue.getByRole('button', exact('หัก HP'))
          const save = queue.getByRole('button', { name: /^ทอย Save ให้/ })
          if (await save.count()) await save.first().click()
          else if (await apply.count()) await apply.first().click()
          else break
          await dm.waitForTimeout(500)
        }
        const combat = dm.getByRole('complementary', { name: 'แผงต่อสู้ DM' })
        const picker = combat.getByRole('combobox').first()
        if (!(await picker.inputValue())) { log('  ! DM must pick a target by hand (none chosen by default)'); await picker.selectOption({ index: 1 }) }
        const attack = combat.getByRole('button', { name: /^โจมตี · / })
        if (await attack.isEnabled()) { await attack.click(); await dm.waitForTimeout(500) }
        while (await queue.count() && await queue.getByRole('button', exact('หัก HP')).count()) { await queue.getByRole('button', exact('หัก HP')).first().click(); await dm.waitForTimeout(400) }
        await snap(dm, 'dm-turn-' + name)
      })
    }
    if (name !== 'Mira') {
      const end = name === 'Bram' ? bram.getByRole('button', { name: /จบเทิร์น/ }).first() : dm.getByRole('complementary', { name: 'แผงต่อสู้ DM' }).getByRole('button', exact('เทิร์นถัดไป'))
      await end.click()
    }
    await dm.waitForTimeout(600)
  }
  const s = await state(dm)
  log(`  after the round: ${s.actors.map((a: { name: string; hp: number; maxHp: number; slots: string }) => `${a.name} ${a.hp}/${a.maxHp}${a.slots ? ' [' + a.slots + ']' : ''}`).join(' · ')}`)
})

// ---------- 5. End, back to the entrance, restart the server ----------
await step('DM ends the encounter and returns to the entrance', async () => {
  const combat = dm.getByRole('complementary', { name: 'แผงต่อสู้ DM' })
  if (!(await combat.count())) await dm.getByRole('button', { name: /^รอบ / }).click()
  await combat.getByRole('button', { name: /จบการต่อสู้/ }).click()
  const confirm = dm.getByRole('button', { name: /ยืนยันจบการต่อสู้/ })
  if (await confirm.count()) await confirm.click()
  await openPanel(dm, 'ฉากและแผนที่')
  await dm.getByRole('button', { name: 'เปิดฉาก ทางเข้า ให้ผู้เล่น' }).click()
  await mira.waitForTimeout(800)
  log(`  player now sees: ${(await state(mira)).scenes.map((x: { name: string }) => x.name).join(', ')}`)
})
const before = JSON.stringify((await state(dm)).actors.map((a: { name: string; hp: number; slots: string; conditions: string }) => [a.name, a.hp, a.slots, a.conditions]))
writeFileSync(out + '/pt-before-restart.json', before)
await step('Server restart (docker compose restart app): everyone resumes at the latest state', async () => {
  const { execSync } = await import('node:child_process')
  execSync('docker compose restart app', { stdio: 'ignore' })
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + '/api/health')).ok) break } catch { /* still starting */ }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  for (const page of [dm, mira, bram]) { await page.reload(); await page.getByRole('button', exact('เมนูโต๊ะ')).waitFor() }
  const after = JSON.stringify((await state(dm)).actors.map((a: { name: string; hp: number; slots: string; conditions: string }) => [a.name, a.hp, a.slots, a.conditions]))
  log(after === before ? '  state identical after restart' : '  ! state changed: ' + before + ' → ' + after)
  await openPanel(mira, 'ชีตในห้อง')
  await mira.getByRole('button', exact('Mira')).click()
  await mira.getByRole('article', { name: 'ชีต Mira' }).waitFor()
  log('  player sees: ' + (await state(mira)).scenes.map((x: { name: string }) => x.name).join(', '))
})
await snap(mira, 'after-restart')
writeFileSync(out + '/pt-notes.txt', notes.join('\n'))
await browser.close()
console.log('PATH ' + path)
