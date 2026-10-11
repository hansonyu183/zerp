import { readFile } from 'node:fs/promises'
import { expect, type Locator, type Page } from '@playwright/test'

export const archiveOriginals = [
  {
    name: '原照片.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from([255, 216, 0, 1]),
  },
  {
    name: '原空文件.et',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(0),
  },
]

export async function selectArchiveOriginals(dialog: Locator) {
  await dialog.getByLabel('按原始文件保存', { exact: true }).check()
  for (const file of archiveOriginals) {
    await dialog.locator('input[type=file]').last().setInputFiles(file)
    await expect(
      dialog.locator('.attachment-row').filter({ hasText: file.name }),
    ).toBeVisible()
  }
}

export async function downloadArchiveOriginals(
  page: Page,
  dialog: Locator,
  entity: 'supplier' | 'product',
  source: 'current' | 'submission',
) {
  for (const file of archiveOriginals) {
    const reading = page.waitForResponse((response) =>
      response.url().endsWith(`/bob/${entity}/attachment-read`),
    )
    const downloading = page.waitForEvent('download')
    await dialog
      .locator('.attachment-row')
      .filter({ hasText: file.name })
      .last()
      .getByRole('button', { name: '下载附件', exact: true })
      .click()
    const response = await reading
    expect(response.request().postDataJSON().source).toBe(source)
    const original = await response.json()
    expect(original.code).toBe(0)
    expect(original.data.mimeType).toBe('application/octet-stream')
    expect(original.data.size).toBe(file.buffer.length)
    const download = await downloading
    expect(download.suggestedFilename()).toBe(file.name)
    expect(await download.failure()).toBeNull()
    expect(await readFile((await download.path())!)).toEqual(file.buffer)
  }
}
