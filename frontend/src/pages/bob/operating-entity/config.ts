import {
  baseColumns,
  baseFilters,
  commonFields,
  defineBobEntityConfig,
  patternRule,
  phonePattern,
  taxNumberPattern,
  text,
  textarea,
} from '../shared/config-helpers'
import { bobListActiveVersion } from '../shared/types'

export const operatingEntityConfig = defineBobEntityConfig({
  entity: 'operating-entity',
  approvalDomain: 'dcl',
  title: '经营主体',
  codeLabel: '经营主体编码',
  nameLabel: '法定公司名称',
  defaults: {
    shortName: '',
    taxNumber: '',
    address: '',
    phone: '',
    remark: '',
  },
  requiredKeys: ['name'],
  uppercaseKeys: ['taxNumber'],
  fields: (context) => [
    ...commonFields(context, '经营主体编码', '法定公司名称'),
    text('shortName', '简称', 100),
    text('taxNumber', '税号', 50, {
      rules: [
        patternRule(taxNumberPattern, '税号只能包含字母、数字和连字符。'),
      ],
    }),
    textarea('address', '地址', 500),
    text('phone', '电话', 32, {
      rules: [patternRule(phonePattern, '电话格式不正确。')],
    }),
    textarea('remark', '备注'),
  ],
  columns: baseColumns('编码', '法定公司名称', [
    {
      key: 'taxNumber',
      label: '税号',
      value: (row) => bobListActiveVersion(row).summary.taxNumber,
    },
  ]),
  filters: baseFilters(),
})
