import type { ApprovalStatus } from '@/api/generated'
import type { BusinessObjectField } from '@/components/business-object'
import { maxLength } from '@/pages/bob/shared/config-helpers'
import { approvalStatusOptions, approvalStatusPresentation } from '@/shared/approval'
import { dclEmployeeActiveVersion, type DclEmployeeConfig, type DclEmployeeForm } from './types'

const fields: readonly BusinessObjectField<DclEmployeeForm>[] = [
  { key: 'code', label: '人员编码', type: 'readonly' },
  { key: 'kind', label: '身份类型', type: 'select', required: true, options: [{ title: '个人', value: 'PERSON' }, { title: '组织', value: 'ORGANIZATION' }] },
  { key: 'legalName', label: '法定名称', type: 'text', required: true, rules: [maxLength('法定名称', 200)] },
  { key: 'displayName', label: '显示名称', type: 'text', rules: [maxLength('显示名称', 200)] },
  { key: 'taxNumber', label: '税号', type: 'text', rules: [maxLength('税号', 64)] },
  { key: 'strongIdentifiers', label: '强标识', type: 'text', span: 2 },
  { key: 'currentOperatingEntityId', label: '任职经营主体', type: 'autocomplete', required: true, clearable: false },
  { key: 'employeeCategoryId', label: '人员类别', type: 'autocomplete' },
  { key: 'departmentId', label: '部门', type: 'autocomplete' },
  { key: 'positionId', label: '岗位', type: 'autocomplete' },
  { key: 'phone', label: '电话', type: 'text', rules: [maxLength('电话', 32)] },
  { key: 'email', label: '邮箱', type: 'text', rules: [maxLength('邮箱', 254)] },
  { key: 'hireDate', label: '入职日期', type: 'date' },
  { key: 'enabled', label: '启用', type: 'switch' },
  { key: 'remark', label: '备注', type: 'textarea', span: 2, rules: [maxLength('备注', 1000)] },
]
export const dclEmployeeConfig: DclEmployeeConfig = {
  title: '人员变更', fields,
  emptyForm: () => ({ code: '', kind: 'PERSON', legalName: '', displayName: '', taxNumber: '', strongIdentifiers: [], enabled: true, currentOperatingEntityId: '', employeeCategoryId: '', departmentId: '', positionId: '', phone: '', email: '', hireDate: '', remark: '' }),
  columns: [
    { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
    { key: 'name', label: '名称', value: (row) => row.displayName, sizing: 'fluid' },
    { key: 'operatingEntity', label: '任职经营主体', value: (row) => `${row.currentOperatingEntity.code} · ${row.currentOperatingEntity.name}` },
    { key: 'status', label: '状态', value: (row) => dclEmployeeActiveVersion(row).approval.status, format: (value) => approvalStatusPresentation[value as ApprovalStatus].label, sizing: 'compact' },
  ],
  filters: [
    { key: 'status', label: '状态', type: 'select', multiple: true, options: approvalStatusOptions },
    { key: 'enabled', label: '启停状态', type: 'select', options: [{ title: '启用', value: true }, { title: '禁用', value: false }] },
  ],
}
