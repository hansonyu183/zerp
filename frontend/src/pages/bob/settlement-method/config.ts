import {
  baseColumns,
  baseFilters,
  defineBobEntityConfig,
  patternRule,
  text,
} from '../shared/config-helpers'

const surchargePattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/

export const settlementMethodConfig = defineBobEntityConfig({
  entity: 'settlement-method',
  title: '结算方式',
  codeLabel: '结算方式编码',
  nameLabel: '结算方式',
  defaults: {
    termCode: '',
    ruleType: '',
    monthOffset: 0,
    dayOffset: 0,
    defaultSalesSurcharge: '0.00',
    description: '',
  },
  requiredKeys: ['name', 'defaultSalesSurcharge'],
  persistedKeys: ['defaultSalesSurcharge'],
  fields: (context) => [
    ...(context.mode === 'create'
      ? []
      : [
          { key: 'code', label: '结算方式编码', type: 'readonly' as const },
        ]),
    { key: 'name', label: '结算方式', type: 'readonly' as const },
    { key: 'termCode', label: '术语代码', type: 'readonly' as const },
    { key: 'ruleType', label: '到期规则', type: 'readonly' as const },
    { key: 'monthOffset', label: '月末偏移（月）', type: 'readonly' as const },
    { key: 'dayOffset', label: '到货偏移（天）', type: 'readonly' as const },
    text('defaultSalesSurcharge', '销售加价（元/kg）', undefined, {
      required: true,
      rules: [
        patternRule(surchargePattern, '销售加价必须是非负的两位小数。'),
      ],
      hint: '修改需提交审批，生效后只影响新销售订单。',
    }),
    { key: 'description', label: '说明', type: 'readonly' as const },
  ],
  columns: baseColumns('编码', '名称', [
    {
      key: 'termCode',
      label: '术语代码',
      value: (row) => row.currentVersion.summary.termCode,
      format: (value) => String(value ?? ''),
    },
    {
      key: 'defaultSalesSurcharge',
      label: '销售加价（元/kg）',
      value: (row) => row.currentVersion.summary.defaultSalesSurcharge,
      format: (value) => String(value ?? '0.00'),
    },
  ]),
  filters: baseFilters(),
})
