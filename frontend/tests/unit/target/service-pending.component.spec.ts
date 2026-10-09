import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import ServiceLineEditor from '../../../src/target/components/document-page/ServiceLineEditor.vue'
import ServiceBlock from '../../../src/target/components/document-page/ServiceBlock.vue'
import {
  emptyService,
  emptyServiceLine,
} from '../../../src/target/components/document-page/service-data.ts'
import { useTargetSession } from '../../../src/target/session/vm.ts'
import * as api from '../../../src/target/api.ts'
vi.mock('../../../src/target/api.ts', async (original) => ({
  ...(await original<typeof import('../../../src/target/api.ts')>()),
  queryTargetServiceContractLines: vi.fn(),
}))
const stubs = {
  ReferencePicker: {
    name: 'ReferencePicker',
    props: [
      'source',
      'caption',
      'modelValue',
      'existing',
      'multiple',
      'disabled',
    ],
    template: '<div />',
  },
  VouReference: {
    name: 'VouReference',
    props: ['entity', 'caption', 'modelValue', 'disabled'],
    template: '<div />',
  },
  FormBlock: { template: '<div />' },
  FieldInput: { template: '<div />' },
  CollectionBlock: { name: 'CollectionBlock', template: '<div />' },
}
beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  const session = useTargetSession()
  session.apiPaths = ['/vou/service-acceptance/submit-new']
  session.serviceContexts = {
    '/vou/service-acceptance/submit-new': ['CONTRACT'],
  }
})
it('unit source readiness is aggregated and each picker keeps its own page snapshots', async () => {
  const wrapper = mount(ServiceLineEditor, {
    props: {
      modelValue: emptyServiceLine(),
      historical: false,
      disabled: false,
    },
    global: { stubs },
  })
  const pickers = wrapper.findAllComponents({ name: 'ReferencePicker' })
  expect(wrapper.emitted('pending')?.at(-1)).toEqual([true])
  pickers[0]!.vm.$emit('ready', true)
  await flushPromises()
  expect(wrapper.emitted('pending')?.at(-1)).toEqual([true])
  pickers[1]!.vm.$emit('ready', true)
  await flushPromises()
  expect(wrapper.emitted('pending')?.at(-1)).toEqual([false])
  pickers[0]!.vm.$emit('resolved', [
    {
      id: 'entered',
      name: '录入',
      snapshot: { id: 'entered', code: 'D', name: '车', fixedFactor: null },
    },
  ])
  pickers[1]!.vm.$emit('resolved', [
    {
      id: 'base',
      name: '基准',
      snapshot: { id: 'base', code: 'E', name: '次', fixedFactor: null },
    },
  ])
  pickers[0]!.vm.$emit('update:modelValue', 'entered')
  await flushPromises()
  expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toMatchObject({
    enteredUnit: { objectId: 'entered', code: 'D' },
  })
  pickers[0]!.vm.$emit('ready', false)
  await flushPromises()
  expect(wrapper.emitted('pending')?.at(-1)).toEqual([true])
  wrapper.unmount()
  expect(wrapper.emitted('pending')?.at(-1)).toEqual([false])
})
it('a line readiness completion cannot clear an outstanding contract read', async () => {
  let resolve!: (value: { items: [] }) => void
  vi.mocked(api.queryTargetServiceContractLines).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const wrapper = mount(ServiceBlock, {
    props: { modelValue: emptyService('service-acceptance'), disabled: false },
    global: { stubs },
  })
  const contract = wrapper
    .findAllComponents({ name: 'VouReference' })
    .find((item) => item.props('entity') === 'service-contract')!
  contract.vm.$emit('update:modelValue', {
    entity: 'service-contract',
    objectId: 'contract',
    code: 'SC1',
    name: '合同',
  })
  await flushPromises()
  const lines = wrapper.findComponent({ name: 'CollectionBlock' })
  lines.vm.$emit('pending', true)
  lines.vm.$emit('pending', false)
  await flushPromises()
  expect(wrapper.emitted('pending')?.at(-1)).toEqual([true])
  lines.vm.$emit('pending', true)
  resolve({ items: [] })
  await flushPromises()
  expect(wrapper.emitted('pending')?.at(-1)).toEqual([true])
  lines.vm.$emit('pending', false)
  await flushPromises()
  expect(wrapper.emitted('pending')?.at(-1)).toEqual([false])
  wrapper.unmount()
})
