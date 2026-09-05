import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as targetApi from '@/target/api.ts'
import { auxEntityConfigs } from '@/target/pages/aux/shared/config.ts'
import { useAuxMaintenanceViewModel } from '@/target/pages/aux/shared/vm.ts'
import { useTargetSession } from '@/target/session/vm.ts'

vi.mock('@/target/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/target/api.ts')>()),
  createTargetAux: vi.fn(),
  deleteTargetAux: vi.fn(),
  getTargetAux: vi.fn(),
  queryTargetAux: vi.fn(),
  saveTargetAux: vi.fn(),
  setTargetAuxEnabled: vi.fn(),
}))

const sampleData = {
  'product-category': { name: '原料', parentId: '', description: '' },
  'product-type': {
    name: '标准成品',
    behaviorProfile: 'STANDARD_FINISHED',
    description: '',
  },
  'employee-category': { name: '正式员工', description: '' },
  department: { name: '采购部', parentId: '', description: '' },
  position: { name: '采购员', description: '' },
  'settlement-method': {
    name: '预付',
    termCode: 'PREPAID',
    ruleType: 'RELATIVE_DAYS',
    monthOffset: 0,
    dayOfMonth: 0,
    dayOffset: 0,
    defaultSalesSurcharge: '0.00',
    description: '',
  },
  'payment-method': {
    name: '银行转账',
    defaultSalesSurcharge: '0.00',
    description: '',
  },
  'dictionary-type': { name: '车辆类型', description: '' },
  'dictionary-item': {
    name: '货车',
    dictionaryTypeId: '01J00000000000000000000001',
    sortOrder: 10,
    dictionaryTypeCode: 'DCT-0001',
    dictionaryTypeName: '车辆类型',
  },
  'measurement-unit': { name: '千克', symbol: 'kg', quantityScale: 3 },
  'income-expense-type': {
    name: '销售收入',
    direction: 'INCOME',
    parentId: '',
    description: '',
  },
  'asset-category': {
    name: '运输设备',
    defaultUsefulLifeMonths: 120,
    defaultResidualRate: '5.00',
    description: '',
  },
} satisfies Record<targetApi.TargetAuxEntity, Record<string, unknown>>

