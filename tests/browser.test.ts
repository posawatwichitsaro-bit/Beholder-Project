import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright-core'
import type { Browser, Page } from 'playwright-core'
import { blankSheet } from '../shared/model.ts'
import type { Snapshot } from '../shared/model.ts'

const base = process.env.BEHOLDER_TEST_URL ?? 'http://127.0.0.1:3000'
const exact = (name: string) => ({ name, exact: true })
/** Room id from a table URL: `/room/:id` (current) or `/?room=id` (links issued before the router). */
const roomIdOf = (url: string) => /\/room\/([^/?#]+)/.exec(new URL(url).pathname)?.[1] ?? new URL(url).searchParams.get('room')

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
  await sheet.getByRole('button', exact('INT check')).click()
  await page.getByRole('region', exact('ลูกเต๋า')).waitFor()
  await page.locator('.rolls').getByText(/INT check · Lyra/).waitFor()
  await sheet.getByRole('tab', exact('Actions')).click()
  await sheet.getByRole('button', exact('Damage การโจมตีหลัก')).waitFor()

  // Every new roll gets a short dice animation; the Adventure Log keeps chat and rolls in one timeline.
  await page.locator('.dice-reveal').waitFor({ state: 'attached' })
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
    await page.locator('canvas').click({ position: { x: 180, y: 135 } })
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
  const box = (await page.locator('canvas').boundingBox())!
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
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox').fill('Encounter')
  await page.keyboard.press('Enter')
  await page.getByRole('heading', exact('ด่านร้างริมทาง')).waitFor()
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
  // The empty board says what to do next.
  await page.getByRole('button', exact('ลองด้วย Encounter ตัวอย่าง')).click()
  await page.getByRole('heading', exact('ด่านร้างริมทาง')).waitFor()

  await openPanel(page, 'ตั้งค่าการแสดงผล')
  await page.getByRole('button', exact('110%')).click()
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '17.6px')
  await page.getByLabel('ลดแอนิเมชัน').check()
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
  await page.waitForFunction(async url => (await (await fetch(url)).json()).actors[0].ac === 14, path)
  const vex = await actorOf()
  assert.deepEqual(vex.attacks?.[0] && { ...vex.attacks[0], notes: undefined }, { name: 'Rapier', bonus: 5, damage: '1d8+3', damageKind: 'piercing', notes: undefined })
  assert.equal(vex.ac, 11 + 3, 'Leather Armor: 11 + Dex')
  const potion = vex.inventory!.find(item => item.ref === 'srd-5.2.1:magic:potions-of-healing')!
  assert.deepEqual([potion.name, potion.quantity, potion.rarity], ['Potion of Healing (greater)', 2, 'Uncommon'])
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
  await page.locator('canvas').click({ position: { x: 210, y: 160 } })
  await page.waitForFunction(async url => (await (await fetch(url)).json()).scenes[0].tokens.length === 1, path)

  await page.locator('canvas').click({ position: { x: 210, y: 160 }, button: 'right' })
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

/** From the lobby, open a new table as DM. With tables already on the shelf the form sits behind "เขียนเรื่องใหม่". */
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
  const board = player.locator('canvas')
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
  assert.equal(await one.getByRole('navigation', { name: 'ระบบในห้อง' }).getByRole('button', exact('Monster Manual')).count(), 0, 'players never see DM tools')
  await one.keyboard.press('Control+k')
  await one.getByRole('combobox', exact('ค้นหาคำสั่ง')).fill('ลูกเต๋า')
  await one.keyboard.press('Enter')
  await one.getByRole('region', exact('ลูกเต๋า')).waitFor()
  await one.keyboard.press('Escape')
  await one.locator('#table-drawer').waitFor({ state: 'hidden' })
  const playerBoard = await one.locator('canvas').boundingBox()
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
  const canvas = dm.locator('canvas')
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
  await dm.getByLabel('จำนวน').fill('3')
  await dm.getByRole('button', exact('ยืนยันการปรับ HP')).click()
  await dm.locator('.scrim').waitFor({ state: 'hidden' })
  await canvas.click({ position: { x: 260, y: 115 }, button: 'right' })
  await dm.getByRole('button', exact('เปิดชีต')).click()
  await dm.getByText('7/10', { exact: true }).waitFor()
  await one.keyboard.press('Escape')
  await one.locator('canvas').click({ position: { x: 165, y: 115 }, button: 'right' })
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
  await dm.getByRole('dialog', { name: 'นำเข้า Object' }).getByRole('combobox').selectOption('item')
  await dm.getByLabel('ชื่อ Object').fill('Silver key')
  await dm.getByRole('button', exact('วาง Object')).click()
  await dm.getByRole('dialog', { name: 'นำเข้า Object' }).waitFor({ state: 'hidden' })
  await one.keyboard.press('Escape')
  await one.locator('canvas').click({ position: { x: 163, y: 203 }, button: 'right' })
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
  await dm.getByRole('dialog', { name: 'นำเข้า Object' }).getByRole('combobox').selectOption('container')
  await dm.getByLabel('ชื่อ Object').fill('Locked cache')
  await dm.getByLabel(/ของเริ่มต้นในกล่อง/).fill('Letter')
  await dm.getByLabel('ล็อกกล่อง', { exact: true }).check()
  await dm.getByLabel('DC สะเดาะล็อก').fill('1')
  await dm.getByRole('button', exact('วาง Object')).click()
  await dm.getByRole('dialog', { name: 'นำเข้า Object' }).waitFor({ state: 'hidden' })
  await one.keyboard.press('Escape')
  await one.locator('canvas').click({ position: { x: 163, y: 203 }, button: 'right' })
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
  await one.waitForFunction(() => {
    const canvas = document.querySelector('canvas')!
    const [red, green, blue] = canvas.getContext('2d')!.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
    return red > 160 && green > 55 && green < 115 && blue < 85
  })
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
  await dm.getByLabel('จำนวน', { exact: true }).fill('99')
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
  await two.locator('canvas').click({ position: { x: 260, y: 115 }, button: 'right' })
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
  const mobileBoard = (await two.locator('canvas').boundingBox())!
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
  await page.locator('canvas').click({ position: { x: 210, y: 160 } })
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
  const canvas = page.locator('canvas')
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
