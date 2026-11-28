import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright-core'
import type { Browser, Page } from 'playwright-core'
import { blankSheet } from '../shared/model.ts'
/** The board's canvas (the 3D dice add their own canvas while a roll shows). */
const boardCanvas = 'canvas.board-canvas'
import type { Snapshot } from '../shared/model.ts'

const base = process.env.BEHOLDER_TEST_URL ?? 'http://127.0.0.1:3000'
const exact = (name: string) => ({ name, exact: true })
/** Room id from a table URL: `/room/:id` (current) or `/?room=id` (links issued before the router). */
const roomIdOf = (url: string) => /\/room\/([^/?#]+)/.exec(new URL(url).pathname)?.[1] ?? new URL(url).searchParams.get('room')

/**
 * Poll an async check in the page until it is truthy. Playwright's waitForFunction
 * does not await an async predicate (the Promise itself counts as true), so waits
 * on room state fetched in the page go through here instead.
 */
async function waitInPage<A>(page: Page, check: (arg: A) => Promise<unknown>, arg: A, timeout = 10000) {
  const end = Date.now() + timeout
  for (;;) {
    if (await page.evaluate(check as never, arg as never)) return
    if (Date.now() > end) throw new Error('timed out waiting for: ' + check.toString().replace(/\s+/g, ' ').slice(0, 200))
    await page.waitForTimeout(100)
  }
}

/**
 * A browser seat that has already seen the first-run tour, so the tour card
 * never sits over what a test clicks. The tour itself has its own test.
 */
async function seat(browser: Browser, options?: Parameters<Browser['newPage']>[0]) {
  const page = await browser.newPage(options)
  await page.addInitScript(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('beholder.prefs') ?? '{}') ?? {}
      localStorage.setItem('beholder.prefs', JSON.stringify({ ...stored, tourSeen: { dm: true, player: true } }))
    } catch { /* storage blocked: the tour shows, and Esc closes it */ }
  })
  return page
}

test('Ctrl+C copies a mixed selection and Ctrl+V places it in another room tab', { timeout: 60000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER
    ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 1100, height: 750 } })
  await context.addInitScript(() => localStorage.setItem('beholder.prefs', JSON.stringify({ tourSeen: { dm: true, player: true } })))
  const source = await context.newPage()
  const destination = await context.newPage()
  async function setup(name: string) {
    const created = await source.request.post(base + '/api/rooms', { data: { name, member: 'DM' } })
    assert.equal(created.status(), 201)
    const initial: Snapshot = await created.json()
    const path = base + '/api/rooms/' + initial.id
    const read = async (): Promise<Snapshot> => (await source.request.get(path)).json()
    const command = async (data: object) => {
      const response = await source.request.post(path + '/commands', {
        data: { ...data, revision: (await read()).revision, commandId: randomUUID() }
      })
      assert.equal(response.status(), 200, await response.text())
    }
    await command({ type: 'scene', name, cell: 48, originX: 0, originY: 0 })
    return { id: initial.id, sceneId: (await read()).scenes[0].id, command, read }
  }
  const from = await setup('Clipboard source')
  const to = await setup('Clipboard destination')
  await from.command({ type: 'place', sceneId: from.sceneId, x: 1, y: 1, sheet: { ...blankSheet(), name: 'Skip me' } })
  await from.command({ type: 'place', sceneId: from.sceneId, x: 2, y: 1, kind: 'monster', sheet: { ...blankSheet('monster'), name: 'Goblin' } })
  await from.command({ type: 'importObject', sceneId: from.sceneId, x: 3, y: 2, kind: 'container', name: 'Chest', items: ['Gem'] })
  await source.goto(base + '/room/' + from.id)
  await source.locator(boardCanvas).waitFor()
  const board = (await source.locator(boardCanvas).boundingBox())!
  await source.mouse.move(board.x + 74, board.y + 74)
  await source.keyboard.down('Shift')
  await source.mouse.down()
  await source.mouse.move(board.x + 217, board.y + 162, { steps: 5 })
  await source.mouse.up()
  await source.keyboard.up('Shift')
  await source.getByText('เลือก 3 ชิ้น', { exact: true }).waitFor()
  const copied = source.waitForResponse(response => response.url().endsWith('/clipboard'))
  await source.keyboard.press('Control+c')
  assert.deepEqual(await (await copied).json(), { copied: 2, skipped: 1 })
  await destination.goto(base + '/room/' + to.id)
  const next = destination.locator(boardCanvas)
  await next.waitFor()
  await next.hover({ position: { x: 245, y: 195 } })
  const pasted = destination.waitForResponse(response => response.url().endsWith('/commands') && response.request().postDataJSON()?.type === 'pasteBoard')
  await destination.keyboard.press('Control+v')
  const result = await pasted
  assert.equal(result.status(), 200, await result.text())
  await destination.getByRole('status').filter({ hasText: 'วางสำเนา Temp แล้ว' }).waitFor()
  const state = await to.read()
  const [monster] = state.scenes[0].tokens
  const [chest] = state.scenes[0].objects!
  assert.equal(state.scenes[0].tokens.length, 1)
  assert.deepEqual([monster.x, monster.y, chest.x - monster.x, chest.y - monster.y], [4, 3, 1, 1])
  assert.equal(state.actors[0].temp, true)
  assert.equal(chest.temp, true)
  assert.equal((await from.read()).scenes[0].tokens.length, 2)
})

test('sign up with a character name, rename in the room and return with a fresh session', { timeout: 60000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER
    ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const dm = await seat(browser)
  const guest = await seat(browser)
  const returning = await seat(browser)
  const email = 'test-' + randomUUID() + '@example.com'
  const password = 'test-account-pass'

  await dm.goto(base)
  await dm.getByRole('button', exact('สร้างบัญชี')).click()
  await dm.getByLabel('อีเมล').fill(email.toUpperCase())
  await dm.getByLabel('รหัสผ่าน', { exact: true }).fill(password)
  await dm.getByLabel('ชื่อตัวละครที่ใช้บนโต๊ะ').fill('Mira')
  await dm.getByRole('button', exact('สมัครบัญชี')).click()
  await dm.getByText('ชื่อที่ใช้บนโต๊ะ · Mira', { exact: true }).waitFor()
  await dm.getByLabel('ชื่อห้อง').fill('Account verification')
  await dm.getByRole('button', exact('สร้างห้อง DM')).click()
  await openPanel(dm, 'ฉากและแผนที่')

  const bookmark = dm.url()
  const roomPath = base + '/api/rooms/' + roomIdOf(bookmark)
  const original = await (await dm.request.get(roomPath)).json()
  assert.equal(original.me.name, 'Mira')
  assert.equal(original.me.role, 'dm')
  assert.deepEqual(Object.keys(original.me).sort(), ['id', 'name', 'role'])

  await guest.goto(`${base}/?invite=${original.invite}&room=${original.id}`)
  await guest.getByLabel('ชื่อที่ใช้บนโต๊ะ').fill('Guest')
  await guest.getByRole('button', exact('เข้าร่วม')).click()
  await openPanel(guest, 'ฉากและแผนที่')
  await guest.getByText('2 คน · Mira, Guest', { exact: true }).waitFor()

  await openPanel(dm, 'ตั้งค่าบัญชี')
  await dm.getByLabel('ชื่อตัวละครที่ใช้บนโต๊ะ').fill('Mira Ash')
  await dm.getByRole('button', exact('บันทึกชื่อ')).click()
  await dm.getByText('บันทึกชื่อตัวละครแล้ว', { exact: true }).waitFor()
  await guest.getByText('2 คน · Mira Ash, Guest', { exact: true }).waitFor()
  await openPanel(dm, 'คลังส่วนตัว')
  await dm.getByRole('heading', exact('Mira Ash')).waitFor()

  await openPanel(dm, 'ตั้งค่าบัญชี')
  await dm.getByRole('button', exact('ออกจากระบบ')).click()
  await dm.getByRole('button', exact('เข้าสู่ระบบ')).waitFor()
  assert.equal((await dm.request.get(roomPath)).status(), 403)

  await returning.goto(bookmark)
  await returning.getByLabel('อีเมล').fill(email)
  await returning.getByLabel('รหัสผ่าน', { exact: true }).fill('wrong-password')
  await returning.getByRole('button', exact('เข้าสู่ระบบ')).click()
  await returning.getByText('อีเมลหรือรหัสผ่านไม่ถูกต้อง', { exact: true }).waitFor()
  await returning.getByLabel('รหัสผ่าน', { exact: true }).fill(password)
  await returning.getByRole('button', exact('เข้าสู่ระบบ')).click()
  await openPanel(returning, 'ฉากและแผนที่')
  const rejoined = await (await returning.request.get(roomPath)).json()
  assert.deepEqual(rejoined.me, { ...original.me, name: 'Mira Ash' })
  assert.equal(rejoined.members.length, 2)
})

test('import a supplied D&D Beyond PDF and save a playable sheet', {
  skip: !process.env.BEHOLDER_TEST_PDF, timeout: 60000
}, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER
    ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const page = await seat(browser)
  await page.goto(base)
  await page.getByLabel('ชื่อห้อง').fill('Sheet import verification')
  await page.getByLabel('ชื่อที่ใช้บนโต๊ะ').fill('DM')
  await page.getByRole('button', exact('สร้างห้อง DM')).click()
  await openPanel(page, 'ชีตในห้อง')
  await page.getByRole('button', exact('+ ตัวละคร')).click()
  await page.getByLabel('นำเข้า PDF จาก D&D Beyond').setInputFiles(process.env.BEHOLDER_TEST_PDF!)
  await page.getByText(/อ่าน .+ แล้ว ตรวจข้อมูลก่อนบันทึก/).waitFor()
  assert.equal(await page.getByLabel('HP สูงสุด', { exact: true }).inputValue(), '80')
  assert.equal(await page.getByLabel('AC', { exact: true }).inputValue(), '20')
  assert.equal(await page.getByLabel('WIS', { exact: true }).inputValue(), '18')
  const importedName = await page.getByLabel('ชื่อ', { exact: true }).inputValue()
  await page.getByText('คำนวณค่าสถานะ D&D', { exact: true }).click()
  await page.getByLabel('คำนวณ Max HP แบบค่าคงที่ตามคลาส').check()
  await page.getByLabel('คำนวณ AC จากเกราะ').check()
  await page.getByLabel('ใช้ค่าเกราะสำเร็จรูป').selectOption('Plate')
  await page.getByLabel('ถือโล่ +2').check()
  assert.equal(await page.getByLabel('AC', { exact: true }).inputValue(), '20')
  assert.equal(await page.getByLabel('HP สูงสุด', { exact: true }).inputValue(), '80')
  await page.getByRole('button', exact('บันทึกชีต')).click()
  await page.getByRole('button', exact(importedName)).click()
  await page.getByRole('button', exact('Investigation check')).click()
  await page.getByText(/Investigation check/).first().waitFor()
})

test('a new player builds a character step by step and rolls from the sheet', { timeout: 45000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER
    ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const page = await seat(browser, { viewport: { width: 1280, height: 850 } })
  page.setDefaultTimeout(10000)
  const opened = await page.request.post(base + '/api/rooms', { data: { name: 'Wizard test', member: 'DM' } })
  const room: Snapshot = await opened.json()
  const path = base + '/api/rooms/' + room.id
  assert.equal((await page.request.post(path + '/commands', { data: {
    type: 'scene', name: 'Hall', cell: 48, originX: 0, originY: 0, commandId: randomUUID(), revision: room.revision
  } })).status(), 200)
  await page.goto(base + '/room/' + room.id)
  await openPanel(page, 'ชีตในห้อง')
  await page.getByRole('button', exact('+ ตัวละคร')).click()
  const wizard = page.getByRole('dialog', { name: 'สร้างตัวละคร' })
  await wizard.getByLabel('ชื่อตัวละคร').fill('Lyra')
  await wizard.getByRole('button', exact('ถัดไป')).click()
  // Species and background are optional; skipping them keeps the class's plain numbers.
  await wizard.getByRole('radiogroup', exact('Background')).waitFor()
  await wizard.getByRole('button', exact('ถัดไป')).click()
  await wizard.getByRole('radio', { name: /^Wizard/ }).click()
  await wizard.getByLabel('เลเวล').fill('3')
  await wizard.getByRole('button', exact('ถัดไป')).click()
  await wizard.getByRole('button', exact('ถัดไป')).click()
  await wizard.getByLabel('ชุดเกราะ').selectOption('Unarmored')
  await wizard.getByLabel(/^Longsword/).uncheck()
  await wizard.getByLabel(/^Quarterstaff/).check()
  await wizard.getByRole('button', exact('ถัดไป')).click()
  await wizard.getByText('Wizard 3', { exact: true }).waitFor()
  await wizard.getByRole('button', exact('สร้างตัวละคร')).click()
  await wizard.waitFor({ state: 'hidden' })
  const lyra = (await (await page.request.get(path)).json() as Snapshot).actors.find(actor => actor.name === 'Lyra')!
  assert.deepEqual([lyra.maxHp, lyra.hp, lyra.ac, lyra.attack, lyra.damage, lyra.spellDC], [20, 20, 11, 1, '1d6-1', 12])
  assert.ok(lyra.calculations?.hp, 'the D&D calculator stays on for later edits')

  // The sheet opens on its overview; clicking a score rolls it, and results stack under the sheet.
  await page.getByRole('button', exact('Lyra')).click()
  const sheet = page.getByRole('article', { name: 'ชีต Lyra' })
  await sheet.getByText('20/20', { exact: true }).waitFor()
  await sheet.getByRole('button', exact('Advantage')).click()
  // The dice reveal is brief: start watching for it before the roll, or a quick one can come and go first.
  const revealed = page.locator('.dice-reveal').waitFor({ state: 'attached' })
  await sheet.getByRole('button', exact('INT check')).click()
  // The result shows in the table's dice tray; the sheet stays open instead of being squeezed by the dice panel.
  await page.getByRole('complementary', { name: 'ถาดผลเต๋า' }).getByText(/INT check/).waitFor()
  assert.equal(await page.getByRole('region', exact('ลูกเต๋า')).count(), 0)
  await sheet.getByRole('tab', exact('Actions')).click()
  await sheet.getByRole('button', exact('Damage การโจมตีหลัก')).waitFor()

  // Every new roll gets a short dice animation; the Adventure Log keeps chat and rolls in one timeline.
  await revealed
  await openPanel(page, 'บันทึกการผจญภัย')
  const log = page.getByRole('region', exact('บันทึกการผจญภัย')).locator('.adventure-log-list')
  await log.getByText(/INT check/).waitFor()
  await page.getByLabel('ข้อความถึงโต๊ะ').fill('ตามมาทางนี้')
  await page.getByRole('button', exact('ส่ง')).click()
  await log.getByText('ตามมาทางนี้').waitFor()
  await page.getByLabel('ข้อความถึงโต๊ะ').fill('/r 1d4')
  await page.getByRole('button', exact('ส่ง')).click()
  await log.locator('.log-roll').filter({ hasText: '1d4' }).waitFor()
  assert.equal(await page.getByLabel('ข้อความถึงโต๊ะ').inputValue(), '')
})

