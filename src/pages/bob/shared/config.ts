import type {
  BusinessObjectColumn,
  BusinessObjectField,
  BusinessObjectFieldOption,
} from '@/components/business-object'
import type {
  BobEntityConfig,
  BobFieldContext,
  BobFilterField,
  BobForm,
  BobListItem,
  BobStatus,
} from './types'

const statusText: Record<BobStatus, string> = {
  DRAFT: '草稿',
  PENDING: '待审核',
  REJECTED: '已驳回',
  EFFECTIVE: '有效',
  INVALID: '已失效',
}

export const statusOptions: readonly BusinessObjectFieldOption[] = [
  { title: '草稿', value: 'DRAFT' },
  { title: '待审核', value: 'PENDING' },
  { title: '已驳回', value: 'REJECTED' },
  { title: '有效', value: 'EFFECTIVE' },
  { title: '已失效', value: 'INVALID' },
]

const supplierTypeOptions: readonly BusinessObjectFieldOption[] = [
  { title: '普通供应商', value: 'GENERAL' },
  { title: '物流平台', value: 'LOGISTICS_PLATFORM' },
]

const settlementRuleOptions: readonly BusinessObjectFieldOption[] = [
  { title: '相对天数', value: 'RELATIVE_DAYS' },
  { title: '月末', value: 'MONTH_END' },
  { title: '指定日', value: 'FIXED_DAY' },
]

const targetEntityOptions: readonly BusinessObjectFieldOption[] = [
  { title: '客户', value: 'customer' },
  { title: '供应商', value: 'supplier' },
  { title: '员工', value: 'employee' },
  { title: '产品', value: 'product' },
  { title: '服务', value: 'service' },
  { title: '仓库', value: 'warehouse' },
  { title: '车辆', value: 'vehicle' },
  { title: '资金账户', value: 'fund-account' },
  { title: '部门', value: 'department' },
  { title: '岗位', value: 'position' },
]

const codePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const phonePattern = /^[+0-9() -]+$/
const emailPattern = /^[^@\s]+@[^@\s]+$/
const taxNumberPattern = /^[A-Za-z0-9-]+$/
const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/
const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/

function lengthOf(value: unknown): number {
  return typeof value === 'string' ? Array.from(value).length : 0
}

function maxLength(label: string, maximum: number) {
  return (value: unknown): true | string =>
    lengthOf(value) <= maximum || `${label}不能超过 ${maximum} 个字符。`
}

function patternRule(pattern: RegExp, message: string) {
  return (value: unknown): true | string => {
    if (typeof value !== 'string' || value.trim() === '') return true
    return pattern.test(value.trim()) || message
  }
}

function commonFields(
  context: BobFieldContext,
  codeLabel: string,
  nameLabel: string,
): BusinessObjectField<BobForm>[] {
  return [
    {
      key: 'code',
      label: codeLabel,
      type: 'text',
      required: true,
      readonly: context.mode !== 'create',
      rules: [patternRule(codePattern, '编码格式不正确。')],
    },
    {
      key: 'name',
      label: nameLabel,
      type: 'text',
      required: true,
      rules: [maxLength(nameLabel, 200)],
    },
  ]
}

function text(
  key: string,
  label: string,
  maximum?: number,
  options: Partial<BusinessObjectField<BobForm>> = {},
): BusinessObjectField<BobForm> {
  return {
    key,
    label,
    type: 'text',
    ...options,
    ...(maximum
      ? { rules: [...(options.rules ?? []), maxLength(label, maximum)] }
      : {}),
  }
}

function textarea(
  key: string,
  label: string,
  maximum = 1000,
): BusinessObjectField<BobForm> {
  return {
    key,
    label,
    type: 'textarea',
    span: 2,
    rules: [maxLength(label, maximum)],
  }
}

