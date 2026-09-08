import { h } from 'vue'
const buttonStub = {
  props: ['disabled', 'loading'],
  emits: ['click'],
  template:
    '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>',
}

export const archiveStubs = {
  AppSnackbar: { props: ['message'], template: '<div>{{message}}</div>' },
  ManagementPageFrame: {
    props: ['title'],
    template:
      '<main><h1>{{ title }}</h1><slot name="actions" /><slot name="alerts" /><slot name="filters" /><slot /><slot name="footer" /></main>',
  },
  VAlert: { template: '<div><slot /></div>' },
  VBtn: buttonStub,
  VCard: {
    props: ['title'],
    template: '<section><h2>{{ title }}</h2><slot /></section>',
  },
  VCardActions: { template: '<div><slot /></div>' },
  VCardText: { template: '<div><slot /></div>' },
  VCheckbox: { template: '<input type="checkbox" />' },
  VDataTable: {
    props: ['headers', 'items'],
    setup(
      props: { headers: Array<{ key: string }>; items: object[] },
      {
        slots,
      }: { slots: Record<string, (props: { item: object }) => unknown> },
    ) {
      return () =>
        h(
          'table',
          props.items.map((item) =>
            h(
              'tr',
              props.headers.map((header) =>
                h('td', slots[`item.${header.key}`]?.({ item })),
              ),
            ),
          ),
        )
    },
  },
  VDialog: {
    props: ['modelValue'],
    template: '<div v-if="modelValue"><slot /></div>',
  },
  VPagination: { template: '<div />' },
  VTable: { template: '<table><slot /></table>' },
  VProgressLinear: { template: '<div />' },
  VSelect: {
    props: [
      'modelValue',
      'disabled',
      'label',
      'items',
      'multiple',
      'itemTitle',
      'itemValue',
    ],
    emits: ['update:modelValue'],
    template: `<label>{{label}}<select :aria-label="label" :disabled="disabled" :multiple="multiple" @change="$emit('update:modelValue',multiple?[...$event.target.selectedOptions].map(o=>o.value):$event.target.value)"><option v-for="item in items" :key="item[itemValue||'value']" :value="item[itemValue||'value']" :selected="Array.isArray(modelValue)?modelValue.includes(item[itemValue||'value']):modelValue===item[itemValue||'value']">{{item[itemTitle||'title']}}</option></select></label>`,
  },
  VAutocomplete: {
    props: ['modelValue', 'items', 'label', 'multiple', 'disabled'],
    emits: ['update:modelValue'],
    template: `<label>{{label}}<select :aria-label="label" :multiple="multiple" :disabled="disabled" @change="$emit('update:modelValue',multiple ? [...$event.target.selectedOptions].map(o=>o.value) : $event.target.value)"><option v-for="item in items" :key="item.id" :value="item.id" :selected="Array.isArray(modelValue) ? modelValue.includes(item.id) : modelValue === item.id" :disabled="item.props?.disabled">{{item.name}}</option></select></label>`,
  },
  VFileInput: {
    props: ['label', 'disabled'],
    emits: ['update:modelValue'],
    template: `<input type="file" :aria-label="label" :disabled="disabled" @change="$emit('update:modelValue',$event.target.files[0])"/>`,
  },
  VSpacer: { template: '<span />' },
  VTextField: {
    props: ['modelValue', 'disabled', 'label'],
    emits: ['update:modelValue'],
    template:
      '<input :aria-label="label" :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  VTextarea: {
    props: ['modelValue', 'disabled', 'label'],
    emits: ['update:modelValue'],
    template:
      '<textarea :aria-label="label" :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  VForm: {
    emits: ['submit'],
    template:
      '<form @submit.prevent="$emit(\'submit\', $event)"><slot /></form>',
  },
}