test('a player ends their own turn; timed conditions and spell slots are tracked on the sheet', { timeout: 45000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER
    ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const dm = await seat(browser, { viewport: { width: 1280, height: 850 } })
  const player = await seat(browser, { viewport: { width: 1280, height: 850 } })
  dm.setDefaultTimeout(10000)
  player.setDefaultTimeout(10000)
  const room: Snapshot = await (await dm.request.post(base + '/api/rooms', { data: { name: 'Turn test', member: 'DM' } })).json()
  const path = base + '/api/rooms/' + room.id
  async function command(page: Page, body: Record<string, unknown>) {
    const state: Snapshot = await (await page.request.get(path)).json()
    const response = await page.request.post(path + '/commands', { data: { ...body, commandId: randomUUID(), revision: state.revision } })
    assert.equal(response.status(), 200, await response.text())
    return (await page.request.get(path)).json() as Promise<Snapshot>
  }
  const withScene = await command(dm, { type: 'scene', name: 'Arena', cell: 48, originX: 0, originY: 0 })
  const sceneId = withScene.scenes[0].id
  assert.equal((await player.request.post(base + '/api/join', { data: { invite: room.invite, name: 'Mira', role: 'player' } })).status(), 200)
  const withSheet = await command(player, { type: 'sheet', kind: 'pc', sheet: { ...blankSheet(), name: 'Lyra', slots: 'L1 2/2' } })
  const lyra = withSheet.actors.find(actor => actor.name === 'Lyra')!
  await command(player, { type: 'place', sceneId, actorId: lyra.id, role: 'character', x: 2, y: 2 })
  await command(dm, { type: 'combat', sceneId, participants: [lyra.id] })
  await dm.goto(base + '/room/' + room.id)
  await player.goto(base + '/room/' + room.id)

  // The combat HUD: turn order across the top, and the player is told it is their turn.
  await player.getByRole('complementary', { name: 'Turn Initiative' }).getByText('รอบ 1', { exact: true }).waitFor()
  const banner = player.getByRole('status').filter({ hasText: 'ถึงเทิร์นของคุณ, Lyra' })
  await banner.waitFor()

  // A condition for one round, picked from the SRD list on the sheet.
  await openPanel(player, 'ชีตในห้อง')
  await player.getByRole('button', exact('Lyra')).click()
  const sheet = player.getByRole('article', { name: 'ชีต Lyra' })
  await sheet.getByRole('button', { name: 'Condition' }).click()
  await sheet.getByLabel('นาน (รอบ)').fill('1')
  await sheet.getByRole('button', { name: /^Prone/ }).click()
  await sheet.locator('.condition-chip').filter({ hasText: 'Prone' }).waitFor()

  // Spell slots are pips: spend one, the count follows.
  await sheet.getByRole('tab', exact('Spells')).click()
  await sheet.getByRole('button', exact('ช่องเวทระดับ 1 ที่ 2 (ยังใช้ได้)')).click()
  await sheet.getByText('1/2', { exact: true }).waitFor()
  assert.equal((await (await player.request.get(path)).json() as Snapshot).actors[0].slots, 'L1 1/2')

  // Ending the turn starts round 2, which wears off the one-round condition.
  await banner.getByRole('button', exact('จบเทิร์น')).click()
  await player.getByRole('complementary', { name: 'Turn Initiative' }).getByText('รอบ 2', { exact: true }).waitFor()
  await sheet.getByRole('tab', exact('ภาพรวม')).click()
  await sheet.locator('.condition-chip').filter({ hasText: 'Prone' }).waitFor({ state: 'detached' })
  const finished = await (await dm.request.get(path)).json() as Snapshot
  assert.ok(finished.log!.some(entry => entry.text === 'Lyra พ้นจาก Prone'))
  await dm.getByRole('complementary', { name: 'Turn Initiative' }).getByText('รอบ 2', { exact: true }).waitFor()
})

test('manage scenes and reuse an account Object in another room', { timeout: 60000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER
    ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const page = await seat(browser, { viewport: { width: 1280, height: 850 } })
  page.setDefaultTimeout(10000)
  await page.goto(base)
  const account = await page.request.post(base + '/api/account/session', { data: {
    mode: 'register', email: randomUUID() + '@example.com', password: 'scene-library-test', name: 'Scene DM'
  } })
  assert.equal(account.status(), 201)
  await page.reload()

  async function openRoom(name: string, scene: string) {
    await startTable(page, name)
    await openPanel(page, 'ฉากและแผนที่')
    await createScene(page, scene)
    return base + '/api/rooms/' + roomIdOf(page.url())
  }
  async function placeTent() {
    await page.getByRole('button', exact('วางในฉาก')).click()
    await page.getByText('คลิกช่องเพื่อวาง Camp Tent', { exact: true }).waitFor()
    await page.locator(boardCanvas).click({ position: { x: 180, y: 135 } })
    await page.getByText('คลิกช่องเพื่อวาง Camp Tent', { exact: true }).waitFor({ state: 'hidden' })
  }

  const firstRoom = await openRoom('First campsite', 'Camp')
  await openPanel(page, 'คลังส่วนตัว')
  await page.locator('.personal-library').getByRole('button', exact('Object')).click()
  await page.getByRole('button', exact('+ Object')).click()
  await page.getByLabel('ชื่อ Object').fill('Camp Tent')
  await page.getByLabel('กว้าง (ช่อง)').fill('2')
  await page.getByRole('button', exact('บันทึก Object')).click()
  await page.getByRole('heading', exact('Camp Tent')).waitFor()
  await placeTent()
  const initial = await (await page.request.get(firstRoom)).json()
  const tent = initial.scenes[0].objects[0]

  await openPanel(page, 'ฉากและแผนที่')
  await page.getByRole('button', exact('คัดลอกฉาก')).click()
  await page.getByLabel('ชื่อฉากสำเนา').fill('Camp Copy')
  await page.getByRole('button', exact('สร้างสำเนา')).click()
  await page.getByRole('heading', exact('Camp Copy')).waitFor()
  await page.getByRole('button', exact('ย้ายฉาก Camp Copy ขึ้น')).click()
  await page.locator('.scene-row').first().getByText('Camp Copy', { exact: true }).waitFor()
  await page.locator('.scene-item').getByText('Camp', { exact: true }).click()
  await page.getByRole('button', exact('ลบฉาก')).click()
  await page.getByRole('button', exact('ยืนยันลบฉาก')).click()
  await page.getByRole('heading', exact('Camp Copy')).waitFor()
  const modified = await (await page.request.get(firstRoom)).json()
  assert.equal(modified.scenes.length, 1)
  assert.equal(modified.activeSceneId, modified.scenes[0].id)
  assert.notEqual(modified.scenes[0].objects[0].id, tent.id)

  await page.goto(base)
  const secondRoom = await openRoom('Second campsite', 'Forest')
  await openPanel(page, 'คลังส่วนตัว')
  await page.locator('.personal-library').getByRole('button', exact('Object')).click()
  await placeTent()
  const reused = (await (await page.request.get(secondRoom)).json()).scenes[0].objects[0]
  assert.equal(reused.name, tent.name)
  assert.equal(reused.width, 2)
  assert.notEqual(reused.id, tent.id)

  await openPanel(page, 'คลังส่วนตัว')
  await page.getByRole('button', exact('ลบ')).click()
  await page.getByRole('button', exact('ยืนยันลบ Object')).click()
  await page.getByText('ยังไม่มี Object ในคลัง', { exact: true }).waitFor()
  const placed = (await (await page.request.get(secondRoom)).json()).scenes[0].objects[0]
  assert.deepEqual(placed, reused)
})

test('DM reorders scene cards, lines the grid up on the map and tidies up in the management screen', { timeout: 60000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER
    ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const page = await seat(browser, { viewport: { width: 1280, height: 850 } })
  page.setDefaultTimeout(10000)
  await page.goto(base)
  const account = await page.request.post(base + '/api/account/session', { data: {
    mode: 'register', email: randomUUID() + '@example.com', password: 'back-office-test', name: 'Office DM'
  } })
  assert.equal(account.status(), 201)
  await page.reload()
  await startTable(page, 'Back office')
  await openPanel(page, 'ฉากและแผนที่')
  for (const name of ['Gate', 'Hall', 'Vault']) await createScene(page, name)
  const roomUrl = base + '/api/rooms/' + roomIdOf(page.url())
  const room = async (): Promise<Snapshot> => (await page.request.get(roomUrl)).json()

  // Drag the last card onto the first to reorder.
  const card = (name: string) => page.locator('.scene-row').filter({ has: page.locator('.scene-name', { hasText: new RegExp('^' + name + '$') }) })
  await card('Vault').dragTo(card('Gate'))
  await page.locator('.scene-row').first().locator('.scene-name', { hasText: 'Vault' }).waitFor()
  assert.deepEqual((await room()).scenes.map(scene => scene.name), ['Vault', 'Gate', 'Hall'])
  await card('Hall').getByRole('button', exact('เปิดฉาก Hall ให้ผู้เล่น')).click()
  await card('Hall').locator('.scene-badge.live').waitFor()

  // Calibrate the grid by drawing a box over the map.
  await card('Hall').locator('.scene-item').click()
  assert.ok(await page.getByRole('button', exact('ปรับ Grid บนภาพ')).isDisabled(), 'calibration needs a map')
  const upload = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/map'))
  await page.getByLabel('อัปโหลดแผนที่').setInputFiles({
    name: 'hall.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=', 'base64')
  })
  assert.equal((await upload).status(), 204)
  // The panel folds away after an upload so the new map is in view.
  await page.locator('.scene-panel').waitFor({ state: 'detached' })
  await openPanel(page, 'ฉากและแผนที่')
  await page.getByRole('button', exact('ปรับ Grid บนภาพ')).click()
  const calibrator = page.getByRole('region', exact('ปรับ Grid บนภาพ'))
  await calibrator.waitFor()
  const box = (await page.locator(boardCanvas).boundingBox())!
  await page.mouse.move(box.x + 500, box.y + 300)
  await page.mouse.down()
  await page.mouse.move(box.x + 580, box.y + 340, { steps: 4 })
  await page.mouse.move(box.x + 660, box.y + 380, { steps: 4 })
  await page.mouse.up()
  await calibrator.getByLabel('กรอบครอบกี่ช่อง (แนวนอน)').fill('2')
  await calibrator.getByRole('button', exact('เพิ่ม ขนาดช่อง (px)')).click()
  const cell = Number(await calibrator.locator('.grid-stepper').first().locator('b').textContent())
  assert.ok(cell > 12 && cell !== 56, 'the drawn box sets the cell size')
  await calibrator.getByRole('button', exact('บันทึก Grid')).click()
  await calibrator.waitFor({ state: 'detached' })
  assert.equal((await room()).scenes.find(scene => scene.name === 'Hall')!.cell, cell)

  // The management screen lists tokens, items and scenes across the whole table.
  assert.equal((await page.request.post(roomUrl + '/commands', { data: { type: 'demoEncounter', commandId: randomUUID(), revision: (await room()).revision } })).status(), 200)
  await page.getByRole('button', exact('ห้องเก็บของ DM')).click()
  const manage = page.getByRole('dialog', exact('ห้องเก็บของ DM'))
  await manage.getByRole('row').filter({ hasText: 'ยามด่าน' }).waitFor()
  const tokensBefore = (await room()).scenes.find(scene => scene.name === 'ด่านร้างริมทาง')!.tokens.length
  await manage.getByLabel('เลือก ลูกสมุน 1 ใน ด่านร้างริมทาง').check()
  await manage.getByLabel('เลือก ลูกสมุน 2 ใน ด่านร้างริมทาง').check()
  await manage.getByRole('button', exact('นำออกจากฉาก')).first().click()
  await manage.getByRole('toolbar', exact('คำสั่งกับรายการที่เลือก')).waitFor({ state: 'detached' })
  await manage.getByRole('row').filter({ hasText: /ลูกสมุน [12]/ }).first().waitFor({ state: 'detached' })
  assert.equal((await room()).scenes.find(scene => scene.name === 'ด่านร้างริมทาง')!.tokens.length, tokensBefore - 2)

  await manage.getByRole('button', { name: /Item และ Loot/ }).click()
  await manage.getByRole('button', exact('ในกล่อง')).click()
  await manage.getByRole('row').filter({ hasText: 'ยารักษา' }).waitFor()
  assert.equal(await manage.getByRole('row').filter({ hasText: 'เหรียญทองแดง' }).count(), 0, 'the filter hides loot carried by monsters')

  await manage.getByRole('button', { name: /ฉากในเรื่อง/ }).click()
  await manage.getByRole('row').filter({ hasText: 'Gate' }).click()
  await manage.getByRole('button', exact('เปิดให้ผู้เล่น')).click()
  await manage.getByRole('row').filter({ hasText: 'Gate' }).getByText('ผู้เล่นเห็นอยู่').waitFor()
  const opened = await room()
  assert.equal(opened.scenes.find(scene => scene.id === opened.activeSceneId)?.name, 'Gate')
  await page.keyboard.press('Escape')
  await manage.waitFor({ state: 'detached' })
  await page.keyboard.press('m')
  await manage.waitFor()
  await manage.getByRole('button', exact('ปิดห้องเก็บของ')).click()
  await manage.waitFor({ state: 'detached' })
})

test('first visit shows the role tour once; display settings stay on this device', { timeout: 45000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER
    ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
  page.setDefaultTimeout(10000)
  await page.goto(base)
  await page.getByLabel('ชื่อห้อง').fill('Tour table')
  await page.getByLabel('ชื่อที่ใช้บนโต๊ะ').fill('New DM')
  await page.getByRole('button', exact('สร้างห้อง DM')).click()

  const tour = page.getByRole('dialog', exact('ยินดีต้อนรับสู่โต๊ะของคุณ'))
  await tour.waitFor()
  await page.getByRole('button', exact('ถัดไป')).click()
  await page.getByRole('heading', exact('เริ่มจากฉาก')).waitFor()
  // The spotlight glides to the step target, then surrounds it.
  await page.waitForFunction(() => {
    const spot = document.querySelector('.tour-spot')?.getBoundingClientRect()
    const target = document.querySelector('#hud-rail button[aria-label="ฉากและแผนที่"]')?.getBoundingClientRect()
    return Boolean(spot && target && spot.left <= target.left && spot.right >= target.right && spot.top <= target.top && spot.bottom >= target.bottom)
  })
  await page.getByRole('button', exact('ก่อนหน้า')).click()
  await page.getByRole('heading', exact('ยินดีต้อนรับสู่โต๊ะของคุณ')).waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.tour').waitFor({ state: 'detached' })
  // The empty board says what to do next; the sample encounter itself now comes from the API.
  await page.getByText('สร้างฉากเพื่อเริ่มจัดกระดาน', { exact: true }).waitFor()
  const tourRoom = base + '/api/rooms/' + roomIdOf(page.url())
  const revision = ((await (await page.request.get(tourRoom)).json()) as Snapshot).revision
  assert.equal((await page.request.post(tourRoom + '/commands', { data: { type: 'demoEncounter', commandId: randomUUID(), revision } })).status(), 200)
  await page.getByRole('heading', exact('ด่านร้างริมทาง')).waitFor()

  await openPanel(page, 'ตั้งค่าการแสดงผล')
  await page.getByRole('button', exact('110%')).click()
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '17.6px')
  await page.getByRole('checkbox', { name: /^ลดแอนิเมชัน/ }).check()
  assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), 'reduce')
  await page.getByLabel('แสดงเส้น Grid บนกระดาน').uncheck()
  assert.equal(await page.getByRole('button', exact('แสดง Grid')).getAttribute('aria-pressed'), 'false')

  await page.reload()
  await page.getByRole('heading', exact('ด่านร้างริมทาง')).waitFor()
  assert.equal(await page.locator('.tour').count(), 0, 'the tour does not come back after it was closed')
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '17.6px')
  assert.equal(await page.getByRole('button', exact('แสดง Grid')).getAttribute('aria-pressed'), 'false')
  await page.keyboard.press('g')
  assert.equal(await page.getByRole('button', exact('แสดง Grid')).getAttribute('aria-pressed'), 'true')

  await openPanel(page, 'ตั้งค่าการแสดงผล')
  await page.getByRole('button', exact('เริ่มทัวร์แนะนำอีกครั้ง')).click()
  await page.getByRole('heading', exact('ยินดีต้อนรับสู่โต๊ะของคุณ')).waitFor()
  for (let step = 0; step < 5; step++) await page.getByRole('button', exact('ถัดไป')).click()
  await page.getByRole('button', exact('เริ่มเล่น')).click()
  await page.locator('.tour').waitFor({ state: 'detached' })
})

