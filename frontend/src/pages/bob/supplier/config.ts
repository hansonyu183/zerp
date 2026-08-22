import {
  baseColumns,
  baseFilters,
  defineBobEntityConfig,
  emailPattern,
  patternRule,
  phonePattern,
  reference,
  text,
  textarea,
} from '../shared/config-helpers'

// Shared metadata for navigation and generic reference surfaces. The dedicated
// supplier workspace owns the Party + relationship creation flow.
export const supplierConfig = defineBobEntityConfig({
  entity: 'supplier',
  title: '供应商',
  codeLabel: '供应关系编码',
  nameLabel: '主体名称',
  defaults: {
    name: '',
    operatingEntityId: '',
    contactName: '',
    contactPhone: '',
    email: '',
    address: '',
    remark: '',
    settlementMethodId: '',
    defaultPurchaserEmployeeId: '',
  },
  requiredKeys: ['name', 'operatingEntityId'],
  references: {
    operatingEntityId: {
      entity: 'operating-entity',
      label: '经营主体',
    },
    settlementMethodId: {
      domain: 'aux',
      entity: 'settlement-method',
      label: '结算方式',
    },
    defaultPurchaserEmployeeId: { entity: 'employee', label: '默认采购员' },
  },
  fields: (context) => [
    text('name', '主体名称', 200, { required: true }),
    reference('operatingEntityId', '经营主体', context, true),
    text('contactName', '联系人', 100),
    text('contactPhone', '电话', 32, {
      rules: [patternRule(phonePattern, '电话格式不正确。')],
    }),
    text('email', '邮箱', 254, {
      rules: [patternRule(emailPattern, '邮箱格式不正确。')],
    }),
    textarea('address', '地址', 500),
    textarea('remark', '备注'),
    reference('settlementMethodId', '结算方式', context),
    reference('defaultPurchaserEmployeeId', '默认采购员', context),
  ],
  columns: baseColumns('编码', '主体名称'),
  filters: baseFilters([
    {
      key: 'defaultPurchaserEmployeeId',
      label: '默认采购员',
      type: 'autocomplete',
      reference: { entity: 'employee', label: '默认采购员' },
    },
  ]),
})
