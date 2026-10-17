import assert from 'node:assert/strict'
import { join } from 'node:path'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'

import { crc32, deflateSync } from 'node:zlib'

// A real PNG (the host checks image bytes, not names): a figure-shaped block in one colour.
function figurePng([r, g, b], width = 120, height = 200) {
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(8 + data.length + 4); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), 8 + data.length); return out }
  const rows = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4)
    for (let x = 0; x < width; x++) {
      const head = Math.hypot(x - width / 2, y - height * .18) < width * .2, body = y > height * .32 && Math.abs(x - width / 2) < width * (.18 + .3 * (y / height))
      row.set(head || body ? [r, g, b, 255] : [0, 0, 0, 0], 1 + x * 4)
    }
    rows.push(row)
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}

// The stage: right panel, character material, full-screen reader that can send the next input.
export async function castStageChecks({ page, step, output, report }) {
  await step('舞台：右侧小舞台按台词换人，导入立绘包后显示立绘', async () => {
    await page.getByRole('button', { name: '舞台', exact: true }).filter({ visible: true }).first().click()
    const scene = page.locator('.dsh-tavern-stage-tab .dsh-tavern-stage-scene')
    await scene.waitFor()
    // Opens at the turn's last annotated line.
    await page.locator('.dsh-tavern-stage-tab .dsh-tavern-stage-name').filter({ hasText: '你' }).waitFor()
    await page.getByRole('button', { name: '上一句', exact: true }).first().click()
    await page.locator('.dsh-tavern-stage-tab .dsh-tavern-stage-name').filter({ hasText: '店主' }).waitFor()
    assert.equal(await scene.locator('.dsh-tavern-stage-figure-letter').first().textContent(), '店')
    const pack = writeZipEntries([{ path: '店主/joy.png', content: figurePng([214, 140, 92]) }, { path: '店主/neutral.png', content: figurePng([150, 150, 170]) }, { path: 'notes.txt', content: 'x' }])
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '导入 ST 立绘包', exact: true }).click()
    await (await chooser).setFiles({ name: 'pack.zip', mimeType: 'application/zip', buffer: pack })
    await page.getByText('导入 2 张立绘（店主），跳过 1 个文件').waitFor()
    await scene.locator('.dsh-tavern-stage-figure img[alt="店主"]').waitFor()
    assert.match(await scene.locator('.dsh-tavern-stage-figure img[alt="店主"]').getAttribute('src'), /\/api\/dsh-tavern\/cast-asset\?card=[0-9a-f]{64}&file=[0-9a-f]{32}\.png/)
    await page.waitForTimeout(600)
    await page.screenshot({ path: join(output, 'cast-stage-panel.png') })
    report.castStagePanel = true
  })
  await step('舞台全屏：逐句翻页，Esc 退出', async () => {
    await page.getByRole('button', { name: '全屏舞台', exact: true }).click()
    const overlay = page.locator('.dsh-tavern-stage-overlay')
    await overlay.locator('.dsh-tavern-stage-progress').filter({ hasText: /^1 \/ \d+$/ }).waitFor()
    const total = Number((await overlay.locator('.dsh-tavern-stage-progress').textContent()).split('/')[1])
    for (let index = 1; index < total; index++) await page.keyboard.press('ArrowRight')
    await overlay.locator('.dsh-tavern-stage-progress').filter({ hasText: total + ' / ' + total }).waitFor()
    await overlay.getByRole('textbox', { name: '舞台输入' }).waitFor()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(600)
    await page.screenshot({ path: join(output, 'cast-stage-fullscreen.png') })
    for (let index = 1; index < total; index++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Escape')
    await overlay.waitFor({ state: 'detached' })
    report.castStageFullscreen = true
  })
}

// Run last: it plays one more turn from the full-screen stage.
export async function castStageInputChecks({ page, step, report }) {
  await step('舞台全屏：在最后一句后直接发送下一轮', async () => {
    await page.getByRole('button', { name: '舞台', exact: true }).filter({ visible: true }).first().click()
    await page.getByRole('button', { name: '全屏舞台', exact: true }).click()
    const overlay = page.locator('.dsh-tavern-stage-overlay')
    await overlay.waitFor()
    await page.keyboard.press('End')
    for (let index = 0; index < 40 && !(await overlay.getByRole('textbox', { name: '舞台输入' }).count()); index++) await page.keyboard.press('ArrowRight')
    await overlay.getByRole('textbox', { name: '舞台输入' }).fill('舞台里的行动')
    await overlay.getByRole('button', { name: '发送', exact: true }).click()
    await page.keyboard.press('Escape')
    await overlay.waitFor({ state: 'detached' })
    await page.getByText('舞台里的行动', { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 60000 })
    await page.locator('[data-chat-flow-kind="turn-tail"]').last().waitFor({ timeout: 60000 })
    report.castStageInput = true
  })
}