test('a player takes gear from the SRD item catalog, wields the weapon and wears the armor', { timeout: 45000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const page = await seat(browser, { viewport: { width: 1280, height: 850 } })
  page.setDefaultTimeout(10000)
  const opened = await page.request.post(base + '/api/rooms', { data: { name: 'Armory test', member: 'DM' } })
  const room: Snapshot = await opened.json()
  const path = base + '/api/rooms/' + room.id
  const hero = { ...blankSheet(), name: 'Vex', abilities: { STR: 10, DEX: 16, CON: 12, INT: 10, WIS: 10, CHA: 10 }, proficiency: 2, ac: 10 }
  assert.equal((await page.request.post(path + '/commands', { data: { type: 'sheet', kind: 'pc', sheet: hero, commandId: randomUUID(), revision: room.revision } })).status(), 200)
  const actorOf = async () => ((await (await page.request.get(path)).json()) as Snapshot).actors.find(actor => actor.name === 'Vex')!
  await page.goto(base + '/room/' + room.id)
  await openPanel(page, 'ชีตในห้อง')
  await page.getByRole('button', exact('Vex')).click()
  const sheet = page.getByRole('article', { name: 'ชีต Vex' })
  await sheet.getByRole('tab', exact('Inventory')).click()

  const catalog = sheet.getByRole('region', exact('คลังไอเทม SRD'))
  for (const [search, name] of [['rapier', 'Rapier'], ['leather', 'Leather Armor'], ['healing', 'Potions of Healing']] as const) {
    await sheet.getByRole('button', exact('เลือกจากคลัง SRD')).click()
    await catalog.getByLabel('ค้นหาไอเทม').fill(search)
    await catalog.getByRole('button', { name: new RegExp('^' + name) }).click()
    if (name === 'Potions of Healing') {
      await catalog.getByLabel('รุ่น').selectOption('Potion of Healing (greater)')
      await catalog.getByLabel('จำนวน').fill('2')
    }
    await catalog.getByRole('button', exact('เพิ่มลง Inventory')).click()
    await catalog.getByRole('button', exact('ปิดคลัง')).click()
  }
  await sheet.getByText('Inventory (3)', { exact: true }).waitFor()
  await sheet.getByText('Uncommon', { exact: true }).waitFor()

  await sheet.getByRole('button', exact('ใช้เป็นการโจมตี')).click()
  await sheet.getByRole('button', exact('อยู่ในการโจมตีแล้ว')).waitFor()
  await sheet.getByRole('button', exact('สวมใส่')).click()
  await waitInPage(page, async url => (await (await fetch(url)).json()).actors[0].ac === 14, path)
  const vex = await actorOf()
  assert.deepEqual(vex.attacks?.[0] && { ...vex.attacks[0], notes: undefined }, { name: 'Rapier', bonus: 5, damage: '1d8+3', damageKind: 'piercing', notes: undefined })
  assert.equal(vex.ac, 11 + 3, 'Leather Armor: 11 + Dex')
  const potion = vex.inventory!.find(item => item.ref === 'srd-5.2.1:magic:potions-of-healing')!
  assert.deepEqual([potion.name, potion.quantity, potion.rarity], ['Potion of Healing (greater)', 2, 'Uncommon'])
})

