import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { expect } from 'vitest'
export async function editItem(
  wrapper: VueWrapper,
  caption: string,
  index = 0,
) {
  const section = wrapper
    .findAll('.collection-block')
    .find((section) => section.attributes('aria-label') === caption)
  expect(section, caption).toBeDefined()
  await section!
    .findAll('[data-testid="row-action-edit"]')
    [index]!.trigger('click')
  await flushPromises()
}
export async function confirmItems(wrapper: VueWrapper) {
  // Select the deepest dialog, then its own confirmation button.
  for (let level = 0; level < 8; level++) {
    const dialog = wrapper.findAll('div[aria-label^="编辑"]').at(-1)
    const button = dialog
      ?.findAll('button')
      .filter((button) => button.text() === '确定')
      .at(-1)
    if (!button || button.attributes('disabled') !== undefined) return
    await button.trigger('click')
    await flushPromises()
  }
  throw new Error('子项弹窗未关闭')
}
