import {
  baseColumns,
  baseFilters,
  commonFields,
  defineBobEntityConfig,
  settlementRuleOptions,
  textarea,
} from '../shared/config-helpers'

export const settlementMethodConfig = defineBobEntityConfig({
  entity: 'settlement-method',
  title: '结算方式',
  codeLabel: '结算方式编码',
  nameLabel: '结算方式名称',
  defaults: {
    ruleType: 'RELATIVE_DAYS',
    monthOffset: 0,
    dayOfMonth: null,
    dayOffset: 0,
    description: '',
  },
  requiredKeys: ['code', 'name', 'ruleType'],
  uppercaseKeys: ['code'],
  fields: (context) => [
    ...commonFields(context, '结算方式编码', '结算方式名称'),
    {
      key: 'ruleType',
      label: '规则类型',
      type: 'select',
      required: true,
      options: settlementRuleOptions,
      onChange: (value) => {
        if (value === 'RELATIVE_DAYS') {
          return { monthOffset: 0, dayOfMonth: null }
        }
        if (value === 'MONTH_END') return { dayOfMonth: null }
        if (value === 'FIXED_DAY') return { dayOfMonth: 1 }
      },
    },
    {
      key: 'monthOffset',
      label: '月偏移',
      type: 'number',
      min: 0,
      max: 120,
      step: 1,
      visible: (form) => form.ruleType !== 'RELATIVE_DAYS',
    },
    {
      key: 'dayOfMonth',
      label: '指定日',
      type: 'number',
      required: true,
      min: 1,
      max: 31,
      step: 1,
      visible: (form) => form.ruleType === 'FIXED_DAY',
    },
    {
      key: 'dayOffset',
      label: '日偏移',
      type: 'number',
      min: -3650,
      max: 3650,
      step: 1,
    },
    textarea('description', '说明'),
  ],
  columns: baseColumns('编码', '名称', [
    {
      key: 'ruleType',
      label: '规则',
      value: (row) => row.currentVersion.summary.ruleType,
      format: (value) =>
        settlementRuleOptions.find((item) => item.value === value)?.title ??
        String(value),
    },
  ]),
  filters: baseFilters(),
})