test('a dwarf soldier is built with Point Buy and a background, then levels up with a checklist', { timeout: 45000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const page = await seat(browser, { viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(10000)
  const opened = await page.request.post(base + '/api/rooms', { data: { name: 'Origins test', member: 'DM' } })
  const room: Snapshot = await opened.json()
  const path = base + '/api/rooms/' + room.id
  await page.goto(base + '/room/' + room.id)
  await openPanel(page, 'ชีตในห้อง')
  await page.getByRole('button', exact('+ ตัวละคร')).click()
  const wizard = page.getByRole('dialog', { name: 'สร้างตัวละคร' })
  await wizard.getByLabel('ชื่อตัวละคร').fill('Bram')
  await wizard.getByRole('button', exact('ถัดไป')).click()
  await wizard.getByRole('radio', { name: /^Dwarf/ }).click()
  await wizard.getByText(/Dwarven Toughness/).waitFor()
  await wizard.getByRole('radio', { name: /^Soldier/ }).click()
  await wizard.getByRole('button', exact('ถัดไป')).click()
  await wizard.getByRole('radio', { name: /^Fighter/ }).click()
  await wizard.getByLabel('เลเวล').fill('3')
  await wizard.getByRole('button', exact('ถัดไป')).click()

  await wizard.getByRole('radio', exact('Point Buy')).click()
  await wizard.getByText(/ใช้ไป 27 \/ 27/).waitFor()
  await wizard.getByLabel(/^INT/).fill('10')
  await wizard.getByText(/เกินงบ/).waitFor()
  assert.equal(await wizard.getByRole('button', exact('ถัดไป')).isDisabled(), true, 'over budget cannot continue')
  await wizard.getByLabel(/^INT/).fill('8')
  await wizard.getByRole('button', exact('ถัดไป')).click()
  await wizard.getByRole('button', exact('ถัดไป')).click()
  await wizard.getByText(/Dwarf · Soldier · Fighter 3/).waitFor()
  await wizard.getByRole('button', exact('สร้างตัวละคร')).click()
  await wizard.waitFor({ state: 'hidden' })
  const bram = ((await (await page.request.get(path)).json()) as Snapshot).actors.find(actor => actor.name === 'Bram')!
  assert.deepEqual([bram.abilities.STR, bram.abilities.CON, bram.speed, bram.size], [17, 15, 30, 'Medium'])
  assert.equal(bram.maxHp, 12 + 2 * 8 + 3, 'Fighter 3 with CON +2 and Dwarven Toughness')
  assert.deepEqual(Object.keys(bram.skillChecks ?? {}), ['Athletics', 'Intimidation'])

  await page.getByRole('button', exact('Bram')).click()
  const sheet = page.getByRole('article', { name: 'ชีต Bram' })
  await sheet.getByRole('button', exact('เลเวลอัป')).click()
  const levelling = page.getByRole('dialog', { name: 'เลเวลอัป · Bram' })
  // Fighter 4 offers an Ability Score Improvement or a feat; pick +2 CON.
  await levelling.getByText('Ability Score Improvement หรือ Feat', { exact: true }).waitFor()
  await levelling.getByLabel('Feat หรือ ASI').selectOption('Ability Score Improvement')
  await levelling.getByLabel('ค่าแรกที่เพิ่ม').selectOption('CON')
  await levelling.getByRole('button', exact('ยืนยันเลเวลอัป')).click()
  await levelling.waitFor({ state: 'hidden' })
  const levelled = ((await (await page.request.get(path)).json()) as Snapshot).actors.find(actor => actor.name === 'Bram')!
  assert.equal(levelled.abilities.CON, bram.abilities.CON + 2)
  assert.deepEqual(levelled.feats, ['Ability Score Improvement'])
  // CON 15 → 17 (+2 → +3) adds one HP to each earlier level too: the new level (6 + 3 + Dwarf 1) plus 3.
  assert.deepEqual([levelled.classLevel, levelled.maxHp], ['Fighter 4', bram.maxHp + 6 + 3 + 1 + 3])
})

test('a character spends a Hit Die, uses a class resource and takes a Long Rest', { timeout: 45000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const page = await seat(browser, { viewport: { width: 1280, height: 850 } })
  page.setDefaultTimeout(10000)
  const opened = await page.request.post(base + '/api/rooms', { data: { name: 'Rest test', member: 'DM' } })
  const room: Snapshot = await opened.json()
  const path = base + '/api/rooms/' + room.id
  const hero = { ...blankSheet(), name: 'Kael', classLevel: 'Fighter 3', hp: 10, maxHp: 30, abilities: { STR: 16, DEX: 12, CON: 14, INT: 10, WIS: 10, CHA: 10 } }
  assert.equal((await page.request.post(path + '/commands', { data: { type: 'sheet', kind: 'pc', sheet: hero, commandId: randomUUID(), revision: room.revision } })).status(), 200)
  const kael = async () => ((await (await page.request.get(path)).json()) as Snapshot).actors.find(actor => actor.name === 'Kael')!
  await page.goto(base + '/room/' + room.id)
  await openPanel(page, 'ชีตในห้อง')
  await page.getByRole('button', exact('Kael')).click()
  const sheet = page.getByRole('article', { name: 'ชีต Kael' })
  await sheet.getByRole('tab', exact('Rest')).click()

  await sheet.getByRole('button', { name: /^เพิ่มทรัพยากรตามคลาส/ }).click()
  await sheet.getByRole('button', exact('Second Wind ที่ 1 (ยังใช้ได้)')).click()
  await sheet.getByRole('button', exact('Second Wind ที่ 2 (ใช้แล้ว)')).waitFor()
  await sheet.getByRole('button', exact('Action Surge ที่ 1 (ยังใช้ได้)')).click()
  await sheet.getByRole('button', exact('Action Surge ที่ 1 (ใช้แล้ว)')).waitFor()
  await sheet.getByRole('button', exact('ใช้ Hit Die d10')).click()
  await sheet.getByText('2/3', { exact: true }).waitFor()
  const rested = await kael()
  assert.ok(rested.hp > 10, 'a Hit Die heals')
  assert.deepEqual(rested.resources?.map(entry => [entry.name, entry.used]), [['Second Wind', 1], ['Action Surge', 1]])

  await sheet.getByRole('button', exact('พักสั้น (Short Rest)')).click()
  await sheet.getByRole('button', exact('Action Surge ที่ 1 (ยังใช้ได้)')).waitFor()
  await sheet.getByRole('button', exact('พักยาว (Long Rest)')).click()
  await sheet.getByText('3/3', { exact: true }).waitFor()
  const after = await kael()
  assert.deepEqual([after.hp, after.hitDiceSpent, after.resources?.map(entry => entry.used)], [30, {}, [0, 0]])
  await page.locator('.rolls, .dice-tray').getByText(/Hit Die · Kael/).first().waitFor()
})

test('the DM opens token conditions from the board, sets Poisoned and steps Exhaustion', { timeout: 45000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const page = await seat(browser, { viewport: { width: 1280, height: 850 } })
  page.setDefaultTimeout(10000)
  const opened = await page.request.post(base + '/api/rooms', { data: { name: 'Condition test', member: 'DM' } })
  const room: Snapshot = await opened.json()
  const path = base + '/api/rooms/' + room.id
  const command = async (body: Record<string, unknown>) => {
    const revision = ((await (await page.request.get(path)).json()) as Snapshot).revision
    assert.equal((await page.request.post(path + '/commands', { data: { ...body, commandId: randomUUID(), revision } })).status(), 200)
  }
  await command({ type: 'scene', name: 'Cave', cell: 48, originX: 0, originY: 0 })
  await command({ type: 'sheet', kind: 'pc', sheet: { ...blankSheet(), name: 'Mira' } })
  await page.goto(base + '/room/' + room.id)
  await openPanel(page, 'ชีตในห้อง')
  await page.getByRole('button', exact('วาง Mira')).click()
  await page.locator(boardCanvas).click({ position: { x: 210, y: 160 } })
  await waitInPage(page, async url => (await (await fetch(url)).json()).scenes[0].tokens.length === 1, path)

  await page.locator(boardCanvas).click({ position: { x: 210, y: 160 }, button: 'right' })
  await page.locator('.context-popover').getByRole('button', exact('Condition')).click()
  const panel = page.getByRole('dialog', exact('Condition · Mira'))
  await panel.getByText('ไม่มี Condition', { exact: true }).waitFor()
  await panel.getByRole('button', exact('Condition')).click()
  await panel.getByRole('button', { name: /^Poisoned/ }).click()
  await panel.locator('.condition-chip').filter({ hasText: 'Poisoned' }).waitFor()
  await panel.getByRole('button', { name: /^Exhaustion/ }).click()
  await panel.locator('.condition-chip').filter({ hasText: 'Exhaustion 1' }).waitFor()
  await panel.getByRole('button', exact('เพิ่มระดับ Exhaustion')).click()
  await panel.locator('.condition-chip').filter({ hasText: 'Exhaustion 2' }).waitFor()
  await panel.getByText('-4 D20 Tests · -10 ft. Speed', { exact: true }).waitFor()
  const mira = ((await (await page.request.get(path)).json()) as Snapshot).actors.find(actor => actor.name === 'Mira')!
  assert.equal(mira.conditions, 'Poisoned, Exhaustion 2')

  // The most limiting condition is listed first, with what it does.
  await panel.locator('.condition-details li').first().getByText(/^Poisoned/).waitFor()
  await page.keyboard.press('Escape')
  await panel.waitFor({ state: 'detached' })
})

test('Hold Person from the board: a repeat save comes due at the end of the target turn, and damage asks for Concentration', { timeout: 60000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const page = await seat(browser, { viewport: { width: 1280, height: 850 } })
  page.setDefaultTimeout(10000)
  const opened = await page.request.post(base + '/api/rooms', { data: { name: 'Effects test', member: 'DM' } })
  const room: Snapshot = await opened.json()
  const path = base + '/api/rooms/' + room.id
  const state = async () => (await (await page.request.get(path)).json()) as Snapshot
  const command = async (body: Record<string, unknown>) => {
    const response = await page.request.post(path + '/commands', { data: { ...body, commandId: randomUUID(), revision: (await state()).revision } })
    assert.equal(response.status(), 200, await response.text())
  }
  await command({ type: 'scene', name: 'Crypt', cell: 48, originX: 0, originY: 0 })
  await command({ type: 'sheet', kind: 'pc', sheet: { ...blankSheet(), name: 'Kael', hp: 30, maxHp: 30 } })
  await command({ type: 'sheet', kind: 'pc', sheet: { ...blankSheet(), name: 'Lyra', hp: 30, maxHp: 30 } })
  await page.goto(base + '/room/' + room.id)
  for (const [name, x] of [['Kael', 210], ['Lyra', 330]] as const) {
    await openPanel(page, 'ชีตในห้อง')
    await page.getByRole('button', exact('วาง ' + name)).click()
    await page.locator(boardCanvas).click({ position: { x, y: 160 } })
    await waitInPage(page, async ([url, count]) => (await (await fetch(url)).json()).scenes[0].tokens.length === count, [path, name === 'Kael' ? 1 : 2] as const)
  }
  const actorId = async (name: string) => (await state()).actors.find(actor => actor.name === name)!.id
  const kael = await actorId('Kael')
  const lyra = await actorId('Lyra')
  await command({ type: 'combat', sceneId: (await state()).activeSceneId, participants: [kael, lyra] })

  await page.locator(boardCanvas).click({ position: { x: 210, y: 160 }, button: 'right' })
  await page.locator('.context-popover').getByRole('button', exact('Condition')).click()
  const panel = page.getByRole('dialog', exact('Condition · Kael'))
  await panel.getByText('เพิ่ม Condition แบบมีที่มา', { exact: true }).click()
  await panel.getByLabel('Condition ที่จะเพิ่ม').selectOption('Paralyzed')
  await panel.getByLabel('ผู้ทำ', { exact: true }).selectOption(lyra)
  await panel.getByLabel('มาจาก (เวท / ความสามารถ)').fill('Hold Person')
  await panel.getByLabel(/ทอยเซฟซ้ำตอนจบเทิร์น/).check()
  await panel.getByLabel('DC', { exact: true }).fill('1')
  await panel.getByLabel('ผูกกับ Concentration ของผู้ทำ').check()
  await panel.getByRole('button', exact('เพิ่ม Paralyzed')).click()
  await panel.getByText(/จาก Hold Person · Lyra · ผูกกับ Concentration · ทอย WIS save DC 1/).waitFor()
  let snap = await state()
  assert.ok(snap.actors.find(actor => actor.id === lyra)!.effects!.some(effect => effect.condition === 'Concentration'))
  await page.keyboard.press('Escape')
  await panel.waitFor({ state: 'detached' })

  // Pass turns until Kael's turn ends; then the save waits for whoever controls Kael.
  for (let turn = 0; turn < 3 && !(await state()).actors.find(actor => actor.id === kael)!.effects!.some(effect => effect.pending); turn++) {
    await command({ type: 'next', sceneId: snap.activeSceneId })
  }
  const waiting = page.getByRole('region', exact('รอทอยเซฟ'))
  await waiting.getByText(/WIS save DC 1 · Paralyzed \(Hold Person\)/).waitFor()
  await waiting.getByRole('button', exact('ทอย')).click()
  await waiting.waitFor({ state: 'detached' })
  snap = await state()
  assert.equal(snap.actors.find(actor => actor.id === kael)!.effects!.length, 0, 'DC 1 always passes; Paralyzed ends')

  // Damage on the caster asks for a Concentration check: DC 10 for 12 damage.
  await command({ type: 'adjustHp', sceneId: snap.activeSceneId, actorId: lyra, amount: 12, mode: 'damage' })
  await waiting.getByText(/CON save DC 10 · Concentration/).waitFor()
  await waiting.getByRole('button', exact('ข้าม')).click()
  await waiting.waitFor({ state: 'detached' })
})

test('a player clicks a monster to target it and attacks from the token bar; the sheet keeps the same target', { timeout: 60000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const dm = await seat(browser, { viewport: { width: 1280, height: 850 } })
  const player = await seat(browser, { viewport: { width: 1280, height: 850 } })
  for (const page of [dm, player]) page.setDefaultTimeout(10000)
  const opened = await dm.request.post(base + '/api/rooms', { data: { name: 'Target test', member: 'DM' } })
  const room: Snapshot = await opened.json()
  const path = base + '/api/rooms/' + room.id
  const state = async (page: Page) => (await (await page.request.get(path)).json()) as Snapshot
  const command = async (page: Page, body: Record<string, unknown>) => {
    const response = await page.request.post(path + '/commands', { data: { ...body, commandId: randomUUID(), revision: (await state(page)).revision } })
    assert.equal(response.status(), 200, await response.text())
  }
  await command(dm, { type: 'scene', name: 'Road', cell: 48, originX: 0, originY: 0 })
  await player.goto(base + '/?invite=' + room.invite + '&room=' + room.id)
  await player.getByLabel('ชื่อที่ใช้บนโต๊ะ').fill('Vex player')
  await player.getByRole('button', exact('เข้าร่วม')).click()
  await player.getByRole('button', exact('เมนูโต๊ะ')).waitFor()
  await command(player, { type: 'sheet', kind: 'pc', sheet: { ...blankSheet(), name: 'Vex', attack: 5, damage: '1d8+3',
    attacks: [{ name: 'Shortbow', bonus: 4, damage: '1d6+2', damageKind: 'piercing' }] } })
  await openPanel(player, 'ชีตในห้อง')
  await player.getByRole('button', exact('วาง Vex')).click()
  await player.locator(boardCanvas).click({ position: { x: 210, y: 160 } })
  await waitInPage(player, async url => (await (await fetch(url)).json()).scenes[0].tokens.length === 1, path)
  const vexToken = (await state(dm)).scenes[0].tokens[0]
  await command(dm, { type: 'place', sceneId: (await state(dm)).scenes[0].id, kind: 'monster',
    sheet: { ...blankSheet('monster'), name: 'Bandit', hp: 11, maxHp: 11, ac: 12 }, x: vexToken.x + 2, y: vexToken.y })
  await command(dm, { type: 'place', sceneId: (await state(dm)).scenes[0].id, kind: 'monster',
    sheet: { ...blankSheet('monster'), name: 'Wolf', hp: 11, maxHp: 11, ac: 13 }, x: vexToken.x + 6, y: vexToken.y + 4 })
  const bandit = (await state(dm)).actors.find(actor => actor.name === 'Bandit')!.id

  // The sheet's target list puts foes first, nearest first, with the distance.
  await openPanel(player, 'ชีตในห้อง')
  await player.getByRole('button', exact('Vex')).click()
  const sheet = player.getByRole('article', { name: 'ชีต Vex' })
  await sheet.getByRole('tab', exact('Actions')).click()
  const picker = sheet.getByLabel('เป้าหมายการโจมตี')
  await picker.locator('option', { hasText: 'Bandit · 10 ft.' }).waitFor({ state: 'attached' })
  assert.equal(await picker.inputValue(), bandit, 'the nearest foe is picked by default')

  // Clicking the monster on the board targets it; the player's own sheet stays open.
  const cell = (await state(player)).scenes[0].cell
  await player.locator(boardCanvas).click({ position: { x: 210 + 2 * cell, y: 160 } })
  const bar = player.getByRole('toolbar', exact('คำสั่งของ Bandit'))
  await bar.waitFor()
  await sheet.waitFor()
  await bar.getByRole('button', { name: /^โจมตีด้วย Vex \(\+5\)/ }).click()
  await waitInPage(player, async ([url, target]) => (await (await fetch(url)).json()).rolls.some((roll: { label: string; targetId?: string }) =>
    roll.label.startsWith('attack · Vex') && roll.targetId === target), [path, bandit] as const)
  await bar.getByRole('button', { name: /^Shortbow \(\+4\)/ }).waitFor()
  assert.equal(await picker.inputValue(), bandit, 'the sheet follows the board target')
})

test('0.06: dice pool, signed quick HP, box selection, encounter end, and a movable UI that resets', { timeout: 60000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const page = await seat(browser, { viewport: { width: 1280, height: 850 } })
  page.setDefaultTimeout(10000)
  const opened = await page.request.post(base + '/api/rooms', { data: { name: 'Release 0.06', member: 'DM' } })
  const room: Snapshot = await opened.json()
  const path = base + '/api/rooms/' + room.id
  const state = async () => (await (await page.request.get(path)).json()) as Snapshot
  const command = async (body: Record<string, unknown>) => {
    const response = await page.request.post(path + '/commands', { data: { ...body, commandId: randomUUID(), revision: (await state()).revision } })
    assert.equal(response.status(), 200, await response.text())
  }
  await command({ type: 'scene', name: 'Yard', cell: 48, originX: 0, originY: 0 })
  const sceneId = (await state()).scenes[0].id
  for (const [name, x] of [['Rat', 2], ['Bat', 3]] as const) {
    await command({ type: 'place', sceneId, kind: 'monster', sheet: { ...blankSheet('monster'), name, hp: 20, maxHp: 20 }, x, y: 2 })
  }
  await page.goto(base + '/room/' + room.id)
  await page.getByRole('button', exact('เมนูโต๊ะ')).waitFor()

  // Dice: tap d6, d6, d4 and the modifier, then roll the whole pool.
  await openPanel(page, 'ลูกเต๋า')
  for (const die of ['d6', 'd6', 'd4']) await page.getByRole('button', exact('เพิ่ม ' + die)).click()
  await page.getByRole('button', exact('เพิ่มตัวปรับ')).click()
  await page.getByRole('button', exact('ทอย 2d6+1d4+1')).click()
  await waitInPage(page, async url => (await (await fetch(url)).json()).rolls.some((roll: { formula: string; faces: number[] }) => roll.formula === '2d6+1d4+1' && roll.faces.length === 3), path)
  await page.getByRole('button', exact('d20 Advantage')).click()
  await waitInPage(page, async url => (await (await fetch(url)).json()).rolls.some((roll: { label: string; faces: number[] }) => roll.label.endsWith('Advantage') && roll.faces.length === 2), path)
  await page.keyboard.press('Escape')

  // Press and hold on empty map, then drag around both monsters: a selection box.
  const canvas = page.locator(boardCanvas)
  const frame = (await canvas.boundingBox())!
  const cellAt = (x: number, y: number) => ({ x: frame.x + 36 + x * 48, y: frame.y + 36 + y * 48 })
  const from = cellAt(1.2, 1.2)
  const to = cellAt(4.8, 3.6)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.waitForTimeout(400)
  await page.mouse.move(to.x, to.y, { steps: 6 })
  await page.mouse.up()
  await page.getByRole('status').filter({ hasText: 'เลือก 2 Token' }).waitFor()

  // Quick HP from the token bar: -5 is damage, 3 heals.
  await page.keyboard.press('Escape')
  const rat = cellAt(2.5, 2.5)
  await page.mouse.click(rat.x, rat.y)
  const quick = page.getByLabel('ปรับ HP ของ Rat')
  await quick.fill('-5')
  await quick.press('Enter')
  await waitInPage(page, async url => (await (await fetch(url)).json()).actors.find((actor: { name: string }) => actor.name === 'Rat')?.hp === 15, path)
  await quick.fill('3')
  await quick.press('Enter')
  await waitInPage(page, async url => (await (await fetch(url)).json()).actors.find((actor: { name: string }) => actor.name === 'Rat')?.hp === 18, path)

  // Ending a fight shows the encounter-end banner.
  const s = await state()
  await command({ type: 'combat', sceneId, participants: s.actors.map(actor => actor.id) })
  await page.getByRole('complementary', { name: 'Turn Initiative' }).waitFor()
  await command({ type: 'end', sceneId })
  await page.getByText('การต่อสู้จบลง', { exact: true }).waitFor()

  // Move the dice tray by its grip; the place survives a reload, and reset puts it back.
  const tray = page.getByRole('complementary', { name: 'ถาดผลเต๋า' })
  const before = (await tray.boundingBox())!
  const grip = (await page.getByRole('button', exact('ย้าย ถาดผลเต๋า')).boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x - 200, grip.y - 120, { steps: 8 })
  await page.mouse.up()
  const moved = (await tray.boundingBox())!
  assert.ok(Math.abs(moved.x - (before.x - 200 - grip.width / 2 + grip.width / 2)) < 30 && moved.y < before.y - 80, 'the tray follows the grip')
  await page.reload()
  await page.getByRole('button', exact('เมนูโต๊ะ')).waitFor()
  assert.ok(Math.abs((await tray.boundingBox())!.x - moved.x) < 2, 'the place is kept on this device')
  await openPanel(page, 'ตั้งค่าการแสดงผล')
  await page.getByRole('button', exact('รีเซ็ตตำแหน่ง UI')).click()
  await page.waitForFunction(() => !(document.querySelector('.dice-tray') as HTMLElement).style.translate)
  await page.keyboard.press('Escape')
  await page.waitForFunction(x => Math.abs(document.querySelector('.dice-tray')!.getBoundingClientRect().x - x) < 2, before.x)
})

test('0.07: a player sets an SRD item on the map, drops a bag item to the floor, and a friend picks it up', { timeout: 60000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const dm = await seat(browser)
  const mira = await seat(browser, { viewport: { width: 1280, height: 850 } })
  const room: Snapshot = await (await dm.request.post(base + '/api/rooms', { data: { name: 'Release 0.07 items', member: 'DM' } })).json()
  const path = base + '/api/rooms/' + room.id
  const command = async (page: Page, body: Record<string, unknown>) => {
    const state = await (await page.request.get(path)).json() as Snapshot
    const response = await page.request.post(path + '/commands', { data: { ...body, commandId: randomUUID(), revision: state.revision } })
    assert.equal(response.status(), 200, await response.text())
    return (await page.request.get(path)).json() as Promise<Snapshot>
  }
  const state = async () => (await (await dm.request.get(path)).json()) as Snapshot
  const sceneId = (await command(dm, { type: 'scene', name: 'Camp', cell: 48, originX: 0, originY: 0 })).scenes[0].id
  assert.equal((await mira.request.post(base + '/api/join', { data: { invite: room.invite, name: 'Mira', role: 'player' } })).status(), 200)
  const lyra = (await command(mira, { type: 'sheet', kind: 'pc', sheet: { ...blankSheet(), name: 'Lyra',
    inventory: [{ id: 'g', name: 'Gem', description: 'A blue stone' }] } })).actors.find(actor => actor.name === 'Lyra')!
  await command(mira, { type: 'place', sceneId, actorId: lyra.id, role: 'character', x: 2, y: 2 })
  await mira.goto(base + '/room/' + room.id)
  await mira.getByRole('button', exact('เมนูโต๊ะ')).waitFor()

  // Pick Rope from the SRD item panel and click a square: it lands as a temp item with its map art.
  await openPanel(mira, 'คลังไอเทม SRD')
  await mira.getByLabel('ค้นหาไอเทม').fill('Rope')
  await mira.locator('.item-catalog-list').getByRole('button', { name: /^Rope/ }).first().click()
  await mira.getByRole('button', exact('วางบนฉาก')).click()
  await mira.getByText('คลิกช่องเพื่อวาง Rope').waitFor()
  const frame = (await mira.locator(boardCanvas).boundingBox())!
  const cellAt = (x: number, y: number) => ({ x: frame.x + 36 + x * 48, y: frame.y + 36 + y * 48 })
  const spot = cellAt(3.5, 2.5)
  await mira.mouse.click(spot.x, spot.y)
  await waitInPage(mira, async url => (await (await fetch(url)).json()).scenes[0].objects?.some((object: { name: string; temp?: boolean }) => object.name === 'Rope' && object.temp), path)
  const rope = (await state()).scenes[0].objects!.find(object => object.name === 'Rope')!
  assert.equal(rope.image, '/art/srd/objects/rope.webp')
  assert.ok((await state()).log!.some(entry => entry.text === 'Mira วาง Rope'), 'the DM can see who placed it')

  // Drop the Gem from Lyra's bag: a floor pile appears under her token.
  await openPanel(mira, 'ชีตในห้อง')
  await mira.getByRole('button', exact('Lyra')).click()
  const sheet = mira.getByRole('article', { name: 'ชีต Lyra' })
  await sheet.getByRole('tab', { name: /Inventory|ของ/ }).first().click()
  await sheet.getByRole('button', exact('ทิ้ง Gem ลงพื้น')).click()
  await waitInPage(mira, async url => (await (await fetch(url)).json()).scenes[0].objects?.some((object: { pile?: boolean }) => object.pile), path)
  const after = await state()
  assert.equal(after.actors.find(actor => actor.id === lyra.id)!.inventory?.length ?? 0, 0)

  // Another player next to the pile takes the Gem; the empty pile goes away.
  const bramSeat = await seat(browser)
  assert.equal((await bramSeat.request.post(base + '/api/join', { data: { invite: room.invite, name: 'Bram', role: 'player' } })).status(), 200)
  const bram = (await command(bramSeat, { type: 'sheet', kind: 'pc', sheet: { ...blankSheet(), name: 'Bram' } })).actors.find(actor => actor.name === 'Bram')!
  await command(bramSeat, { type: 'place', sceneId, actorId: bram.id, role: 'character', x: 3, y: 3 })
  const pile = after.scenes[0].objects!.find(object => object.pile)!
  assert.ok(pile.kind === 'container')
  await command(bramSeat, { type: 'takeItem', sceneId, objectId: pile.id, actorId: bram.id, itemId: pile.items[0].id })
  await command(bramSeat, { type: 'takeItem', sceneId, objectId: rope.id, actorId: bram.id })
  const final = await state()
  assert.deepEqual(final.actors.find(actor => actor.id === bram.id)!.inventory!.map(item => item.name).sort(), ['Gem', 'Rope'])
  assert.ok(!final.scenes[0].objects!.some(object => object.pile))
})

test('0.07: conditions pick Advantage or Disadvantage on their own, and right-click picks it by hand', { timeout: 60000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const dm = await seat(browser)
  const mira = await seat(browser, { viewport: { width: 1280, height: 850 } })
  const room: Snapshot = await (await dm.request.post(base + '/api/rooms', { data: { name: 'Release 0.07 odds', member: 'DM' } })).json()
  const path = base + '/api/rooms/' + room.id
  const command = async (page: Page, body: Record<string, unknown>) => {
    const state = await (await page.request.get(path)).json() as Snapshot
    const response = await page.request.post(path + '/commands', { data: { ...body, commandId: randomUUID(), revision: state.revision } })
    assert.equal(response.status(), 200, await response.text())
    return (await page.request.get(path)).json() as Promise<Snapshot>
  }
  const sceneId = (await command(dm, { type: 'scene', name: 'Bog', cell: 48, originX: 0, originY: 0 })).scenes[0].id
  assert.equal((await mira.request.post(base + '/api/join', { data: { invite: room.invite, name: 'Mira', role: 'player' } })).status(), 200)
  const lyra = (await command(mira, { type: 'sheet', kind: 'pc', sheet: { ...blankSheet(), name: 'Lyra', conditions: 'Poisoned' } })).actors.find(actor => actor.name === 'Lyra')!
  await command(mira, { type: 'place', sceneId, actorId: lyra.id, role: 'character', x: 2, y: 2 })
  await mira.goto(base + '/room/' + room.id)
  await openPanel(mira, 'ชีตในห้อง')
  await mira.getByRole('button', exact('Lyra')).click()
  const sheet = mira.getByRole('article', { name: 'ชีต Lyra' })
  const lastRoll = async () => ((await (await mira.request.get(path)).json()) as Snapshot).rolls.at(-1)

  // Poisoned: a plain click on a check rolls with Disadvantage and says why.
  await sheet.getByRole('button', exact('STR check')).click()
  await waitInPage(mira, async url => (await (await fetch(url)).json()).rolls.length === 1, path)
  let roll = (await lastRoll())!
  assert.equal(roll.faces.length, 2)
  assert.match(roll.label, /Disadvantage · Poisoned/)

  // Right-click: the menu suggests Disadvantage; picking Advantage overrides it.
  await sheet.getByRole('button', exact('DEX check')).click({ button: 'right' })
  const menu = mira.getByRole('menu', { name: /เลือกการทอย/ })
  await menu.getByRole('menuitem', { name: /Disadvantage.*แนะนำ/ }).waitFor()
  await menu.getByRole('menuitem', { name: /^Advantage/ }).click()
  await waitInPage(mira, async url => (await (await fetch(url)).json()).rolls.length === 2, path)
  roll = (await lastRoll())!
  assert.equal(roll.faces.length, 2)
  assert.match(roll.label, /Advantage \(เลือกเอง\)/)
  await menu.waitFor({ state: 'detached' })
})

test('0.07: phone and tablet seats (touch): no sideways scroll, panels open, and holding a roll opens its menu', { timeout: 90000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const host = await seat(browser)
  const room: Snapshot = await (await host.request.post(base + '/api/rooms', { data: { name: 'Release 0.07 touch', member: 'DM' } })).json()
  const path = base + '/api/rooms/' + room.id
  const command = async (page: Page, body: Record<string, unknown>) => {
    const state = await (await page.request.get(path)).json() as Snapshot
    const response = await page.request.post(path + '/commands', { data: { ...body, commandId: randomUUID(), revision: state.revision } })
    assert.equal(response.status(), 200, await response.text())
    return (await page.request.get(path)).json() as Promise<Snapshot>
  }
  const sceneId = (await command(host, { type: 'scene', name: 'Road', cell: 48, originX: 0, originY: 0 })).scenes[0].id
  const devices = [
    { name: 'iPhone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
    { name: 'iPad', viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2 }
  ]
  for (const device of devices) {
    const page = await seat(browser, { viewport: device.viewport, deviceScaleFactor: device.deviceScaleFactor, hasTouch: true, isMobile: true })
    page.setDefaultTimeout(10000)
    assert.equal((await page.request.post(base + '/api/join', { data: { invite: room.invite, name: device.name, role: 'player' } })).status(), 200)
    const hero = (await command(page, { type: 'sheet', kind: 'pc', sheet: { ...blankSheet(), name: device.name + ' Hero' } })).actors.find(actor => actor.name === device.name + ' Hero')!
    await command(page, { type: 'place', sceneId, actorId: hero.id, role: 'character', x: devices.indexOf(device) + 1, y: 1 })
    await page.goto(base + '/room/' + room.id)
    await page.getByRole('button', exact('เมนูโต๊ะ')).waitFor()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    assert.ok(overflow <= 1, device.name + ': the page does not scroll sideways (' + overflow + 'px)')

    // Panels open from the folded rail by tapping.
    await openPanel(page, 'ชีตในห้อง')
    await page.getByRole('button', exact(device.name + ' Hero')).tap()
    const sheet = page.getByRole('article', { name: 'ชีต ' + device.name + ' Hero' })
    const check = sheet.getByRole('button', exact('WIS check'))
    await check.scrollIntoViewIfNeeded()
    const box = (await check.boundingBox())!
    assert.ok(box.x >= 0 && box.x + box.width <= device.viewport.width + 1, device.name + ': the sheet fits on screen')

    // Press and hold a roll: the roll menu opens and the lifting finger does not also roll.
    const before = ((await (await page.request.get(path)).json()) as Snapshot).rolls.length
    const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, pointerType: 'touch', isPrimary: true, bubbles: true }
    await check.dispatchEvent('pointerdown', at)
    await page.waitForTimeout(650)
    await check.dispatchEvent('pointerup', at)
    await check.dispatchEvent('click', at)
    const menu = page.getByRole('menu', { name: /เลือกการทอย/ })
    await menu.waitFor()
    assert.equal(((await (await page.request.get(path)).json()) as Snapshot).rolls.length, before, device.name + ': holding does not roll by itself')
    await menu.getByRole('menuitem', { name: /^Disadvantage/ }).tap()
    await waitInPage(page, async ([url, count]) => (await (await fetch(url as string)).json()).rolls.length > (count as number), [path, before])
    const roll = ((await (await page.request.get(path)).json()) as Snapshot).rolls.at(-1)!
    assert.equal(roll.faces.length, 2)
    assert.match(roll.label, /Disadvantage \(เลือกเอง\)/)
    await page.close()
  }
})

test('0.08: the board draws with Pixi, tokens glide to a new square, and an attack plays on the board', { timeout: 60000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const page = await seat(browser, { viewport: { width: 1280, height: 800 } })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const room: Snapshot = await (await page.request.post(base + '/api/rooms', { data: { name: 'Release 0.08 board', member: 'DM' } })).json()
  const path = base + '/api/rooms/' + room.id
  const command = async (body: Record<string, unknown>) => {
    const state = await (await page.request.get(path)).json() as Snapshot
    const response = await page.request.post(path + '/commands', { data: { ...body, commandId: randomUUID(), revision: state.revision } })
    assert.equal(response.status(), 200, await response.text())
    return (await page.request.get(path)).json() as Promise<Snapshot>
  }
  const sceneId = (await command({ type: 'scene', name: 'Road', cell: 48, originX: 0, originY: 0 })).scenes[0].id
  for (const [name, x] of [['Bandit', 1], ['Wolf', 2]] as const) {
    await command({ type: 'place', sceneId, kind: 'monster', sheet: { ...blankSheet('monster'), name, hp: 9, maxHp: 9, ac: 1 }, x, y: 1 })
  }
  await page.goto(base + '/room/' + room.id)
  await page.locator(boardCanvas + '[data-renderer=pixi]').waitFor()
  const board = await page.evaluate(() => {
    const b = (window as unknown as { beholderBoard: { app: { renderer: { name: string }; ticker: { started: boolean }; stage: { children: unknown[] } } } }).beholderBoard
    return { backend: b.app.renderer.name, running: b.app.ticker.started, layers: b.app.stage.children.length }
  })
  assert.ok(['webgl', 'webgpu', 'canvas'].includes(board.backend), 'a Pixi backend: ' + board.backend)
  assert.equal(board.running, true)
  assert.ok(board.layers > 0)

  // Moving a token: it glides (between squares mid-way), then rests on the new square.
  const state = await (await page.request.get(path)).json() as Snapshot
  const bandit = state.scenes[0].tokens[0]
  const tokenX = () => page.evaluate(id => {
    const b = (window as unknown as { beholderBoard: { tokenCenter: (id: string) => { x: number } | undefined } }).beholderBoard
    return b.tokenCenter(id)!.x
  }, bandit.id)
  const before = await tokenX()
  await command({ type: 'move', sceneId, tokenId: bandit.id, x: 6, y: 1 })
  await page.waitForFunction(([id, start]) => {
    const b = (window as unknown as { beholderBoard: { tokenCenter: (id: string) => { x: number } | undefined } }).beholderBoard
    return (b.tokenCenter(id as string)?.x ?? 0) > (start as number) + 48 * 5 - .5
  }, [bandit.id, before] as const)
  const after = await tokenX()
  assert.equal(Math.round(after), Math.round(before + 48 * 5), 'glide from ' + before + ' ended at ' + after)

  // An attack plays an effect inside the board (no DOM overlay any more).
  const wolf = state.scenes[0].tokens[1]
  await command({ type: 'move', sceneId, tokenId: wolf.id, x: 6, y: 2 })
  await command({ type: 'sheetRoll', sceneId, rollType: 'attack', actorId: state.scenes[0].tokens[0].actorId, targetId: wolf.actorId })
  await page.waitForFunction(() => (window as unknown as { beholderBoard: { effectLayer: { children: unknown[] } } }).beholderBoard.effectLayer.children.length > 0)
  assert.equal(await page.locator('.strike-bolt, .strike-slash').count(), 0)
  assert.deepEqual(errors, [])
})

test('0.09: two players see different parts of a walled map; the DM draws a wall, opens a door and watches as a player', { timeout: 90000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const dm = await seat(browser, { viewport: { width: 1280, height: 800 } })
  const mira = await seat(browser, { viewport: { width: 1280, height: 800 } })
  const bram = await seat(browser, { viewport: { width: 1280, height: 800 } })
  const room: Snapshot = await (await dm.request.post(base + '/api/rooms', { data: { name: 'Release 0.09 vision', member: 'DM' } })).json()
  const path = base + '/api/rooms/' + room.id
  const command = async (page: Page, body: Record<string, unknown>) => {
    const state = await (await page.request.get(path)).json() as Snapshot
    const response = await page.request.post(path + '/commands', { data: { ...body, commandId: randomUUID(), revision: state.revision } })
    assert.equal(response.status(), 200, await response.text())
    return (await page.request.get(path)).json() as Promise<Snapshot>
  }
  const sceneId = (await command(dm, { type: 'scene', name: 'Crypt', cell: 48, originX: 0, originY: 0 })).scenes[0].id
  // Two rooms split by a wall at x = 6 with a door between y = 3 and 4; Mira west, Bram east, a ghoul east.
  await command(dm, { type: 'walls', sceneId, add: [
    { a: { x: 6, y: 0 }, b: { x: 6, y: 3 } }, { a: { x: 6, y: 3 }, b: { x: 6, y: 4 }, door: true }, { a: { x: 6, y: 4 }, b: { x: 6, y: 9 } }] })
  await command(dm, { type: 'visionSettings', sceneId, enabled: true, ambient: 'day' })
  await command(dm, { type: 'place', sceneId, kind: 'monster', sheet: { ...blankSheet('monster'), name: 'Ghoul', hp: 9, maxHp: 9 }, x: 10, y: 3 })
  for (const [page, name, x] of [[mira, 'Mira', 2], [bram, 'Bram', 9]] as const) {
    assert.equal((await page.request.post(base + '/api/join', { data: { invite: room.invite, name, role: 'player' } })).status(), 200)
    const hero = (await command(page, { type: 'sheet', kind: 'pc', sheet: { ...blankSheet(), name: name + ' Hero' } })).actors.find(actor => actor.name === name + ' Hero')!
    await command(page, { type: 'place', sceneId, actorId: hero.id, role: 'character', x, y: 3 })
  }
  for (const page of [dm, mira, bram]) {
    await page.goto(base + '/room/' + room.id)
    await page.locator(boardCanvas + '[data-renderer=pixi]').waitFor()
  }
  const sees = async (page: Page) => ((await (await page.request.get(path)).json()) as Snapshot).scenes[0].tokens.length
  assert.equal(await sees(mira), 1, 'Mira sees only herself: the door is shut')
  assert.equal(await sees(bram), 2, 'Bram shares the east room with the ghoul')
  await mira.waitForTimeout(400)
  await mira.screenshot({ path: '.data/0.09-mira-door-shut.png' })

  // Mira walks to the door and clicks its handle: it opens, and she sees into the east room.
  const state = await (await mira.request.get(path)).json() as Snapshot
  const miraToken = state.scenes[0].tokens[0]
  await command(mira, { type: 'move', sceneId, tokenId: miraToken.id, x: 5, y: 3 })
  await mira.waitForTimeout(500)
  const frame = (await mira.locator(boardCanvas).boundingBox())!
  await mira.mouse.click(frame.x + 36 + 6 * 48, frame.y + 36 + 3.5 * 48)
  await waitInPage(mira, async url => (await (await fetch(url)).json()).scenes[0].tokens.length === 3, path)
  await mira.waitForTimeout(400)
  await mira.screenshot({ path: '.data/0.09-mira-door-open.png' })

  // The DM draws a wall with the tool (two clicks, then right-click to finish) and watches as Mira.
  await dm.getByRole('button', exact('เครื่องมือฉาก')).click()
  const tools = dm.getByRole('toolbar', { name: 'เครื่องมือฉาก' })
  await tools.getByRole('button', exact('ผนัง')).click()
  const board = (await dm.locator(boardCanvas).boundingBox())!
  await dm.mouse.click(board.x + 36 + 2 * 48, board.y + 36 + 6 * 48)
  await dm.mouse.click(board.x + 36 + 4 * 48, board.y + 36 + 6 * 48)
  await dm.mouse.click(board.x + 36 + 4 * 48, board.y + 36 + 6 * 48, { button: 'right' })
  await waitInPage(dm, async url => (await (await fetch(url)).json()).scenes[0].vision.walls.length === 4, path)
  const added = ((await (await dm.request.get(path)).json()) as Snapshot).scenes[0].vision!.walls!.at(-1)!
  assert.deepEqual([added.a, added.b], [{ x: 2, y: 6 }, { x: 4, y: 6 }])
  await tools.getByLabel('ดูจากมุมมองของ').selectOption({ label: 'มุมมองของ Mira' })
  await dm.waitForTimeout(400)
  await dm.screenshot({ path: '.data/0.09-dm-as-mira.png' })

  // Night: the ghoul's room goes dark for Mira unless light reaches it.
  await tools.getByLabel('แสงของฉาก').selectOption({ label: 'กลางคืน' })
  await waitInPage(mira, async url => (await (await fetch(url)).json()).scenes[0].tokens.length === 1, path)
})

test('0.10: dice tumble in 3D and land on the rolled faces; reduced motion keeps the flat die', { timeout: 60000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const page = await seat(browser, { viewport: { width: 1280, height: 800 } })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const room: Snapshot = await (await page.request.post(base + '/api/rooms', { data: { name: 'Release 0.10 dice', member: 'DM' } })).json()
  const path = base + '/api/rooms/' + room.id
  const command = async (body: Record<string, unknown>) => {
    const state = await (await page.request.get(path)).json() as Snapshot
    const response = await page.request.post(path + '/commands', { data: { ...body, commandId: randomUUID(), revision: state.revision } })
    assert.equal(response.status(), 200, await response.text())
  }
  await command({ type: 'scene', name: 'Tavern', cell: 48, originX: 0, originY: 0 })
  await page.goto(base + '/room/' + room.id)
  await page.locator(boardCanvas + '[data-renderer=pixi]').waitFor()

  // A 2d6+1d4 roll: three dice in the reveal, drawn by three.js (lazy-loaded), with no errors.
  await command({ type: 'roll', formula: '2d6+1d4' })
  const tray = page.locator('.dice-reveal-3d[data-dice="3"]')
  await tray.waitFor()
  await page.locator('.dice-reveal-3d[data-ready=true] canvas').waitFor()
  await page.waitForFunction(() => {
    const dice = (window as unknown as { beholderDice?: { renderer: { info: { render: { calls: number } } } } }).beholderDice
    return (dice?.renderer.info.render.calls ?? 0) > 0
  })
  // The board canvas is still the only one the board tests click.
  assert.equal(await page.locator(boardCanvas).count(), 1)

  // The renderer survives a lost WebGL context.
  await page.evaluate(async () => {
    const dice = (window as unknown as { beholderDice: { renderer: { forceContextLoss: () => void; forceContextRestore: () => void } } }).beholderDice
    dice.renderer.forceContextLoss()
    await new Promise(resolve => setTimeout(resolve, 200))
    dice.renderer.forceContextRestore()
  })
  await page.locator('.dice-reveal').waitFor({ state: 'detached', timeout: 5000 })
  await command({ type: 'roll', formula: '1d20' })
  await page.locator('.dice-reveal-3d[data-dice="1"]').waitFor()
  await page.locator('.dice-reveal').waitFor({ state: 'detached', timeout: 5000 })

  // Reduced motion: the flat die, no 3D tray.
  await openPanel(page, 'ตั้งค่าการแสดงผล')
  await page.getByRole('checkbox', { name: /^ลดแอนิเมชัน/ }).check()
  await command({ type: 'roll', formula: '1d8' })
  await page.locator('.dice-reveal-die').waitFor()
  assert.equal(await page.locator('.dice-reveal-3d').count(), 0)
  assert.deepEqual(errors.filter(message => !/WebGL context|CONTEXT_LOST/i.test(message)), [])
})

test('0.11: movement counts against Speed, drop on a foe to attack, one-click conditions, play keys and undo', { timeout: 90000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const dm = await seat(browser, { viewport: { width: 1280, height: 800 } })
  const mira = await seat(browser, { viewport: { width: 1280, height: 800 } })
  const room: Snapshot = await (await dm.request.post(base + '/api/rooms', { data: { name: 'Release 0.11 play', member: 'DM' } })).json()
  const path = base + '/api/rooms/' + room.id
  const state = async () => (await (await dm.request.get(path)).json()) as Snapshot
  const command = async (page: Page, body: Record<string, unknown>) => {
    const response = await page.request.post(path + '/commands', { data: { ...body, commandId: randomUUID(), revision: (await state()).revision } })
    assert.equal(response.status(), 200, await response.text())
  }
  await command(dm, { type: 'scene', name: 'Bridge', cell: 48, originX: 0, originY: 0 })
  const sceneId = (await state()).scenes[0].id
  await command(dm, { type: 'place', sceneId, kind: 'monster', sheet: { ...blankSheet('monster'), name: 'Bandit', hp: 11, maxHp: 11, ac: 1 }, x: 7, y: 2 })
  await command(dm, { type: 'place', sceneId, kind: 'monster', sheet: { ...blankSheet('monster'), name: 'Wolf', hp: 11, maxHp: 11, ac: 1 }, x: 9, y: 4 })
  assert.equal((await mira.request.post(base + '/api/join', { data: { invite: room.invite, name: 'Mira', role: 'player' } })).status(), 200)
  const sheetResponse = await mira.request.post(path + '/commands', { data: { type: 'sheet', kind: 'pc', sheet: { ...blankSheet(), name: 'Lyra', speed: 30 }, commandId: randomUUID(), revision: (await state()).revision } })
  assert.equal(sheetResponse.status(), 200)
  const lyra = (await state()).actors.find(actor => actor.name === 'Lyra')!
  await command(mira, { type: 'place', sceneId, actorId: lyra.id, role: 'character', x: 2, y: 2 })
  const bandit = (await state()).actors.find(actor => actor.name === 'Bandit')!
  const wolf = (await state()).actors.find(actor => actor.name === 'Wolf')!
  // Lyra acts first.
  await command(dm, { type: 'combat', sceneId, participants: [lyra.id, bandit.id, wolf.id] })
  const fight = (await state()).scenes[0].combat!
  const order = [lyra.id, ...fight.order.map(entry => entry.actorId).filter(id => id !== lyra.id)]
  await (async () => { for (const _ of order) { if ((await state()).scenes[0].combat!.order[(await state()).scenes[0].combat!.turn].actorId === lyra.id) break; await command(dm, { type: 'next', sceneId }) } })()
  await mira.goto(base + '/room/' + room.id)
  await dm.goto(base + '/room/' + room.id)
  await mira.locator(boardCanvas + '[data-renderer=pixi]').waitFor()
  const frame = (await mira.locator(boardCanvas).boundingBox())!
  const cellAt = (x: number, y: number) => ({ x: frame.x + 36 + (x + .5) * 48, y: frame.y + 36 + (y + .5) * 48 })

  // Drag Lyra three squares: the pill counts 15/30 ft while dragging, the token bar keeps the total.
  const from = cellAt(2, 2)
  await mira.mouse.move(from.x, from.y)
  await mira.mouse.down()
  const to = cellAt(5, 2)
  await mira.mouse.move(to.x, to.y, { steps: 6 })
  await mira.getByRole('status').filter({ hasText: 'เดิน 15/30 ฟุต' }).waitFor()
  await mira.mouse.up()
  await waitInPage(mira, async url => (await (await fetch(url)).json()).scenes[0].combat.moved?.feet === 15, path)
  await mira.mouse.click(to.x, to.y)
  await mira.getByText('เดินแล้ว 15/30 ฟุต').waitFor()

  // One click on the token bar puts Lyra Prone, another takes it off.
  await mira.getByRole('button', exact('สภาพ')).click()
  await mira.getByRole('group', { name: 'สภาพของ Lyra' }).getByRole('button', exact('Prone')).click()
  await waitInPage(mira, async url => (await (await fetch(url)).json()).actors.find((actor: { name: string }) => actor.name === 'Lyra').conditions === 'Prone', path)
  await mira.getByRole('group', { name: 'สภาพของ Lyra' }).getByRole('button', exact('Prone')).click()
  await waitInPage(mira, async url => (await (await fetch(url)).json()).actors.find((actor: { name: string }) => actor.name === 'Lyra').conditions === '', path)

  // Drop Lyra on the Bandit: an attack roll, and she stays where she was.
  const bandit2 = cellAt(7, 2)
  await mira.mouse.move(to.x, to.y)
  await mira.mouse.down()
  await mira.mouse.move(bandit2.x, bandit2.y, { steps: 6 })
  await mira.mouse.up()
  await waitInPage(mira, async ([url, id]) => (await (await fetch(url as string)).json()).rolls.some((roll: { targetId?: string }) => roll.targetId === id), [path, bandit.id] as const)
  assert.equal((await state()).scenes[0].tokens.find(token => token.actorId === lyra.id)!.x, 5)

  // Tab picks the next foe, 1 attacks it with the main attack, Enter ends the turn.
  await mira.locator(boardCanvas).focus()
  await mira.keyboard.press('Tab')
  await mira.getByText(/เป้าหมาย: (Bandit|Wolf)/).first().waitFor()
  const rolls = (await state()).rolls.length
  await mira.keyboard.press('1')
  await waitInPage(mira, async ([url, count]) => (await (await fetch(url as string)).json()).rolls.length > (count as number), [path, rolls] as const)
  await mira.keyboard.press('Enter')
  await waitInPage(mira, async ([url, id]) => { const s = await (await fetch(url as string)).json(); return s.scenes[0].combat.order[s.scenes[0].combat.turn].actorId !== id }, [path, lyra.id] as const)

  // Since 0.12 each person undoes their own steps: the DM moves the Wolf, then takes it back with Ctrl+Z.
  await command(dm, { type: 'move', sceneId, tokenId: (await state()).scenes[0].tokens.find(token => token.actorId === wolf.id)!.id, x: 9, y: 7 })
  await dm.locator(boardCanvas).click({ position: { x: 600, y: 600 } })
  await dm.keyboard.press('Control+z')
  await waitInPage(dm, async ([url, id]) => (await (await fetch(url as string)).json()).scenes[0].tokens.find((token: { actorId: string }) => token.actorId === id).y === 4, [path, wolf.id] as const)
})

test('0.12: the board still draws, selects and moves on Pixi\'s canvas fallback (no WebGL)', { timeout: 60000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const page = await seat(browser, { viewport: { width: 1280, height: 800 } })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const room: Snapshot = await (await page.request.post(base + '/api/rooms', { data: { name: 'Release 0.12 canvas', member: 'DM' } })).json()
  const path = base + '/api/rooms/' + room.id
  const command = async (body: Record<string, unknown>) => {
    const state = await (await page.request.get(path)).json() as Snapshot
    const response = await page.request.post(path + '/commands', { data: { ...body, commandId: randomUUID(), revision: state.revision } })
    assert.equal(response.status(), 200, await response.text())
  }
  await command({ type: 'scene', name: 'Cellar', cell: 48, originX: 0, originY: 0 })
  const sceneId = ((await (await page.request.get(path)).json()) as Snapshot).scenes[0].id
  await command({ type: 'place', sceneId, kind: 'monster', sheet: { ...blankSheet('monster'), name: 'Rat', hp: 5, maxHp: 5 }, x: 2, y: 2 })
  await page.goto(base + '/room/' + room.id + '?renderer=canvas')
  await page.locator(boardCanvas + '[data-renderer=pixi]').waitFor()
  assert.equal(await page.evaluate(() => (window as unknown as { beholderBoard: { app: { renderer: { name: string } } } }).beholderBoard.app.renderer.name), 'canvas')
  const frame = (await page.locator(boardCanvas).boundingBox())!
  const cellAt = (x: number, y: number) => ({ x: frame.x + 36 + (x + .5) * 48, y: frame.y + 36 + (y + .5) * 48 })
  const rat = cellAt(2, 2)
  await page.mouse.click(rat.x, rat.y)
  await page.getByRole('toolbar', { name: /คำสั่งของ Rat/ }).waitFor()
  await page.mouse.move(rat.x, rat.y)
  await page.mouse.down()
  const to = cellAt(5, 3)
  await page.mouse.move(to.x, to.y, { steps: 6 })
  await page.mouse.up()
  await waitInPage(page, async url => { const s = await (await fetch(url)).json(); return s.scenes[0].tokens[0].x === 5 && s.scenes[0].tokens[0].y === 3 }, path)
  // Something was actually painted: the canvas is not one flat colour.
  const varied = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.board-canvas')!
    const copy = document.createElement('canvas')
    copy.width = 200; copy.height = 200
    const ctx = copy.getContext('2d')!
    ctx.drawImage(canvas, 0, 0, 200, 200)
    const data = ctx.getImageData(0, 0, 200, 200).data
    const seen = new Set<number>()
    for (let i = 0; i < data.length; i += 16) seen.add(data[i] << 16 | data[i + 1] << 8 | data[i + 2])
    return seen.size
  })
  assert.ok(varied > 5, 'the canvas shows grid and token, not a blank fill (' + varied + ' colours)')
  assert.deepEqual(errors, [])
})