function reference(
  key: string,
  label: string,
  context: BobFieldContext,
  required = false,
): BusinessObjectField<BobForm> {
  const error = context.referenceErrors[key]
  return {
    key,
    label,
    type: 'autocomplete',
    required,
    clearable: !required,
    disabled: Boolean(error),
    loading: context.referenceLoading[key],
    options: context.referenceOptions[key] ?? [],
    ...(error ? { hint: error } : {}),
  }
}

function baseFilters(extra: readonly BobFilterField[] = []): BobFilterField[] {
  return [
    {
      key: 'status',
      label: '状态',
      type: 'select',
      multiple: true,
      options: statusOptions,
    },
    ...extra,
  ]
}

function baseColumns(
  codeLabel: string,
  nameLabel: string,
  extra: readonly BusinessObjectColumn<BobListItem>[] = [],
): readonly BusinessObjectColumn<BobListItem>[] {
  return [
    { key: 'code', label: codeLabel, value: (row) => row.code },
    {
      key: 'name',
      label: nameLabel,
      value: (row) => row.currentVersion.summary.name,
    },
    ...extra,
    {
      key: 'status',
      label: '状态',
      value: (row) => row.currentVersion.status,
      format: (value) => statusText[value as BobStatus] ?? String(value),
    },
  ]
}

function emptyForm(values: Record<string, unknown>): BobForm {
  return { code: '', name: '', ...values }
}

const categoryFilter = (entity: string): BobFilterField => ({
  key: 'categoryId',
  label: '分类',
  type: 'autocomplete',
  reference: {
    entity: 'category',
    label: '分类',
    filters: { targetEntity: entity },
  },
})

