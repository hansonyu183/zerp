import {
  baseColumns,
  baseFilters,
  categoryFilter,
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
    categoryId: '',
    departmentId: '',
    positionId: '',
    phone: '',
    email: '',
    hireDate: '',
    remark: '',
  },
  requiredKeys: ['code', 'name'],
  uppercaseKeys: ['code'],
  references: {
    categoryId: {
      entity: 'category',
      label: '员工分类',
      filters: { targetEntity: 'employee' },
    },
    departmentId: { entity: 'department', label: '部门' },
    positionId: { entity: 'position', label: '岗位' },
  },
  fields: (context) => [
    ...commonFields(context, '员工编码', '员工姓名'),
    reference('categoryId', '员工分类', context),
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
    categoryFilter('employee'),
    {
      key: 'departmentId',
      label: '部门',
      type: 'autocomplete',
      reference: { entity: 'department', label: '部门' },
    },
    {
      key: 'positionId',
      label: '岗位',
      type: 'autocomplete',
      reference: { entity: 'position', label: '岗位' },
    },
  ]),
})