test('0.12: action chips, an Opportunity Attack card, Difficult Terrain, a whisper, a torch and a player undo', { timeout: 90000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const dm = await seat(browser, { viewport: { width: 1280, height: 800 } })
  const mira = await seat(browser, { viewport: { width: 1280, height: 800 } })
  const room: Snapshot = await (await dm.request.post(base + '/api/rooms', { data: { name: 'Release 0.12 turns', member: 'DM' } })).json()
  const path = base + '/api/rooms/' + room.id
  const state = async () => (await (await dm.request.get(path)).json()) as Snapshot
  const command = async (page: Page, body: Record<string, unknown>) => {
    const response = await page.request.post(path + '/commands', { data: { ...body, commandId: randomUUID(), revision: (await state()).revision } })
    assert.equal(response.status(), 200, await response.text())
  }
  await command(dm, { type: 'scene', name: 'Ford', cell: 48, originX: 0, originY: 0 })
  const sceneId = (await state()).scenes[0].id
  await command(dm, { type: 'place', sceneId, kind: 'monster', sheet: { ...blankSheet('monster'), name: 'Ogre', hp: 50, maxHp: 50, attack: 0, damage: '1d4',
    monsterReference: { statBlock: 'Multiattack. The ogre makes two attacks.\nGreatclub. Melee Attack Roll: +6, reach 5 ft.' } }, x: 4, y: 2 })
  assert.equal((await mira.request.post(base + '/api/join', { data: { invite: room.invite, name: 'Mira', role: 'player' } })).status(), 200)
  const made = await mira.request.post(path + '/commands', { data: { type: 'sheet', kind: 'pc', commandId: randomUUID(), revision: (await state()).revision,
    sheet: { ...blankSheet(), name: 'Lyra', speed: 30, hp: 30, maxHp: 30, inventory: [{ name: 'Torch', description: '', ref: 'srd-5.2.1:equipment:torch' }] } } })
  assert.equal(made.status(), 200)
  const lyra = (await state()).actors.find(actor => actor.name === 'Lyra')!
  const ogre = (await state()).actors.find(actor => actor.name === 'Ogre')!
  await command(mira, { type: 'place', sceneId, actorId: lyra.id, role: 'character', x: 3, y: 2 })
  await command(dm, { type: 'terrain', sceneId, cells: ['2,2', '1,2'], mode: 'difficult' })
  await command(dm, { type: 'combat', sceneId, participants: [lyra.id, ogre.id] })
  for (let i = 0; i < 2 && (await state()).scenes[0].combat!.order[(await state()).scenes[0].combat!.turn].actorId !== lyra.id; i++) await command(dm, { type: 'next', sceneId })
  await dm.goto(base + '/room/' + room.id)
  await mira.goto(base + '/room/' + room.id)
  await mira.locator(boardCanvas + '[data-renderer=pixi]').waitFor()
  const frame = (await mira.locator(boardCanvas).boundingBox())!
  const cellAt = (x: number, y: number) => ({ x: frame.x + 36 + (x + .5) * 48, y: frame.y + 36 + (y + .5) * 48 })

  // Lyra's chips are on her turn banner.
  const chips = mira.getByRole('group', { name: 'การกระทำของ Lyra' }).first()
  await chips.getByRole('button', { name: /^Action 0\/1/ }).waitFor()
  await chips.getByRole('button', exact('Bonus 0/1')).click()
  await waitInPage(mira, async ([url, id]) => (await (await fetch(url as string)).json()).scenes[0].combat.uses?.[id as string]?.bonus === 1, [path, lyra.id] as const)

  // Lyra walks away from the Ogre through Difficult Terrain: 2 rough squares = 20 ft, and the DM gets a card.
  const start = cellAt(3, 2)
  await mira.mouse.move(start.x, start.y)
  await mira.mouse.down()
  const end = cellAt(1, 2)
  await mira.mouse.move(end.x, end.y, { steps: 6 })
  await mira.getByRole('status').filter({ hasText: 'เดิน 20/30 ฟุต' }).waitFor()
  await mira.mouse.up()
  const card = dm.getByRole('alertdialog', { name: 'Opportunity Attack ของ Ogre' })
  await card.waitFor()
  await card.getByRole('button', exact('ผ่าน')).click()
  await card.waitFor({ state: 'detached' })

  // Mira takes her move back with Ctrl+Z (the Bonus Action mark was hers too, but the move is newest).
  await mira.locator(boardCanvas).focus()
  await mira.keyboard.press('Control+z')
  await waitInPage(mira, async ([url, id]) => (await (await fetch(url as string)).json()).scenes[0].tokens.find((token: { actorId: string }) => token.actorId === id).x === 3, [path, lyra.id] as const)
  await mira.getByText(/ย้อนการเดินแล้ว/).first().waitFor()

  // She lights her torch from the bag, and whispers to the DM.
  await openPanel(mira, 'ชีตในห้อง')
  await mira.getByRole('button', exact('Lyra')).click()
  const sheet = mira.getByRole('article', { name: 'ชีต Lyra' })
  await sheet.getByRole('tab', exact('Inventory')).click()
  await sheet.getByRole('button', exact('จุด')).click()
  await waitInPage(mira, async ([url, id]) => (await (await fetch(url as string)).json()).actors.find((actor: { id: string }) => actor.id === id).inventory[0].lit === true, [path, lyra.id] as const)
  await openPanel(mira, 'บันทึกการผจญภัย')
  await mira.getByLabel('ข้อความถึงโต๊ะ').fill('/w DM ฉันแอบหยิบกุญแจ')
  await mira.getByRole('button', exact('ส่ง')).click()
  await openPanel(dm, 'บันทึกการผจญภัย')
  await dm.getByText('ฉันแอบหยิบกุญแจ').waitFor()
})

