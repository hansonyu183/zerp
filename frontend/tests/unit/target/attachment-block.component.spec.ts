import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { expect, it, vi } from 'vitest'
import AttachmentBlock from '../../../src/target/components/attachments/AttachmentBlock.vue'
import { attachmentScope } from '../../../src/target/components/attachments/attachments.ts'
import { useTargetSession } from '../../../src/target/session/vm.ts'

it('lets an ordinary user select original storage, shows its Chinese type and refuses the twenty-first file', async () => {
  setActivePinia(createPinia())
  useTargetSession().apiPaths = ['/vou/service-contract/attachment-stage']
  const metadata = {
    id: 'fixture-file',
    fileName: '原照片.jpg',
    contentType: 'application/octet-stream',
    sizeBytes: 0,
    sha256: 'a'.repeat(64),
  }
  const add = vi.fn(async () => metadata)
  const wrapper = mount(AttachmentBlock, {
    props: { caption: '附件', mode: 'edit', modelValue: [] },
    global: {
      provide: {
        [attachmentScope as symbol]: {
          resource: 'vou/service-contract',
          add,
          status: () => '待提交时上传',
        },
      },
      stubs: {
        VFileInput: {
          name: 'VFileInput',
          props: ['disabled'],
          emits: ['update:modelValue'],
          template: '<div />',
        },
        VCheckbox: {
          name: 'VCheckbox',
          props: ['modelValue', 'label'],
          emits: ['update:modelValue'],
          template: '<div>{{ label }}</div>',
        },
        VAlert: { template: '<p><slot /></p>' },
        VBtn: { template: '<button><slot /></button>' },
        VProgressLinear: true,
      },
    },
  })
  const file = new File([], '原照片.jpg', { type: 'image/jpeg' })
  wrapper
    .findComponent({ name: 'VCheckbox' })
    .vm.$emit('update:modelValue', true)
  await flushPromises()
  wrapper
    .findComponent({ name: 'VFileInput' })
    .vm.$emit('update:modelValue', file)
  await flushPromises()
  expect(add).toHaveBeenCalledWith(file, true)
  expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([[metadata]])
  await wrapper.setProps({
    modelValue: Array.from({ length: 20 }, (_, index) => ({
      ...metadata,
      id: 'fixture-' + index,
    })),
  })
  expect(wrapper.text()).toContain('原始文件')
  wrapper
    .findComponent({ name: 'VFileInput' })
    .vm.$emit('update:modelValue', file)
  await flushPromises()
  expect(add).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('每单最多 20 个附件')
  wrapper.unmount()
})
