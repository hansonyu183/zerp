import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
import { summaryOption } from '../components/direct-page/references.ts'
export const employeePage = defineDirectPage<api.TargetEmployeeCreateInput>({
  resource: 'aux/employee',
  fields: [
    {
      key: 'identityKind',
      caption: '身份类型',
      type: 'enum',
      options: [
        { value: 'PERSON', caption: '个人' },
        { value: 'ORGANIZATION', caption: '组织' },
      ],
    },
    { key: 'legalName', caption: '法定名称', type: 'text', required: true },
    { key: 'displayName', caption: '显示名称', type: 'text', required: true },
    {
      key: 'legalIdentifier',
      caption: '法定标识',
      type: 'text',
      required: true,
    },
    {
      key: 'operatingEntityId',
      caption: '任职经营主体',
      type: 'reference',
      required: true,
      source: 'operating-entities',
    },
    {
      key: 'employeeCategoryId',
      caption: '员工分类',
      type: 'reference',
      required: true,
      source: 'employee-categories',
    },
    {
      key: 'departmentId',
      caption: '部门',
      type: 'reference',
      required: true,
      source: 'departments',
    },
    {
      key: 'positionId',
      caption: '岗位',
      type: 'reference',
      required: true,
      source: 'positions',
    },
    {
      key: 'employmentDate',
      caption: '入职日期',
      type: 'date',
      required: true,
    },
    { key: 'contactName', caption: '联系人', type: 'text' },
    { key: 'phone', caption: '联系电话', type: 'text' },
    { key: 'address', caption: '地址', type: 'text' },
    { key: 'workPhone', caption: '工作电话', type: 'text' },
    { key: 'workEmail', caption: '工作邮箱', type: 'text' },
    { key: 'remark', caption: '备注', type: 'textarea' },
  ],
  adapter: {
    empty: () => ({
      identityKind: 'PERSON',
      legalName: '',
      displayName: '',
      legalIdentifier: '',
      operatingEntityId: '',
      employeeCategoryId: '',
      departmentId: '',
      positionId: '',
      employmentDate: '',
      contactName: '',
      phone: '',
      address: '',
      workPhone: '',
      workEmail: '',
      remark: '',
    }),
    query: api.queryTargetEmployees,
    get: async (token, id) => {
      const row = await api.getTargetEmployee(token, id)
      return {
        identity: row,
        values: {
          identityKind: row.identityKind,
          legalName: row.legalName,
          displayName: row.displayName,
          legalIdentifier: row.legalIdentifier,
          operatingEntityId: row.operatingEntity.id,
          employeeCategoryId: row.employeeCategory.id,
          departmentId: row.department.id,
          positionId: row.position.id,
          employmentDate: row.employmentDate,
          contactName: row.contactName,
          phone: row.phone,
          address: row.address,
          workPhone: row.workPhone,
          workEmail: row.workEmail,
          remark: row.remark,
        },
        options: {
          operatingEntityId: [summaryOption(row.operatingEntity)],
          employeeCategoryId: [summaryOption(row.employeeCategory)],
          departmentId: [summaryOption(row.department)],
          positionId: [summaryOption(row.position)],
        },
      }
    },
    create: api.createTargetEmployee,
    save: (token, input, row) =>
      api.saveTargetEmployee(token, {
        ...input,
        id: row.id,
        revision: row.revision,
      }),
    setEnabled: api.setTargetEmployeeEnabled,
  },
})