/** From the lobby, open a new table as DM. With tables already on the shelf the form sits behind "เขียนเรื่องใหม่". */
test('0.13: a wizard turns old spell notes into SRD spells, adds one from the catalog, casts Fireball on the board and heals', { timeout: 90000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const dm = await seat(browser, { viewport: { width: 1280, height: 800 } })
  const mira = await seat(browser, { viewport: { width: 1280, height: 800 } })
  const room: Snapshot = await (await dm.request.post(base + '/api/rooms', { data: { name: 'Release 0.13 spells', member: 'DM' } })).json()
  const path = base + '/api/rooms/' + room.id
  const state = async () => (await (await dm.request.get(path)).json()) as Snapshot
  const command = async (page: Page, body: Record<string, unknown>) => {
    const response = await page.request.post(path + '/commands', { data: { ...body, commandId: randomUUID(), revision: (await state()).revision } })
    assert.equal(response.status(), 200, await response.text())
  }
  await command(dm, { type: 'scene', name: 'Crypt', cell: 48, originX: 0, originY: 0 })
  const sceneId = (await state()).scenes[0].id
  await command(dm, { type: 'place', sceneId, kind: 'monster', sheet: { ...blankSheet('monster'), name: 'Ghoul A', hp: 30, maxHp: 30 }, x: 6, y: 2 })
  await command(dm, { type: 'place', sceneId, kind: 'monster', sheet: { ...blankSheet('monster'), name: 'Ghoul B', hp: 30, maxHp: 30 }, x: 7, y: 3 })
  assert.equal((await mira.request.post(base + '/api/join', { data: { invite: room.invite, name: 'Mira', role: 'player' } })).status(), 200)
  await command(mira, { type: 'sheet', kind: 'pc', sheet: { ...blankSheet(), name: 'Lyra', classLevel: 'Wizard 5', hp: 5, maxHp: 30, spellDC: 15, spellAttack: 7,
    slots: 'L1 4/4, L2 3/3, L3 2/2', spells: 'Cantrips: Fire Bolt. Prepared: Fireball, Cure Wounds' } })
  const lyra = (await state()).actors.find(actor => actor.name === 'Lyra')!
  await command(mira, { type: 'place', sceneId, actorId: lyra.id, role: 'character', x: 0, y: 2 })
  await mira.goto(base + '/room/' + room.id)
  await openPanel(mira, 'ชีตในห้อง')
  await mira.getByRole('button', exact('Lyra')).click()
  const sheet = mira.getByRole('article', { name: 'ชีต Lyra' })
  await sheet.getByRole('tab', exact('Spells')).click()

  // The old free text becomes catalog spells; one more comes from the SRD catalog, filtered to Wizard spells.
  await sheet.getByRole('button', exact('แปลงจากข้อความเดิม')).click()
  await sheet.getByRole('button', exact('ร่าย Fireball')).waitFor()
  await sheet.getByRole('button', exact('เพิ่มเวท')).click()
  const picker = sheet.getByRole('region', exact('คลังเวท SRD'))
  await picker.getByText('เฉพาะเวทของ Wizard').waitFor()
  await picker.getByLabel('ค้นหาเวท').fill('Shield')
  await picker.getByRole('button', exact('ดูเวท Shield')).click()
  await picker.getByRole('button', exact('เพิ่มเวทลงชีต')).click()
  await sheet.getByRole('button', exact('ร่าย Shield')).waitFor()
  await picker.getByRole('button', exact('ปิดคลังเวท')).click()
  assert.deepEqual((await state()).actors.find(actor => actor.id === lyra.id)!.spellbook!.map(entry => entry.id.split(':').pop()).sort(),
    ['cure-wounds', 'fire-bolt', 'fireball', 'shield'])

  // Fireball: place the 20-ft sphere on the board; both ghouls are asked for a DEX save against 8d6, one level 3 slot gone.
  await sheet.getByRole('button', exact('ร่าย Fireball')).click()
  await sheet.getByRole('button', exact('วางพื้นที่บนกระดาน')).click()
  await mira.getByText(/ลากเพื่อวาง Fireball/).waitFor()
  const frame = (await mira.locator(boardCanvas).boundingBox())!
  const cellAt = (x: number, y: number) => ({ x: frame.x + 36 + x * 48, y: frame.y + 36 + y * 48 })
  const from = cellAt(7, 3)
  const to = cellAt(8, 3)
  await mira.mouse.move(from.x, from.y)
  await mira.mouse.down()
  await mira.mouse.move(to.x, to.y, { steps: 5 })
  await mira.mouse.up()
  await waitInPage(mira, async url => (await (await fetch(url)).json()).rolls.filter((roll: { cast?: unknown }) => roll.cast).length === 2, path)
  const after = await state()
  assert.deepEqual(after.rolls.filter(roll => roll.cast).map(roll => [roll.cast!.ability, roll.cast!.dc, roll.cast!.damage]), [['DEX', 15, '8d6'], ['DEX', 15, '8d6']])
  assert.match(after.actors.find(actor => actor.id === lyra.id)!.slots, /L3 1\/2/)

  // Cure Wounds on herself heals at once.
  await sheet.getByRole('button', exact('ร่าย Cure Wounds')).click()
  await sheet.getByRole('button', { name: /^ร่าย Cure Wounds · ช่องระดับ 1/ }).click()
  await waitInPage(mira, async arg => ((await (await fetch(arg.path)).json()).actors.find((actor: { id: string; hp: number }) => actor.id === arg.id)?.hp ?? 0) > 5, { path, id: lyra.id })
  assert.ok((await state()).log!.some(entry => /Lyra ฟื้น \d+ HP จาก Cure Wounds/.test(entry.text)))
})

