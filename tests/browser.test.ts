import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import type { Page } from 'playwright-core'

const base = process.env.BEHOLDER_TEST_URL ?? 'http://127.0.0.1:3000'
const exact = (name: string) => ({ name, exact: true })

async function createScene(page: Page, name: string) {
  await page.getByRole('button', exact('สร้างฉาก')).first().click()
  await page.getByLabel('ชื่อฉาก').fill(name)
  await page.getByRole('button', exact('บันทึกฉาก')).click()
  await page.locator('.scene-item').filter({ hasText: name }).waitFor()
}

async function createSheet(page: Page, name: string, monster = false) {
  await page.getByRole('button', exact(monster ? '+ ต้นแบบ' : '+ ตัวละคร')).click()
  await page.locator('.dialog').getByLabel('ชื่อ', { exact: true }).fill(name)
  await page.getByRole('button', exact('บันทึกชีต')).click()
  await page.locator('.dialog').waitFor({ state: 'hidden' })
}

test('three browser seats can place tokens, roll, take a turn and switch scenes', { timeout: 60000 }, async t => {
  const browser = await chromium.launch(process.env.BEHOLDER_BROWSER
    ? { executablePath: process.env.BEHOLDER_BROWSER }
    : { channel: 'msedge' })
  t.after(() => browser.close())
  const dm = await browser.newPage({ viewport: { width: 1440, height: 950 } })
  await dm.goto(base)
  await dm.getByLabel('ชื่อห้อง').fill('Beholder browser verification')
  await dm.getByLabel('ชื่อที่ใช้บนโต๊ะ').fill('DM')
  await dm.getByRole('button', exact('สร้างห้อง DM')).click()
  await dm.getByText('เชิญผู้เล่น', { exact: true }).click()
  const invite = await dm.getByLabel('ลิงก์เชิญ').inputValue()
  const one = await browser.newPage()
  const two = await browser.newPage()
  for (const [page, name] of [[one, 'Scout player'], [two, 'Mage player']] as const) {
    await page.goto(invite)
    await page.getByLabel('ชื่อที่ใช้บนโต๊ะ').fill(name)
    await page.getByRole('button', exact('เข้าร่วม')).click()
    await page.getByRole('heading', exact('กระดาน')).waitFor()
  }
  await createScene(dm, 'Gate')
  await createScene(dm, 'Vault')
  await one.getByRole('heading', exact('Gate')).waitFor()
  assert.equal(await two.locator('.scene-item').count(), 1)
  await dm.locator('input[type=file]').setInputFiles({
    name: 'test-map.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=', 'base64')
  })
  await createSheet(one, 'Scout')
  await createSheet(two, 'Mage')
  await createSheet(dm, 'Rat', true)
  const canvas = dm.locator('canvas')
  for (const [name, position] of [['Scout', { x: 165, y: 115 }], ['Mage', { x: 210, y: 115 }]] as const) {
    await dm.getByRole('button', exact('วาง ' + name)).click()
    await canvas.click({ position })
    await dm.getByRole('button', exact('วาง ' + name)).waitFor()
    await dm.getByText('คลิกช่องเพื่อวาง Token', { exact: true }).waitFor({ state: 'hidden' })
    assert.equal(await dm.getByRole('button', exact('วาง ' + name)).isDisabled(), true)
  }
  await dm.locator('.actor-item').filter({ hasText: 'Rat' }).getByRole('button', exact('วาง')).click()
  await canvas.click({ position: { x: 260, y: 115 } })
  await dm.getByText('คลิกช่องเพื่อวาง Token', { exact: true }).waitFor({ state: 'hidden' })
  await one.getByRole('button', exact('Scout')).click()
  await one.getByRole('button', exact('Check')).click()
  await two.locator('.rolls').getByText(/STR check · Scout/).waitFor()
  await dm.getByRole('button', exact('เริ่ม')).click()
  await dm.getByRole('button', exact('ทอย Initiative')).click()
  await two.getByText('รอบ 1', { exact: true }).waitFor()
  await dm.getByRole('button', exact('เทิร์นถัดไป')).click()
  await dm.locator('.scene-item').filter({ hasText: 'Vault' }).click()
  await dm.getByRole('button', exact('เปิดให้ผู้เล่น')).click()
  await one.getByRole('heading', exact('Vault')).waitFor()
  await two.reload()
  await two.getByRole('heading', exact('Vault')).waitFor()
  assert.equal(await two.getByRole('button', exact('Mage')).count(), 1)
})
