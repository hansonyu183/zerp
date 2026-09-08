import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
import { summaryOption } from '../components/direct-page/references.ts'
export const warehousePage = defineDirectPage<api.TargetWarehouseCreateInput>({
  resource: 'aux/warehouse',
  fields: [
    { key: 'name', caption: '名称', type: 'text', required: true },
    { key: 'address', caption: '地址', type: 'text' },
    { key: 'contactName', caption: '联系人', type: 'text' },
    { key: 'contactPhone', caption: '联系电话', type: 'text' },
    {
      key: 'managerEmployeeId',
      caption: '仓库负责人',
      type: 'reference',
      source: 'employees',
    },
    { key: 'remark', caption: '备注', type: 'textarea' },
  ],
  adapter: {
    empty: () => ({
      name: '',
      address: '',
      contactName: '',
      contactPhone: '',
      managerEmployeeId: null,
      remark: '',
    }),
    query: api.queryTargetWarehouses,
    get: async (token, id) => {
      const row = await api.getTargetWarehouse(token, id)
      return {
        identity: row,
        values: {
          name: row.name,
          address: row.address,
          contactName: row.contactName,
          contactPhone: row.contactPhone,
          managerEmployeeId: row.manager?.id ?? null,
          remark: row.remark,
        },
        options: {
          managerEmployeeId: row.manager ? [summaryOption(row.manager)] : [],
        },
      }
    },
    create: api.createTargetWarehouse,
    save: (token, input, row) =>
      api.saveTargetWarehouse(token, {
        ...input,
        id: row.id,
        revision: row.revision,
      }),
    setEnabled: api.setTargetWarehouseEnabled,
    delete: api.deleteTargetWarehouse,
  },
})