export const bobEntityConfigs: Readonly<Record<string, BobEntityConfig>> = {
  supplier: {
    entity: 'supplier',
    title: '供应商',
    codeLabel: '供应商编码',
    nameLabel: '供应商名称',
    emptyForm: () => emptyForm({
      supplierType: 'GENERAL',
      shortName: '',
      categoryId: '',
      settlementMethodId: '',
      salespersonEmployeeId: '',
      taxNumber: '',
      contactName: '',
      contactPhone: '',
      email: '',
      address: '',
      remark: '',
    }),
    detailKeys: [
      'name', 'supplierType', 'shortName', 'categoryId', 'settlementMethodId',
      'salespersonEmployeeId', 'taxNumber', 'contactName', 'contactPhone',
      'email', 'address', 'remark',
    ],
    requiredKeys: ['code', 'name', 'supplierType', 'salespersonEmployeeId'],
    uppercaseKeys: ['code', 'taxNumber'],
    references: {
      categoryId: {
        entity: 'category',
        label: '供应商分类',
        filters: { targetEntity: 'supplier' },
      },
      settlementMethodId: {
        entity: 'settlement-method',
        label: '结算方式',
      },
      salespersonEmployeeId: {
        entity: 'employee',
        label: '业务员',
      },
    },
    fields: (context) => [
      ...commonFields(context, '供应商编码', '供应商名称'),
      {
        key: 'supplierType',
        label: '供应商类型',
        type: 'select',
        required: true,
        options: supplierTypeOptions,
      },
      text('shortName', '供应商简称', 100),
      reference('categoryId', '供应商分类', context),
      reference('settlementMethodId', '结算方式', context),
      reference('salespersonEmployeeId', '业务员', context, true),
      text('taxNumber', '税号', 50, {
        rules: [patternRule(taxNumberPattern, '税号只能包含字母、数字和连字符。')],
      }),
      text('contactName', '联系人', 100),
      text('contactPhone', '联系电话', 32, {
        rules: [patternRule(phonePattern, '联系电话格式不正确。')],
      }),
      text('email', '邮箱', 254, {
        rules: [patternRule(emailPattern, '邮箱格式不正确。')],
      }),
      textarea('address', '地址', 500),
      textarea('remark', '备注'),
    ],
    columns: baseColumns('供应商编码', '供应商名称', [
      {
        key: 'supplierType',
        label: '供应商类型',
        value: (row) => row.currentVersion.summary.supplierType,
        format: (value) =>
          supplierTypeOptions.find((item) => item.value === value)?.title ??
          String(value),
      },
      {
        key: 'shortName',
        label: '简称',
        value: (row) => row.currentVersion.summary.shortName,
      },
    ]),
    filters: baseFilters([
      {
        key: 'supplierType',
        label: '供应商类型',
        type: 'select',
        options: supplierTypeOptions,
      },
      categoryFilter('supplier'),
    ]),
  },
  employee: {
    entity: 'employee',
    title: '员工',
    codeLabel: '员工编码',
    nameLabel: '员工姓名',
    emptyForm: () => emptyForm({
      categoryId: '',
      departmentId: '',
      positionId: '',
      phone: '',
      email: '',
      hireDate: '',
      remark: '',
    }),
    detailKeys: [
      'name', 'categoryId', 'departmentId', 'positionId', 'phone', 'email',
      'hireDate', 'remark',
    ],
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
    columns: baseColumns('员工编码', '员工姓名', [
      {
        key: 'phone',
        label: '联系电话',
        value: (row) => row.currentVersion.summary.phone,
      },
      {
        key: 'hireDate',
        label: '入职日期',
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
  },
  product: {
    entity: 'product',
    title: '产品',
    codeLabel: '产品编码',
    nameLabel: '产品名称',
    emptyForm: () => emptyForm({
      unit: '',
      categoryId: '',
      specification: '',
      model: '',
      barcode: '',
      remark: '',
    }),
    detailKeys: [
      'name', 'unit', 'categoryId', 'specification', 'model', 'barcode', 'remark',
    ],
    requiredKeys: ['code', 'name', 'unit'],
    uppercaseKeys: ['code', 'barcode'],
    references: {
      categoryId: {
        entity: 'category',
        label: '产品分类',
        filters: { targetEntity: 'product' },
      },
    },
    fields: (context) => [
      ...commonFields(context, '产品编码', '产品名称'),
      text('unit', '单位', 32, { required: true }),
      reference('categoryId', '产品分类', context),
      text('specification', '规格', 200),
      text('model', '型号', 200),
      text('barcode', '条码', 64),
      textarea('remark', '备注'),
    ],
    columns: baseColumns('产品编码', '产品名称', [
      { key: 'unit', label: '单位', value: (row) => row.currentVersion.summary.unit },
      { key: 'model', label: '型号', value: (row) => row.currentVersion.summary.model },
    ]),
    filters: baseFilters([categoryFilter('product')]),
  },
  service: {
    entity: 'service',
    title: '服务',
    codeLabel: '服务编码',
    nameLabel: '服务名称',
    emptyForm: () => emptyForm({
      unit: '',
      categoryId: '',
      description: '',
      remark: '',
    }),
    detailKeys: ['name', 'unit', 'categoryId', 'description', 'remark'],
    requiredKeys: ['code', 'name', 'unit'],
    uppercaseKeys: ['code'],
    references: {
      categoryId: {
        entity: 'category',
        label: '服务分类',
        filters: { targetEntity: 'service' },
      },
    },
    fields: (context) => [
      ...commonFields(context, '服务编码', '服务名称'),
      text('unit', '单位', 32, { required: true }),
      reference('categoryId', '服务分类', context),
      textarea('description', '服务说明'),
      textarea('remark', '备注'),
    ],
    columns: baseColumns('服务编码', '服务名称', [
      { key: 'unit', label: '单位', value: (row) => row.currentVersion.summary.unit },
      {
        key: 'description',
        label: '说明',
        value: (row) => row.currentVersion.summary.description,
      },
    ]),
    filters: baseFilters([categoryFilter('service')]),
  },
  warehouse: {
    entity: 'warehouse',
    title: '仓库',
    codeLabel: '仓库编码',
    nameLabel: '仓库名称',
    emptyForm: () => emptyForm({
      categoryId: '',
      address: '',
      contactName: '',
      contactPhone: '',
      managerEmployeeId: '',
      remark: '',
    }),
    detailKeys: [
      'name', 'categoryId', 'address', 'contactName', 'contactPhone',
      'managerEmployeeId', 'remark',
    ],
    requiredKeys: ['code', 'name'],
    uppercaseKeys: ['code'],
    references: {
      categoryId: {
        entity: 'category',
        label: '仓库分类',
        filters: { targetEntity: 'warehouse' },
      },
      managerEmployeeId: { entity: 'employee', label: '管理员工' },
    },
    fields: (context) => [
      ...commonFields(context, '仓库编码', '仓库名称'),
      reference('categoryId', '仓库分类', context),
      reference('managerEmployeeId', '管理员工', context),
      textarea('address', '地址', 500),
      text('contactName', '联系人', 100),
      text('contactPhone', '联系电话', 32, {
        rules: [patternRule(phonePattern, '联系电话格式不正确。')],
      }),
      textarea('remark', '备注'),
    ],
    columns: baseColumns('仓库编码', '仓库名称', [
      {
        key: 'address',
        label: '地址',
        value: (row) => row.currentVersion.summary.address,
      },
      {
        key: 'contactName',
        label: '联系人',
        value: (row) => row.currentVersion.summary.contactName,
      },
    ]),
    filters: baseFilters([categoryFilter('warehouse')]),
  },
  vehicle: {
    entity: 'vehicle',
    title: '车辆',
    codeLabel: '车辆编码',
    nameLabel: '车辆名称',
    emptyForm: () => emptyForm({
      plateNumber: '',
      vehicleType: '',
      platformObjectId: '',
      categoryId: '',
      vin: '',
      engineNumber: '',
      loadCapacityKg: '',
      remark: '',
    }),
    detailKeys: [
      'name', 'plateNumber', 'vehicleType', 'platformObjectId', 'categoryId',
      'vin', 'engineNumber', 'loadCapacityKg', 'remark',
    ],
    requiredKeys: [
      'code', 'name', 'plateNumber', 'vehicleType', 'platformObjectId',
    ],
    uppercaseKeys: ['code', 'plateNumber', 'vin'],
    references: {
      platformObjectId: {
        entity: 'supplier',
        label: '物流平台',
        filters: { supplierType: 'LOGISTICS_PLATFORM' },
      },
      categoryId: {
        entity: 'category',
        label: '车辆分类',
        filters: { targetEntity: 'vehicle' },
      },
    },
    fields: (context) => [
      ...commonFields(context, '车辆编码', '车辆名称'),
      text('plateNumber', '车牌号', 32, { required: true }),
      text('vehicleType', '车辆类型', 64, { required: true }),
      reference('platformObjectId', '物流平台', context, true),
      reference('categoryId', '车辆分类', context),
      text('vin', 'VIN', 17, {
        rules: [patternRule(vinPattern, 'VIN 必须是排除 I、O、Q 的 17 位编码。')],
      }),
      text('engineNumber', '发动机号', 64),
      text('loadCapacityKg', '载重（kg）', undefined, {
        rules: [
          patternRule(decimalPattern, '载重必须是大于零且最多三位小数的数值。'),
          (value) => value === '' || Number(value) > 0 || '载重必须大于零。',
        ],
      }),
      textarea('remark', '备注'),
    ],
    columns: baseColumns('车辆编码', '车辆名称', [
      {
        key: 'plateNumber',
        label: '车牌号',
        value: (row) => row.currentVersion.summary.plateNumber,
      },
      {
        key: 'vehicleType',
        label: '车辆类型',
        value: (row) => row.currentVersion.summary.vehicleType,
      },
    ]),
    filters: baseFilters([categoryFilter('vehicle')]),
  },
  'fund-account': {
    entity: 'fund-account',
    title: '资金账户',
    codeLabel: '账户编码',
    nameLabel: '账户名称',
    emptyForm: () => emptyForm({
      currency: 'CNY',
      categoryId: '',
      accountName: '',
      bankName: '',
      bankBranch: '',
      accountNumber: '',
      remark: '',
    }),
    detailKeys: [
      'name', 'currency', 'categoryId', 'accountName', 'bankName', 'bankBranch',
      'accountNumber', 'remark',
    ],
    requiredKeys: ['code', 'name', 'currency'],
    uppercaseKeys: ['code', 'currency', 'accountNumber'],
    references: {
      categoryId: {
        entity: 'category',
        label: '账户分类',
        filters: { targetEntity: 'fund-account' },
      },
    },
    fields: (context) => [
      ...commonFields(context, '账户编码', '账户名称'),
      text('currency', '币种', 3, {
        required: true,
        rules: [patternRule(/^[A-Za-z]{3}$/, '币种必须是三位字母。')],
      }),
      reference('categoryId', '账户分类', context),
      text('accountName', '户名', 200),
      text('bankName', '银行', 200),
      text('bankBranch', '支行', 200),
      text('accountNumber', '账号', 200),
      textarea('remark', '备注'),
    ],
    columns: baseColumns('账户编码', '账户名称', [
      {
        key: 'currency',
        label: '币种',
        value: (row) => row.currentVersion.summary.currency,
      },
      {
        key: 'bankName',
        label: '银行',
        value: (row) => row.currentVersion.summary.bankName,
      },
    ]),
    filters: baseFilters([
      categoryFilter('fund-account'),
      { key: 'currency', label: '币种', type: 'text' },
    ]),
  },
  category: {
    entity: 'category',
    title: '分类',
    codeLabel: '分类编码',
    nameLabel: '分类名称',
    emptyForm: () => emptyForm({
      targetEntity: 'product',
      parentId: '',
      description: '',
    }),
    detailKeys: ['name', 'targetEntity', 'parentId', 'description'],
    requiredKeys: ['code', 'name', 'targetEntity'],
    uppercaseKeys: ['code'],
    references: {
      parentId: {
        entity: 'category',
        label: '父分类',
        filters: (form) => ({ targetEntity: form.targetEntity }),
      },
    },
    fields: (context) => [
      ...commonFields(context, '分类编码', '分类名称'),
      {
        key: 'targetEntity',
        label: '适用实体',
        type: 'select',
        required: true,
        options: targetEntityOptions,
        onChange: () => ({ parentId: '' }),
      },
      reference('parentId', '父分类', context),
      textarea('description', '说明'),
    ],
    columns: baseColumns('分类编码', '分类名称', [
      {
        key: 'targetEntity',
        label: '适用实体',
        value: (row) => row.currentVersion.summary.targetEntity,
        format: (value) =>
          targetEntityOptions.find((item) => item.value === value)?.title ??
          String(value),
      },
    ]),
    filters: baseFilters([
      {
        key: 'targetEntity',
        label: '适用实体',
        type: 'select',
        options: targetEntityOptions,
      },
      {
        key: 'parentId',
        label: '父分类',
        type: 'autocomplete',
        reference: { entity: 'category', label: '父分类' },
      },
      { key: 'rootOnly', label: '只看根节点', type: 'switch' },
    ]),
  },
  department: {
    entity: 'department',
    title: '部门',
    codeLabel: '部门编码',
    nameLabel: '部门名称',
    emptyForm: () => emptyForm({
      categoryId: '',
      parentId: '',
      description: '',
    }),
    detailKeys: ['name', 'categoryId', 'parentId', 'description'],
    requiredKeys: ['code', 'name'],
    uppercaseKeys: ['code'],
    references: {
      categoryId: {
        entity: 'category',
        label: '部门分类',
        filters: { targetEntity: 'department' },
      },
      parentId: { entity: 'department', label: '父部门' },
    },
    fields: (context) => [
      ...commonFields(context, '部门编码', '部门名称'),
      reference('categoryId', '部门分类', context),
      reference('parentId', '父部门', context),
      textarea('description', '说明'),
    ],
    columns: baseColumns('部门编码', '部门名称'),
    filters: baseFilters([
      categoryFilter('department'),
      {
        key: 'parentId',
        label: '父部门',
        type: 'autocomplete',
        reference: { entity: 'department', label: '父部门' },
      },
      { key: 'rootOnly', label: '只看根节点', type: 'switch' },
    ]),
  },
  position: {
    entity: 'position',
    title: '岗位',
    codeLabel: '岗位编码',
    nameLabel: '岗位名称',
    emptyForm: () => emptyForm({ categoryId: '', description: '' }),
    detailKeys: ['name', 'categoryId', 'description'],
    requiredKeys: ['code', 'name'],
    uppercaseKeys: ['code'],
    references: {
      categoryId: {
        entity: 'category',
        label: '岗位分类',
        filters: { targetEntity: 'position' },
      },
    },
    fields: (context) => [
      ...commonFields(context, '岗位编码', '岗位名称'),
      reference('categoryId', '岗位分类', context),
      textarea('description', '说明'),
    ],
    columns: baseColumns('岗位编码', '岗位名称'),
    filters: baseFilters([categoryFilter('position')]),
  },
  'settlement-method': {
    entity: 'settlement-method',
    title: '结算方式',
    codeLabel: '结算方式编码',
    nameLabel: '结算方式名称',
    emptyForm: () => emptyForm({
      ruleType: 'RELATIVE_DAYS',
      monthOffset: 0,
      dayOfMonth: null,
      dayOffset: 0,
      description: '',
    }),
    detailKeys: [
      'name', 'ruleType', 'monthOffset', 'dayOfMonth', 'dayOffset', 'description',
    ],
    requiredKeys: ['code', 'name', 'ruleType'],
    uppercaseKeys: ['code'],
    fields: (context) => [
      ...commonFields(context, '结算方式编码', '结算方式名称'),
      {
        key: 'ruleType',
        label: '规则类型',
        type: 'select',
        required: true,
        options: settlementRuleOptions,
        onChange: (value) => {
          if (value === 'RELATIVE_DAYS') {
            return { monthOffset: 0, dayOfMonth: null }
          }
          if (value === 'MONTH_END') return { dayOfMonth: null }
          if (value === 'FIXED_DAY') return { dayOfMonth: 1 }
        },
      },
      {
        key: 'monthOffset',
        label: '月偏移',
        type: 'number',
        min: 0,
        max: 120,
        step: 1,
        visible: (form) => form.ruleType !== 'RELATIVE_DAYS',
      },
      {
        key: 'dayOfMonth',
        label: '指定日',
        type: 'number',
        required: true,
        min: 1,
        max: 31,
        step: 1,
        visible: (form) => form.ruleType === 'FIXED_DAY',
      },
      {
        key: 'dayOffset',
        label: '日偏移',
        type: 'number',
        min: -3650,
        max: 3650,
        step: 1,
      },
      textarea('description', '说明'),
    ],
    columns: baseColumns('结算方式编码', '结算方式名称', [
      {
        key: 'ruleType',
        label: '规则类型',
        value: (row) => row.currentVersion.summary.ruleType,
        format: (value) =>
          settlementRuleOptions.find((item) => item.value === value)?.title ??
          String(value),
      },
    ]),
    filters: baseFilters(),
  },
}

export function getBobEntityConfig(entity: string): BobEntityConfig {
  const config = bobEntityConfigs[entity]
  if (!config) throw new Error(`未注册 BOB 实体配置：${entity}`)
  return config
}

export function getStatusText(status?: BobStatus): string {
  return status ? statusText[status] ?? status : '未标记'
}
