import {
  baseColumns,
  baseFilters,
  commonFields,
  defineBobEntityConfig,
  emailPattern,
  patternRule,
  phonePattern,
  reference,
  text,
  textarea,
} from '../shared/config-helpers'

export const employeeConfig = defineBobEntityConfig({
  entity: 'employee',
  title: '员工',
  codeLabel: '员工编码',
  nameLabel: '员工姓名',
  defaults: {
    departmentId: '',
    positionId: '',
    phone: '',
    email: '',
    hireDate: '',
    remark: '',
  },
  requiredKeys: ['name'],
  references: {
    departmentId: { domain: 'aux', entity: 'department', label: '部门' },
    positionId: { domain: 'aux', entity: 'position', label: '岗位' },
  },
  fields: (context) => [
    ...commonFields(context, '员工编码', '员工姓名'),
    reference('departmentId', '部门', context),
    reference('positionId', '岗位', context),
    text('phone', '联系电话', 32, {
      rules: [patternRule(phonePattern, '联系电话格式不正确。')],
    }),
    text('email', '邮箱', 254, {
      rules: [patternRule(emailPattern, '邮箱格式不正确。')],
    }),
    { key: 'hireDate', label: '入职日期', type: 'date' },
    textarea('remark', '备注'),
  ],
  columns: baseColumns('编码', '姓名', [
    {
      key: 'phone',
      label: '电话',
      value: (row) => row.currentVersion.summary.phone,
    },
    {
      key: 'hireDate',
      label: '入职',
      value: (row) => row.currentVersion.summary.hireDate,
    },
  ]),
  filters: baseFilters([
    {
      key: 'departmentId',
      label: '部门',
      type: 'autocomplete',
      reference: { domain: 'aux', entity: 'department', label: '部门' },
    },
    {
      key: 'positionId',
      label: '岗位',
      type: 'autocomplete',
      reference: { domain: 'aux', entity: 'position', label: '岗位' },
    },
  ]),
})
