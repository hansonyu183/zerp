import { defineBobEntityConfig, textarea } from '../shared/config-helpers'
import { bobListActiveVersion } from '../shared/types'

export const employeeConfig = defineBobEntityConfig({
  entity: 'employee',
  title: '员工（当前档案）',
  codeLabel: '人员编码',
  nameLabel: '主体名称',
  defaults: {
    objectId: '',
    approvalEntryId: '',
    operatingEntityName: '',
    employeeCategoryName: '',
    departmentName: '',
    positionName: '',
    phone: '',
    email: '',
    hireDate: '',
    remark: '',
  },
  fields: () => [
    { key: 'objectId', label: 'Stable ID', type: 'readonly' },
    {
      key: 'approvalEntryId',
      label: '来源 Approval Entry ID',
      type: 'readonly',
    },
    { key: 'code', label: '人员编码', type: 'readonly' },
    { key: 'name', label: '主体名称', type: 'readonly' },
    { key: 'operatingEntityName', label: '经营主体', type: 'readonly' },
    { key: 'employeeCategoryName', label: '人员类别', type: 'readonly' },
    { key: 'departmentName', label: '部门', type: 'readonly' },
    { key: 'positionName', label: '岗位', type: 'readonly' },
    { key: 'phone', label: '电话', type: 'readonly' },
    { key: 'email', label: '邮箱', type: 'readonly' },
    { key: 'hireDate', label: '入职日期', type: 'readonly' },
    textarea('remark', '备注'),
  ],
  columns: [
    { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
    {
      key: 'name',
      label: '主体',
      value: (row) => bobListActiveVersion(row).summary.name,
      sizing: 'fluid',
    },
    {
      key: 'operatingEntity',
      label: '经营主体',
      value: (row) =>
        bobListActiveVersion(row).summary.operatingEntityName ?? '—',
    },
    {
      key: 'employeeCategory',
      label: '人员类别',
      value: (row) =>
        bobListActiveVersion(row).summary.employeeCategoryName ?? '—',
    },
    {
      key: 'department',
      label: '部门',
      value: (row) => bobListActiveVersion(row).summary.departmentName ?? '—',
    },
    {
      key: 'position',
      label: '岗位',
      value: (row) => bobListActiveVersion(row).summary.positionName ?? '—',
    },
    {
      key: 'enabled',
      label: '启停状态',
      value: (row) => (row.enabled ? '启用' : '禁用'),
      sizing: 'compact',
    },
  ],
  filters: [
    {
      key: 'enabled',
      label: '启停状态',
      type: 'select',
      options: [
        { title: '启用', value: true },
        { title: '禁用', value: false },
      ],
    },
  ],
})