async function startTable(page: Page, name: string) {
  const field = page.getByLabel('ชื่อห้อง')
  const write = page.getByRole('button', exact('เขียนเรื่องใหม่'))
  await field.or(write).first().waitFor()
  if (!await field.isVisible()) await write.click()
  await field.fill(name)
  await page.getByRole('button', exact('สร้างห้อง DM')).click()
}

/** Open a panel from the HUD rail. On narrow screens the rail is folded behind the menu button. */
async function openPanel(page: Page, name: string) {
  const menu = page.getByRole('button', exact('เมนูโต๊ะ'))
  if (await menu.getAttribute('aria-expanded') === 'false') await menu.click()
  const tab = page.getByRole('navigation', { name: 'ระบบในห้อง' }).getByRole('button', exact(name))
  if (await tab.getAttribute('aria-pressed') === 'false') await tab.click()
}

test('a player places an owned main and a library companion, then drives the main with arrow keys', { timeout: 45000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER
    ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const dm = await seat(browser)
  const player = await seat(browser, { viewport: { width: 1280, height: 850 } })
  const opened = await dm.request.post(base + '/api/rooms', { data: { name: 'Arrow verification', member: 'DM' } })
  assert.equal(opened.status(), 201)
  const initial: Snapshot = await opened.json()
  const path = base + '/api/rooms/' + initial.id
  const sceneResult = await dm.request.post(path + '/commands', { data: {
    type: 'scene', name: 'Clearing', cell: 48, originX: 0, originY: 0, commandId: randomUUID(), revision: initial.revision
  } })
  assert.equal(sceneResult.status(), 200)
  await player.goto(base)
  const registered = await player.request.post(base + '/api/account/session', { data: {
    email: randomUUID() + '@example.com', name: 'Player', password: 'arrow-test-password', mode: 'register'
  } })
  assert.equal(registered.status(), 201)
  const sheet = { ...blankSheet(), name: 'Hawk' }
  assert.equal((await player.request.put(base + '/api/library/sheets/' + randomUUID(), { data: sheet })).status(), 200)
  await player.goto(base + '/?invite=' + initial.invite + '&room=' + initial.id)
  await player.getByRole('button', exact('เข้าร่วม')).click()
  await player.getByRole('heading', exact('Clearing')).waitFor()
  const state = async (): Promise<Snapshot> => (await player.request.get(path)).json()
  const joined = await state()
  assert.equal((await player.request.post(path + '/commands', { data: {
    type: 'sheet', sheet: { ...blankSheet(), name: 'Warden' }, revision: joined.revision, commandId: randomUUID()
  } })).status(), 200)
  await player.reload()
  await openPanel(player, 'ชีตในห้อง')
  // The first character a player places is their main token; the next one is a companion, no dialog needed.
  await player.getByRole('button', exact('วาง Warden')).click()
  const board = player.locator(boardCanvas)
  await board.click({ position: { x: 155, y: 120 } })
  await player.getByRole('button', { name: /↑ ↓ ← → Warden/ }).waitFor()
  await openPanel(player, 'คลังส่วนตัว')
  await player.getByRole('button', exact('วาง Token')).click()
  await board.click({ position: { x: 270, y: 120 } })
  await player.getByText('คลิกช่องเพื่อวาง Token', { exact: true }).waitFor({ state: 'hidden' })
  const before = (await state()).scenes[0].tokens
  assert.deepEqual(before.map(token => token.role), ['character', 'companion'])

  // Selecting a token shows its commands without a right-click; clicking empty map clears it.
  await board.click({ position: { x: 155, y: 120 } })
  const wardenBar = player.getByRole('toolbar', { name: 'คำสั่งของ Warden' })
  await wardenBar.getByRole('button', exact('เปิดชีต')).waitFor()
  await board.click({ position: { x: 640, y: 520 } })
  await wardenBar.waitFor({ state: 'hidden' })

  await board.click({ position: { x: 260, y: 110 } })
  const step = player.waitForResponse(response => response.url() === path + '/commands' && response.request().postDataJSON()?.type === 'stepCharacter')
  await player.keyboard.press('ArrowRight')
  assert.equal((await step).status(), 200)
  const after = (await state()).scenes[0].tokens
  assert.equal(after[0].x, before[0].x + 1)
  assert.deepEqual(after[1], before[1])

  // Dragging empty map pans the board: the main token is found where the view moved it.
  const frame = (await board.boundingBox())!
  await player.mouse.move(frame.x + 640, frame.y + 520)
  await player.mouse.down()
  await player.mouse.move(frame.x + 736, frame.y + 568, { steps: 6 })
  await player.mouse.up()
  await board.click({ position: { x: 36 + (after[0].x + .5) * 48 + 96, y: 36 + (after[0].y + .5) * 48 + 48 } })
  await wardenBar.waitFor()
})

async function createScene(page: Page, name: string) {
  await page.getByRole('button', exact('สร้างฉาก')).first().click()
  await page.getByLabel('ชื่อฉาก').fill(name)
  await page.getByRole('button', exact('บันทึกฉาก')).click()
  // The list updates a moment before the dialog closes; wait for both.
  await page.getByRole('button', exact('บันทึกฉาก')).waitFor({ state: 'detached' })
  await page.locator('.scene-item').filter({ hasText: name }).waitFor()
}

async function createSheet(page: Page, name: string, monster = false, picture = false) {
  await page.getByRole('button', exact(monster ? '+ ต้นแบบ' : '+ ตัวละคร')).click()
  if (!monster) await page.getByRole('button', exact('กรอกชีตเองแบบเต็ม')).click()
  await page.locator('.dialog').getByLabel('ชื่อ', { exact: true }).fill(name)
  await page.getByLabel('Attack bonus').fill('50')
  await page.getByLabel('สูตร Damage', { exact: true }).fill('1d4')
  if (monster) {
    await page.getByText('Inventory และ Loot (0)', { exact: true }).click()
    await page.getByRole('button', exact('+ ไอเทม')).click()
    await page.getByLabel('ชื่อไอเทม').fill('Copper token')
  } else {
    await page.getByLabel('HP สูงสุด', { exact: true }).fill('20')
    await page.getByLabel('HP ปัจจุบัน', { exact: true }).fill('20')
  }
  if (picture) {
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 24
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#bd5331'
      ctx.fillRect(0, 0, 24, 24)
      return canvas.toDataURL().split(',')[1]
    })
    await page.getByLabel('รูปตัวละครบน Token').setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    await page.getByRole('img', exact('รูปตัวละครบน Token')).waitFor()
  }
  await page.getByRole('button', exact('บันทึกชีต')).click()
  await page.locator('.dialog').waitFor({ state: 'hidden' })
}