describe('AUX direct-CRUD public view-model seam', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    useTargetSession().csrfToken = 'csrf-token'
    vi.mocked(targetApi.queryTargetAux).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    })
  })

  it('preserves every entity-specific field and relationship', () => {
    expect(
      Object.fromEntries(
        Object.entries(auxEntityConfigs).map(([entity, config]) => [
          entity,
          config.fields.map((field) => field.key),
        ]),
      ),
    ).toEqual({
      'product-category': ['name', 'parentId', 'description'],
      'product-type': ['name', 'behaviorProfile', 'description'],
      'employee-category': ['name', 'description'],
      department: ['name', 'parentId', 'description'],
      position: ['name', 'description'],
      'settlement-method': [
        'name',
        'termCode',
        'ruleType',
        'monthOffset',
        'dayOfMonth',
        'dayOffset',
        'defaultSalesSurcharge',
        'description',
      ],
      'payment-method': ['name', 'defaultSalesSurcharge', 'description'],
      'dictionary-type': ['name', 'description'],
      'dictionary-item': ['name', 'dictionaryTypeId', 'sortOrder'],
      'measurement-unit': ['name', 'symbol', 'quantityScale'],
      'income-expense-type': ['name', 'direction', 'parentId', 'description'],
      'asset-category': [
        'name',
        'defaultUsefulLifeMonths',
        'defaultResidualRate',
        'description',
      ],
    })
    expect(
      auxEntityConfigs['dictionary-item'].fields.find(
        (field) => field.key === 'dictionaryTypeId',
      )?.relationEntity,
    ).toBe('dictionary-type')
    expect(
      auxEntityConfigs['income-expense-type'].fields.find(
        (field) => field.key === 'parentId',
      )?.relationEntity,
    ).toBe('income-expense-type')
    expect(auxEntityConfigs['settlement-method'].canCreate).toBe(false)
    expect(auxEntityConfigs['settlement-method'].canDelete).toBe(false)
  })

  it('ignores an older query response that completes after a newer request', async () => {
    let resolveFirst!: (
      value: Awaited<ReturnType<typeof targetApi.queryTargetAux>>,
    ) => void
    let resolveSecond!: (
      value: Awaited<ReturnType<typeof targetApi.queryTargetAux>>,
    ) => void
    vi.mocked(targetApi.queryTargetAux)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve
        }),
      )
    const vm = useAuxMaintenanceViewModel('position')

    const first = vm.query(1)
    const second = vm.query(2)
    resolveSecond({
      items: [
        {
          objectId: '01J00000000000000000000022',
          entity: 'position',
          code: 'POS-0022',
          enabled: true,
          objectRevision: '1',
          data: { name: '新结果' },
          updatedAt: '2026-09-05T00:02:00.000Z',
          updatedBy: 'user-1',
        },
      ],
      total: 21,
      page: 2,
      pageSize: 20,
    })
    await second
    resolveFirst({
      items: [
        {
          objectId: '01J00000000000000000000001',
          entity: 'position',
          code: 'POS-0001',
          enabled: true,
          objectRevision: '1',
          data: { name: '旧结果' },
          updatedAt: '2026-09-05T00:01:00.000Z',
          updatedBy: 'user-1',
        },
      ],
      total: 21,
      page: 1,
      pageSize: 20,
    })
    await first

    expect(vm.items.value[0]?.data.name).toBe('新结果')
    expect(vm.page.value).toBe(2)
    expect(vm.loading.value).toBe(false)
  })

  it('keeps settlement due-date facts complete and unchanged when saving the editable surcharge', async () => {
    vi.mocked(targetApi.getTargetAux)
      .mockResolvedValueOnce({
        objectId: '01J00000000000000000000003',
        entity: 'settlement-method',
        code: 'STM-0001',
        enabled: true,
        objectRevision: '1',
        data: sampleData['settlement-method'],
        updatedAt: '2026-09-05T00:00:00.000Z',
        updatedBy: 'user-1',
      })
      .mockResolvedValueOnce({
        objectId: '01J00000000000000000000003',
        entity: 'settlement-method',
        code: 'STM-0001',
        enabled: true,
        objectRevision: '2',
        data: {
          ...sampleData['settlement-method'],
          defaultSalesSurcharge: '0.10',
        },
        updatedAt: '2026-09-05T00:01:00.000Z',
        updatedBy: 'user-1',
      })
    vi.mocked(targetApi.saveTargetAux).mockResolvedValue({
      objectId: '01J00000000000000000000003',
      objectRevision: '2',
      enabled: true,
    })
    const vm = useAuxMaintenanceViewModel('settlement-method')
    await vm.openEdit('01J00000000000000000000003')
    vm.editorData.defaultSalesSurcharge = '0.10'
    await vm.save()

    expect(targetApi.saveTargetAux).toHaveBeenCalledWith(
      'csrf-token',
      'settlement-method',
      {
        objectId: '01J00000000000000000000003',
        objectRevision: 1,
        data: {
          ...sampleData['settlement-method'],
          defaultSalesSurcharge: '0.10',
        },
      },
    )
  })

  for (const entity of targetApi.targetAuxEntities) {
    it(`${entity} saves typed data and reads the committed object back`, async () => {
      vi.mocked(targetApi.getTargetAux)
        .mockResolvedValueOnce({
          objectId: '01J00000000000000000000002',
          entity,
          code: 'TST-0001',
          enabled: true,
          objectRevision: '1',
          data: sampleData[entity],
          updatedAt: '2026-09-05T00:00:00.000Z',
          updatedBy: 'user-1',
        })
        .mockResolvedValueOnce({
          objectId: '01J00000000000000000000002',
          entity,
          code: 'TST-0001',
          enabled: true,
          objectRevision: '2',
          data: sampleData[entity],
          updatedAt: '2026-09-05T00:01:00.000Z',
          updatedBy: 'user-1',
        })
      vi.mocked(targetApi.saveTargetAux).mockResolvedValue({
        objectId: '01J00000000000000000000002',
        objectRevision: '2',
        enabled: true,
      })
      const vm = useAuxMaintenanceViewModel(entity)
      await vm.openEdit('01J00000000000000000000002')
      await vm.save()

      expect(targetApi.saveTargetAux).toHaveBeenCalledWith(
        'csrf-token',
        entity,
        {
          objectId: '01J00000000000000000000002',
          objectRevision: 1,
          data: Object.fromEntries(
            auxEntityConfigs[entity].fields.map((field) => [
              field.key,
              sampleData[entity][field.key],
            ]),
          ),
        },
      )
      expect(targetApi.getTargetAux).toHaveBeenCalledTimes(2)
      expect(vm.detail.value?.objectRevision).toBe('2')
    })
  }
})
