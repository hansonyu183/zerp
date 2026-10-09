import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it } from 'vitest'
import ServiceContextEditor from '../../../src/target/components/direct-page/ServiceContextEditor.vue'
import { useTargetSession } from '../../../src/target/session/vm.ts'
const options = [
  {
    id: 'read',
    name: '查询服务合同',
    snapshot: { path: '/vou/service-contract/query' },
  },
  {
    id: 'approve',
    name: '批准服务合同',
    snapshot: { path: '/vou/service-contract/approve' },
  },
  {
    id: 'workflow',
    name: '流程创建服务履约',
    snapshot: { path: '/wfl/process-instance/create-service-acceptance' },
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
  useTargetSession().serviceContexts = {
    '/vou/service-contract/query': ['OTHER_UNIT', 'PRIOR_AD'],
    '/vou/service-contract/approve': ['PRIOR_AD'],
    '/wfl/process-instance/create-service-acceptance': ['CONTRACT'],
  }
})
it('waits for permission references, requires each action choice and refuses a wider service source', async () => {
  const wrapper = mount(ServiceContextEditor, {
    props: {
      permissionIds: ['read', 'approve'],
      options: [],
      modelValue: { read: ['OTHER_UNIT'] },
      disabled: false,
    },
    global: { stubs },
  })
  expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  expect(wrapper.emitted('validity')?.at(-1)).toEqual([false])
  await wrapper.setProps({ options })
  const fields = wrapper.findAllComponents({ name: 'FieldInput' })
  expect(fields[1]?.props('modelValue')).toEqual([])
  expect(fields[1]?.props('field').options).toEqual([
    { value: 'PRIOR_AD', caption: '此前预付服务约定' },
  ])
  fields[1]?.vm.$emit('update:modelValue', ['SALES_PARTNER'])
  expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  fields[1]?.vm.$emit('update:modelValue', ['PRIOR_AD'])
  expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
    { read: ['OTHER_UNIT'], approve: ['PRIOR_AD'] },
  ])
  await wrapper.setProps({
    modelValue: { read: ['OTHER_UNIT'], approve: ['PRIOR_AD'] },
  })
  expect(wrapper.emitted('validity')?.at(-1)).toEqual([true])
  await wrapper.setProps({ permissionIds: ['approve'] })
  expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
    { approve: ['PRIOR_AD'] },
  ])
  wrapper.unmount()
})
it('workflow choices stay separate and readonly viewing does not rewrite grants', async () => {
  const wrapper = mount(ServiceContextEditor, {
    props: {
      permissionIds: ['workflow'],
      options,
      modelValue: { workflow: ['CONTRACT'] },
      disabled: false,
    },
    global: { stubs },
  })
  const field = wrapper.findComponent({ name: 'FieldInput' })
  expect(field.props('field').options).toEqual([
    { value: 'CONTRACT', caption: '合同履约验收' },
  ])
  await wrapper.setProps({ disabled: true })
  field.vm.$emit('update:modelValue', ['PRIOR_AH'])
  expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  wrapper.unmount()
})