test('three browser seats can place tokens, roll, take a turn and switch scenes', { timeout: 60000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER
    ? { executablePath: process.env.BEHOLDER_BROWSER }
    : { channel: 'msedge' })
  t.after(() => browser.close())
  const dm = await seat(browser, { viewport: { width: 1440, height: 950 } })
  dm.setDefaultTimeout(10000)
  await dm.goto(base)
  await dm.getByLabel('ชื่อห้อง').fill('Beholder browser verification')
  await dm.getByLabel('ชื่อที่ใช้บนโต๊ะ').fill('DM')
  await dm.getByRole('button', exact('สร้างห้อง DM')).click()
  await openPanel(dm, 'ฉากและแผนที่')
  await dm.getByText('เชิญผู้เล่น', { exact: true }).click()
  const invite = await dm.getByLabel('ลิงก์เชิญ').inputValue()
  const one = await seat(browser)
  const two = await seat(browser)
  one.setDefaultTimeout(10000)
  two.setDefaultTimeout(10000)
  for (const [page, name] of [[one, 'Scout player'], [two, 'Mage player']] as const) {
    await page.goto(invite)
    await page.getByLabel('ชื่อที่ใช้บนโต๊ะ').fill(name)
    await page.getByText('คุณจะเข้าร่วมในฐานะผู้เล่น', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('บทบาท').count(), 0, 'a player invite no longer offers a DM role that would fail')
    await page.getByRole('button', exact('เข้าร่วม')).click()
    await page.getByRole('heading', exact('กระดาน')).waitFor()
  }
  await createScene(dm, 'Gate')
  await createScene(dm, 'Vault')
  await one.getByRole('heading', exact('Gate')).waitFor()
  assert.equal(await one.locator('#table-drawer').isVisible(), false, 'no panel covers the map when a player arrives')
  // Since 0.07 players may place Manual monsters too (as temp tokens); saving templates stays with the DM.
  assert.equal(await one.getByRole('navigation', { name: 'ระบบในห้อง' }).getByRole('button', exact('Monster Manual')).count(), 1)
  await one.keyboard.press('Control+k')
  await one.getByRole('combobox', exact('ค้นหาคำสั่ง')).fill('ลูกเต๋า')
  await one.keyboard.press('Enter')
  await one.getByRole('region', exact('ลูกเต๋า')).waitFor()
  await one.keyboard.press('Escape')
  await one.locator('#table-drawer').waitFor({ state: 'hidden' })
  const playerBoard = await one.locator(boardCanvas).boundingBox()
  assert.equal(playerBoard?.width, one.viewportSize()?.width)
  assert.equal(playerBoard?.height, one.viewportSize()!.height - 58)
  await openPanel(two, 'ฉากและแผนที่')
  assert.equal(await two.locator('.scene-item').count(), 1)
  const upload = dm.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/map'))
  await dm.locator('input[type=file]').setInputFiles({
    name: 'test-map.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=', 'base64')
  })
  assert.equal((await upload).status(), 204)
  await openPanel(one, 'ชีตในห้อง')
  await openPanel(two, 'ชีตในห้อง')
  await openPanel(dm, 'ชีตในห้อง')
  await createSheet(one, 'Scout', false, true)
  await createSheet(two, 'Mage')
  await createSheet(dm, 'Rat', true)
  const canvas = dm.locator(boardCanvas)
  await openPanel(dm, 'ชีตในห้อง')
  await dm.getByRole('button', exact('วาง Scout')).click()
  await canvas.click({ position: { x: 165, y: 115 } })
  await dm.getByText('คลิกช่องเพื่อวาง Token', { exact: true }).waitFor({ state: 'hidden' })
  // A sheet card can also be dragged straight onto a cell.
  await openPanel(dm, 'ชีตในห้อง')
  const placedMage = dm.waitForResponse(response => response.url().endsWith('/commands') && response.request().postDataJSON()?.type === 'place')
  await dm.locator('.actor-item').filter({ hasText: 'Mage' }).dragTo(canvas, { targetPosition: { x: 210, y: 115 } })
  assert.equal((await placedMage).status(), 200)
  await dm.keyboard.press('Escape')
  await canvas.click({ position: { x: 260, y: 115 }, button: 'right' })
  await dm.getByRole('button', exact('วาง Token ที่นี่')).click()
  await dm.locator('.actor-item').filter({ hasText: 'Rat' }).getByRole('button', exact('วาง')).click()
  await dm.locator('#table-drawer').waitFor({ state: 'hidden' })
  await canvas.click({ position: { x: 260, y: 115 }, button: 'right' })
  await dm.getByRole('button', exact('ปรับ HP')).click()
  await dm.getByLabel('จำนวน').fill('-3')
  await dm.getByRole('button', exact('ยืนยันการปรับ HP')).click()
  await dm.locator('.scrim').waitFor({ state: 'hidden' })
  await canvas.click({ position: { x: 260, y: 115 }, button: 'right' })
  await dm.getByRole('button', exact('เปิดชีต')).click()
  await dm.getByText('7/10', { exact: true }).waitFor()
  await one.keyboard.press('Escape')
  await one.locator(boardCanvas).click({ position: { x: 165, y: 115 }, button: 'right' })
  assert.equal(await one.getByRole('button', exact('ปรับ HP')).count(), 0)
  await one.getByRole('button', exact('เปิดชีต')).click()
  await one.getByRole('button', exact('STR check')).click()
  await openPanel(two, 'ลูกเต๋า')
  await two.locator('.rolls').getByText(/STR check · Scout/).waitFor()
  await dm.getByRole('complementary', { name: 'ถาดผลเต๋า' }).getByText(/STR check · Scout/).waitFor()
  await dm.keyboard.press('Escape')
  await dm.getByRole('button', exact('ปิดถาดผลเต๋าของฉัน')).click()
  assert.equal(await dm.getByRole('complementary', { name: 'ถาดผลเต๋า' }).count(), 0)
  assert.equal(await two.getByRole('complementary', { name: 'ถาดผลเต๋า' }).count(), 1)
  const board = (await canvas.boundingBox())!
  async function drag(x: number, y: number, targetX: number, targetY: number) {
    await dm.mouse.move(board.x + x, board.y + y)
    await dm.mouse.down()
    await dm.mouse.move(board.x + targetX, board.y + targetY, { steps: 4 })
    await dm.mouse.up()
  }
  // Shift+drag draws a selection box (a plain drag on empty map pans).
  await dm.keyboard.down('Shift')
  await drag(120, 76, 227, 134)
  await dm.keyboard.up('Shift')
  await dm.getByText('เลือก 2 Token', { exact: true }).waitFor()
  const move = dm.waitForResponse(response => response.url().endsWith('/commands') && response.request().postDataJSON()?.type === 'moveTokens')
  await drag(156, 108, 156, 156)
  assert.equal((await move).status(), 200)
  const state = await (await dm.request.get(base + '/api/rooms/' + roomIdOf(dm.url()))).json()
  assert.deepEqual(state.scenes[0].tokens.slice(0, 2).map((token: { y: number }) => token.y), [2, 2])
  assert.match(state.actors.find((actor: { name: string }) => actor.name === 'Scout').portrait, /^data:image\//)
  await canvas.click({ position: { x: 163, y: 203 }, button: 'right' })
  await dm.getByRole('button', exact('นำเข้า Object ที่นี่')).click()
  await dm.getByRole('dialog', { name: 'นำเข้า Object' }).getByRole('combobox', { name: /^ประเภท/ }).selectOption('item')
  await dm.getByRole('combobox', { name: /^ภาพสำหรับวางบนแผนที่/ }).selectOption('/art/srd/objects/longsword.webp')
  await dm.getByRole('img', { name: 'รูป Object' }).waitFor()
  await dm.getByLabel('ชื่อ Object').fill('Silver key')
  await dm.getByRole('button', exact('วาง Object')).click()
  await dm.getByRole('dialog', { name: 'นำเข้า Object' }).waitFor({ state: 'hidden' })
  await one.keyboard.press('Escape')
  await one.locator(boardCanvas).click({ position: { x: 163, y: 203 }, button: 'right' })
  await one.getByRole('button', exact('โต้ตอบกับ Object')).click()
  await one.getByRole('button', exact('เก็บเข้า Inventory')).click()
  await one.getByRole('dialog', { name: 'Silver key' }).waitFor({ state: 'hidden' })
  await openPanel(one, 'ชีตในห้อง')
  await one.getByRole('button', exact('Scout')).click()
  await one.getByRole('tab', exact('Inventory')).click()
  await one.getByText('Inventory (1)', { exact: true }).waitFor()
  await one.getByText('Silver key', { exact: true }).waitFor()
  await one.getByRole('button', exact('+ ไอเทม')).click()
  await one.getByLabel('ชื่อไอเทม').fill('Lockpick set')
  await one.locator('.inventory-form').getByRole('combobox').selectOption('thievesTools')
  await one.getByRole('button', exact('เก็บใน Inventory')).click()
  await one.getByText('Inventory (2)', { exact: true }).waitFor()
  await canvas.click({ position: { x: 163, y: 203 }, button: 'right' })
  await dm.getByRole('button', exact('นำเข้า Object ที่นี่')).click()
  await dm.getByRole('dialog', { name: 'นำเข้า Object' }).getByRole('combobox', { name: /^ประเภท/ }).selectOption('container')
  await dm.getByLabel('ชื่อ Object').fill('Locked cache')
  await dm.getByLabel(/ของเริ่มต้นในกล่อง/).fill('Letter')
  await dm.getByLabel('ล็อกกล่อง', { exact: true }).check()
  await dm.getByLabel('DC สะเดาะล็อก').fill('1')
  await dm.getByRole('button', exact('วาง Object')).click()
  await dm.getByRole('dialog', { name: 'นำเข้า Object' }).waitFor({ state: 'hidden' })
  await one.keyboard.press('Escape')
  await one.locator(boardCanvas).click({ position: { x: 163, y: 203 }, button: 'right' })
  await one.getByRole('button', exact('โต้ตอบกับ Object')).click()
  await one.getByRole('button', exact('ทอยสะเดาะล็อก')).click()
  await one.getByText(/สะเดาะสำเร็จ · ผลทอย/).waitFor()
  await one.getByText('Letter', { exact: true }).waitFor()
  await one.getByRole('dialog', { name: 'Locked cache' }).getByRole('button', exact('ปิด')).click()
  await openPanel(dm, 'การต่อสู้')
  const combat = dm.getByRole('complementary', { name: 'แผงต่อสู้ DM' })
  await combat.getByRole('button', exact('ทอย Initiative')).click()
  await two.locator('.board-status').getByText(/รอบ 1 · /).waitFor()
  const playerRail = one.getByRole('complementary', { name: 'Turn Initiative' })
  await playerRail.getByRole('heading', exact('Turn Initiative')).waitFor()
  assert.match(await playerRail.getByRole('button', exact('ไปที่ Token Scout')).locator('img').getAttribute('src') ?? '', /^data:image\//)
  await playerRail.getByRole('button', exact('ไปที่ Token Rat 1')).getByText('RA', { exact: true }).waitFor()
  await playerRail.locator('[aria-current=step]').waitFor()
  await playerRail.getByRole('button', exact('ไปที่ Token Scout')).click()
  // Focus centres the board on Scout: the token's centre sits at the middle of the canvas (the view is on data attributes).
  await waitInPage(one, async url => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.board-canvas')!
    const [x, y] = canvas.dataset.camera!.split(',').map(Number)
    const zoom = Number(canvas.dataset.zoom)
    const room = await (await fetch(url)).json()
    const scene = room.scenes[0]
    const scout = room.actors.find((actor: { name: string }) => actor.name === 'Scout')
    const token = scene.tokens.find((item: { actorId: string }) => item.actorId === scout.id)
    const rect = canvas.getBoundingClientRect()
    const cx = x + (scene.originX + (token.x + .5) * scene.cell) * zoom
    const cy = y + (scene.originY + (token.y + .5) * scene.cell) * zoom
    return Math.abs(cx - rect.width / 2) < 2 && Math.abs(cy - rect.height / 2) < 2
  }, base + '/api/rooms/' + roomIdOf(one.url()))
  const roomUrl = base + '/api/rooms/' + roomIdOf(dm.url())
  const fight = await (await dm.request.get(roomUrl)).json()
  const acting = fight.scenes[0].combat.order[0].actorId
  const target = fight.scenes[0].tokens.find((token: { actorId: string }) => token.actorId !== acting)
  const targetHP = fight.actors.find((actor: { id: string }) => actor.id === target.actorId).hp
  await canvas.click({ position: { x: 36 + (target.x + .5) * 48, y: 36 + (target.y + .5) * 48 } })
  assert.equal(await combat.getByRole('combobox').first().inputValue(), target.actorId)
  await combat.getByRole('combobox').nth(2).selectOption('advantage')
  for (let attempt = 0; attempt < 4; attempt++) {
    const rolled = dm.waitForResponse(response => response.url().endsWith('/commands') && response.request().postDataJSON()?.rollType === 'attack')
    await combat.getByRole('button', { name: /^โจมตี · / }).click()
    const response = await rolled
    assert.equal(response.status(), 200)
    if ((await response.json()).rollId) break
    await combat.getByRole('button', { name: /^โจมตี · / }).waitFor()
  }
  await dm.getByRole('region', { name: 'ผลรอจัดการ' }).getByLabel('ประเภทความเสียหาย').selectOption('fire')
  await dm.getByRole('region', { name: 'ผลรอจัดการ' }).getByRole('button', exact('หัก HP')).click()
  await two.locator('.floating-damage[aria-label$="ไฟ"]').waitFor({ state: 'attached' })
  await dm.getByRole('region', { name: 'ผลรอจัดการ' }).waitFor({ state: 'hidden' })
  const updated = await (await dm.request.get(roomUrl)).json()
  assert.ok(updated.actors.find((actor: { id: string }) => actor.id === target.actorId).hp < targetHP)
  await combat.getByRole('button', exact('เทิร์นถัดไป')).click()
  await combat.locator('[aria-current=step]').getByText(fight.actors.find((actor: { id: string }) =>
    actor.id === fight.scenes[0].combat.order[1].actorId).name, { exact: true }).waitFor()
  await playerRail.locator('[aria-current=step]').getByText(fight.actors.find((actor: { id: string }) =>
    actor.id === fight.scenes[0].combat.order[1].actorId).name, { exact: true }).waitFor()
  const aoe = combat.getByRole('region', { name: 'โจมตีแบบ AoE' })
  await aoe.getByRole('button', exact('สี่เหลี่ยม')).click()
  const inFight = (await canvas.boundingBox())!
  await dm.mouse.move(inFight.x + 120, inFight.y + 120)
  await dm.mouse.down()
  await dm.mouse.move(inFight.x + 230, inFight.y + 198, { steps: 4 })
  await dm.mouse.up()
  await aoe.getByText('สี่เหลี่ยม · 2 เป้าหมาย', { exact: true }).waitFor()
  await aoe.getByLabel('สูตรความเสียหาย').fill('1d4')
  await aoe.getByLabel('ประเภทความเสียหาย').selectOption('cold')
  await aoe.getByRole('button', exact('ทอยและใช้ความเสียหาย AoE')).click()
  await two.locator('.floating-damage[aria-label$="เย็น"]').first().waitFor({ state: 'attached' })
  await canvas.click({ position: { x: 260, y: 115 }, button: 'right' })
  await dm.getByRole('button', exact('ปรับ HP')).click()
  await dm.getByLabel('จำนวน', { exact: true }).fill('-99')
  await dm.getByRole('button', exact('ยืนยันการปรับ HP')).click()
  await dm.locator('.scrim').waitFor({ state: 'hidden' })
  await canvas.click({ position: { x: 260, y: 115 }, button: 'right' })
  await dm.getByRole('button', exact('ค้นศพ / Loot')).click()
  await dm.getByLabel('DC ค้นศพ').fill('1')
  const settings = dm.waitForResponse(response => response.url().endsWith('/commands') && response.request().postDataJSON()?.type === 'lootSettings')
  await dm.getByRole('button', exact('บันทึก DC และทักษะ')).click()
  assert.equal((await settings).status(), 200)
  await dm.getByRole('dialog', { name: 'ค้นศพ Rat 1' }).getByRole('button', exact('ปิด')).click()
  await two.keyboard.press('Escape')
  await two.locator(boardCanvas).click({ position: { x: 260, y: 115 }, button: 'right' })
  await two.getByRole('button', exact('ค้นศพ / Loot')).click()
  await two.getByRole('button', exact('ทอยค้นหาและรับ Loot')).click()
  await two.getByText(/ค้นพบของครบ · ผลทอย/).waitFor()
  await two.getByText('Copper token ×1', { exact: true }).waitFor()
  await two.getByRole('dialog', { name: 'ค้นศพ Rat 1' }).getByRole('button', exact('ปิด')).click()
  await openPanel(dm, 'ฉากและแผนที่')
  await dm.locator('.scene-item').filter({ hasText: 'Vault' }).click()
  await dm.getByRole('button', exact('เปิดให้ผู้เล่น')).click()
  await one.getByRole('heading', exact('Vault')).waitFor()
  await two.reload()
  await two.getByRole('heading', exact('Vault')).waitFor()
  await openPanel(two, 'ชีตในห้อง')
  assert.equal(await two.getByRole('button', exact('Mage')).count(), 1)
  await two.getByRole('button', exact('Mage')).click()
  await two.getByRole('button', exact('คัดลอกเข้าคลังส่วนตัว')).click()
  // A guest saves to the library by creating an account right in the panel; the seat and the draft stay.
  const library = two.locator('.personal-library')
  await library.getByLabel('อีเมล').fill('mage-' + randomUUID() + '@example.com')
  await library.getByLabel('รหัสผ่าน', { exact: true }).fill('browser-test-password')
  await library.getByLabel('ชื่อตัวละครที่ใช้บนโต๊ะ').fill('Mage player')
  await library.getByRole('button', exact('สมัครบัญชี')).click()
  await two.getByRole('button', exact('บันทึกเป็นชีตใหม่')).click()
  await two.getByRole('button', exact('บันทึกชีต')).click()
  await two.getByRole('heading', exact('Mage')).waitFor()
  await two.goto(base)
  await startTable(two, 'Second table')
  await openPanel(two, 'คลังส่วนตัว')
  await two.getByRole('button', exact('ใช้ในห้องนี้')).click()
  await two.getByText('คัดลอกชีตเข้าห้องแล้ว').waitFor()
  await openPanel(two, 'ชีตในห้อง')
  await two.getByRole('button', exact('Mage')).click()
  await two.getByRole('tab', exact('Inventory')).click()
  await two.getByText('Inventory (1)', { exact: true }).waitFor()
  await two.getByText('Copper token', { exact: true }).waitFor()
  await two.setViewportSize({ width: 390, height: 780 })
  await openPanel(two, 'ฉากและแผนที่')
  await createScene(two, 'Mobile')
  await two.keyboard.press('Escape')
  await two.locator('#table-drawer').waitFor({ state: 'hidden' })
  const mobileBoard = (await two.locator(boardCanvas).boundingBox())!
  assert.equal(mobileBoard.width, 390)
  assert.equal(mobileBoard.height, 722)
  await two.getByRole('button', exact('คำสั่งกระดาน')).click()
  await two.getByRole('button', exact('วัดระยะ')).last().waitFor()
  await two.keyboard.press('Escape')
  await two.getByRole('group', { name: 'คำสั่งตามตำแหน่ง' }).waitFor({ state: 'hidden' })
})

test('DM searches the SRD, saves a monster template and places the creature with its reference', { timeout: 45000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER ? { executablePath: process.env.BEHOLDER_BROWSER } : { channel: 'msedge' })
  t.after(() => browser.close())
  const page = await seat(browser, { viewport: { width: 1280, height: 800 } })
  const response = await page.request.post(base + '/api/rooms', { data: { name: 'Bestiary test', member: 'DM' } })
  assert.equal(response.status(), 201)
  const room: Snapshot = await response.json()
  const path = base + '/api/rooms/' + room.id
  const create = await page.request.post(path + '/commands', { data: { commandId: randomUUID(), revision: room.revision, type: 'scene', name: 'Woods', cell: 48, originX: 0, originY: 0 } })
  assert.equal(create.status(), 200)
  await page.goto(base + '/?room=' + room.id)
  await openPanel(page, 'Monster Manual')
  await page.getByLabel('ค้นหาชื่อหรือประเภท').fill('Goblin Warrior')
  await page.locator('.manual-filters').getByLabel('กรองตาม CR').selectOption('1/4')
  await page.locator('.manual-filters').getByLabel('กรองตามประเภท').selectOption('Fey')
  await page.locator('.manual-list button').click()
  await page.getByRole('button', exact('เพิ่มเป็นต้นแบบในห้อง')).click()
  await page.getByRole('button', exact('เพิ่มต้นแบบแล้ว')).waitFor()
  await page.getByRole('button', exact('วางมอนสเตอร์ในฉาก')).click()
  const placed = page.waitForResponse(r => r.url() === path + '/commands' && r.request().postDataJSON()?.type === 'place')
  await page.locator(boardCanvas).click({ position: { x: 210, y: 160 } })
  assert.equal((await placed).status(), 200)
  const result: Snapshot = await (await page.request.get(path)).json()
  const monster = result.actors[0]
  assert.equal(monster.kind, 'monster')
  assert.equal(monster.ac, 15)
  assert.equal(monster.hp, 10)
  assert.equal(monster.attack, 4)
  assert.equal(monster.damage, '1d6+2')
  assert.match(monster.monsterReference!.statBlock, /Nimble Escape/)
  // SRD catalog fields arrive as rollable data, not just text.
  assert.equal(monster.monsterReference!.id, 'srd-5.2.1:goblin-warrior')
  assert.deepEqual(monster.skillChecks?.Stealth, { ability: 'DEX', training: 2, adjustment: 0 })
  assert.equal(monster.attacks?.[1].damageKind, 'piercing')
  assert.equal(monster.characterDetails?.hitDice, '3d6')
  assert.equal(result.templates[0].sheet.monsterReference?.page, monster.monsterReference!.page)
  assert.equal(result.scenes[0].tokens[0].actorId, monster.id)

  // The DM drags an object to a new cell; selecting it shows its commands.
  const canvas = page.locator(boardCanvas)
  await canvas.click({ position: { x: 400, y: 300 }, button: 'right' })
  await page.getByRole('button', exact('นำเข้า Object ที่นี่')).click()
  await page.getByLabel('ชื่อ Object').fill('Barrel')
  await page.getByRole('button', exact('วาง Object')).click()
  await page.getByRole('dialog', { name: 'นำเข้า Object' }).waitFor({ state: 'hidden' })
  const barrel = (await (await page.request.get(path)).json() as Snapshot).scenes[0].objects!.find(item => item.name === 'Barrel')!
  const frame = (await canvas.boundingBox())!
  const moved = page.waitForResponse(r => r.url() === path + '/commands' && r.request().postDataJSON()?.type === 'moveObject')
  await page.mouse.move(frame.x + 36 + (barrel.x + .5) * 48, frame.y + 36 + (barrel.y + .5) * 48)
  await page.mouse.down()
  await page.mouse.move(frame.x + 36 + (barrel.x + 2.5) * 48, frame.y + 36 + (barrel.y + .5) * 48, { steps: 6 })
  await page.mouse.up()
  assert.equal((await moved).status(), 200)
  const after = (await (await page.request.get(path)).json() as Snapshot).scenes[0].objects!.find(item => item.name === 'Barrel')!
  assert.deepEqual([after.x, after.y], [barrel.x + 2, barrel.y])
  await page.getByRole('toolbar', { name: 'คำสั่งของ Barrel' }).getByRole('button', exact('โต้ตอบกับ Object')).waitFor()
})
