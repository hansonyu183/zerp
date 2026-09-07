import { defineListPage } from '../components/list-page/definition.ts'
import type { UserListItem } from '../pages/app/user/vm.ts'
import type { RoleListItem } from '../pages/app/role/vm.ts'
import { roleTypeOptions } from '../pages/app/role/presentation.ts'
import type {
  EmployeeCategoryListItem,
  PositionListItem,
} from '../pages/aux/simple/vm.ts'
import type { MeasurementUnitListItem } from '../pages/aux/measurement-unit/vm.ts'
import type { PaymentMethodListItem } from '../pages/aux/payment-method/vm.ts'
import type { AssetCategoryListItem } from '../pages/aux/asset-category/vm.ts'

const identityColumns = [
  { key: 'code', type: 'text', caption: '编码' },
  { key: 'name', type: 'text', caption: '名称' },
  {
    key: 'enabled',
    type: 'boolean',
    caption: '状态',
    trueCaption: '启用',
    falseCaption: '停用',
  },
] as const
const actionsColumn = {
  key: '$actions',
  type: 'actions',
  caption: '操作',
} as const
const keywordFilter = {
  key: 'keyword',
  type: 'text',
  caption: '编码、拼音或名称',
} as const
const baseColumns = [...identityColumns, actionsColumn] as const
const baseFilters = [keywordFilter] as const

export const userListPage = defineListPage<UserListItem>({
  title: '用户管理',
  createLabel: '新增用户',
  columns: baseColumns,
  filters: baseFilters,
})
export const roleListPage = defineListPage<RoleListItem>({
  title: '角色管理',
  createLabel: '新增角色',
  columns: [
    ...identityColumns,
    {
      key: 'type',
      type: 'enum',
      caption: '角色类型',
      options: roleTypeOptions,
    },
    actionsColumn,
  ],
  filters: baseFilters,
})
export const employeeCategoryListPage =
  defineListPage<EmployeeCategoryListItem>({
    title: '员工分类',
    createLabel: '新增员工分类',
    columns: baseColumns,
    filters: baseFilters,
  })
export const positionListPage = defineListPage<PositionListItem>({
  title: '岗位',
  createLabel: '新增岗位',
  columns: baseColumns,
  filters: baseFilters,
})
export type MeasurementUnitFilters = {
  keyword: string
  quantityScale: number | null
}
export const measurementUnitListPage = defineListPage<
  MeasurementUnitListItem,
  MeasurementUnitFilters
>({
  title: '计量单位',
  createLabel: '新增计量单位',
  columns: [
    ...identityColumns,
    { key: 'symbol', type: 'text', caption: '符号' },
    { key: 'quantityScale', type: 'integer', caption: '数量精度' },
    actionsColumn,
  ],
  filters: [
    keywordFilter,
    { key: 'quantityScale', type: 'integer', caption: '数量精度' },
  ],
})
export const paymentMethodListPage = defineListPage<PaymentMethodListItem>({
  title: '收款方式',
  createLabel: '新增收款方式',
  columns: baseColumns,
  filters: baseFilters,
})
export const assetCategoryListPage = defineListPage<AssetCategoryListItem>({
  title: '资产类别',
  createLabel: '新增资产类别',
  columns: baseColumns,
  filters: baseFilters,
})
