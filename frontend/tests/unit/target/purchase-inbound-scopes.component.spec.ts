import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it } from 'vitest'
import PurchaseInboundScopeEditor from '../../../src/target/components/direct-page/PurchaseInboundScopeEditor.vue'
import { useTargetSession } from '../../../src/target/session/vm.ts'
const options = [
  {
    id: 'read',
    name: '查询采购入库',
    snapshot: { path: '/vou/purchase-inbound/query' },
  },
  {
    id: 'approve',
    name: '批准采购入库',
    snapshot: { path: '/vou/purchase-inbound/approve' },
  },
  {
    id: 'workflow',
    name: '流程创建采购入库',
    snapshot: { path: '/wfl/process-instance/create-purchase-inbound' },
  },
]
const stubs = {
  FieldInput: {
    name: 'FieldInput',
    props: ['field', 'modelValue', 'disabled'],
    template: '<div />',
  },
}
beforeEach(() => {
  setActivePinia(createPinia())
  useTargetSession().purchaseInboundScopes = {
    '/vou/purchase-inbound/query': 'ALL',
    '/vou/purchase-inbound/approve': 'INDEPENDENT_PRIOR',
    '/wfl/process-instance/create-purchase-inbound': 'ORDER_REFERENCE',
  }
})
it('waits for paged permission identities, preserves old choices and requires explicit new choices', async () => {
  const wrapper = mount(PurchaseInboundScopeEditor, {
    props: {
      permissionIds: ['read', 'approve'],
      options: [],
      modelValue: { read: 'ORDER_REFERENCE' },
      disabled: false,
    },
    global: { stubs },
  })
  expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  expect(wrapper.emitted('validity')!.at(-1)).toEqual([false])
  await wrapper.setProps({ options })
  const fields = wrapper.findAllComponents({ name: 'FieldInput' })
  expect(fields[0]!.props('modelValue')).toBe('ORDER_REFERENCE')
  expect(fields[1]!.props('modelValue')).toBeUndefined()
  expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  expect(fields[1]!.props('field').options).toEqual([
    { value: 'INDEPENDENT_PRIOR', caption: '独立此前收货' },
  ])
  fields[1]!.vm.$emit('update:modelValue', 'ALL')
  expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  fields[1]!.vm.$emit('update:modelValue', 'INDEPENDENT_PRIOR')
  const value = {
    read: 'ORDER_REFERENCE',
    approve: 'INDEPENDENT_PRIOR',
  } as const
  expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([value])
  await wrapper.setProps({ modelValue: value })
  expect(wrapper.emitted('validity')!.at(-1)).toEqual([true])
  await wrapper.setProps({ permissionIds: ['approve'] })
  expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([
    { approve: 'INDEPENDENT_PRIOR' },
  ])
  wrapper.unmount()
})
it('keeps workflow creation separate from ordinary submission and locks readonly grants', async () => {
  const wrapper = mount(PurchaseInboundScopeEditor, {
    props: {
      permissionIds: ['workflow'],
      options,
      modelValue: { workflow: 'ORDER_REFERENCE' },
      disabled: false,
    },
    global: { stubs },
  })
  const field = wrapper.findComponent({ name: 'FieldInput' })
  expect(field.props('field').options).toEqual([
    { value: 'ORDER_REFERENCE', caption: '订单引用收货' },
  ])
  await wrapper.setProps({ disabled: true })
  field.vm.$emit('update:modelValue', 'ALL')
  await flushPromises()
  expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  wrapper.unmount()
})
