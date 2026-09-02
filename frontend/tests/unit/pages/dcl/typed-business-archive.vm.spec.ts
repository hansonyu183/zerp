import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { dclEmployeeConfig } from '@/pages/dcl/employee/config'
import { useDclTypedArchiveViewModel } from '@/pages/dcl/shared/typed-business-archive/vm'
import { dclTypedArchiveConfig } from '@/pages/dcl/shared/typed-business-archive/config'
import { dclSupplierConfig } from '@/pages/dcl/supplier/config'
import { useSessionStore } from '@/stores/session'
vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const post = vi.mocked(apiClient.postContract)

function fieldByKey(
  fields: readonly {
    key: string
    label: string
    required?: boolean
    rules?: readonly ((value: unknown) => true | string)[]
  }[],
  key: string,
) {
  const field = fields.find((candidate) => candidate.key === key)
  if (!field) throw new Error(`Missing ${key} field`)
  return field
}

describe('DCL legal identifier form configuration', () => {
  it.each(['other-unit', 'sales-partner'] as const)(
    'allows an empty %s draft while limiting its legal identifier to 100 characters',
    (entity) => {
      const field = fieldByKey(
        dclTypedArchiveConfig(entity).fields,
        'legalIdentifier',
      )

      expect(field.label).toBe('法定识别号')
      expect(field.required).toBeUndefined()
      expect(field.rules?.[0]?.('x'.repeat(100))).toBe(true)
      expect(field.rules?.[0]?.('x'.repeat(101))).toBe(
        '法定识别号不能超过 100 个字符。',
      )
    },
  )

  it.each([
    ['Employee', dclEmployeeConfig.fields],
    ['Supplier', dclSupplierConfig.fields],
  ] as const)(
    'uses the legal-identifier label and contract length for %s',
    (_entity, fields) => {
      const field = fieldByKey(fields, 'legalIdentifier')

      expect(field.label).toBe('法定识别号')
      expect(field.rules?.[0]?.('x'.repeat(100))).toBe(true)
      expect(field.rules?.[0]?.('x'.repeat(101))).toBe(
        '法定识别号不能超过 100 个字符。',
      )
    },
  )
})

describe('DCL typed business archive view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })
  it.each(['other-unit', 'sales-partner'] as const)(
    'creates %s directly without a Party relationship',
    async (entity) => {
      useSessionStore().permissions = [
        `/dcl/${entity}/create`,
        '/bob/operating-entity/query',
        ...(entity === 'other-unit' ? ['/aux/settlement-method/query'] : []),
      ]
      post.mockResolvedValue({ data: { items: [] } } as never)
      const vm = useDclTypedArchiveViewModel(entity)
      vm.openCreate()
      await expect(
        vm.save({
          ...vm.editorModel.value,
          legalName: '档案甲',
          displayName: '档案甲',
          legalIdentifier: '91350211M000100Y46',
          operatingEntityIds: ['OPE-1'],
          defaultOperatingEntityId: 'OPE-1',
        }),
      ).resolves.toBe(true)
      expect(post).toHaveBeenCalledWith(`dcl/${entity}/create`, {
        data: expect.objectContaining({
          legalName: '档案甲',
          legalIdentifier: '91350211M000100Y46',
          operatingEntityIds: ['OPE-1'],
          defaultOperatingEntityId: 'OPE-1',
        }),
      })
    },
  )

  it.each(['other-unit', 'sales-partner'] as const)(
    'saves an empty legal identifier as a draft for %s',
    async (entity) => {
      useSessionStore().permissions = [
        `/dcl/${entity}/create`,
        '/bob/operating-entity/query',
        ...(entity === 'other-unit' ? ['/aux/settlement-method/query'] : []),
      ]
      post.mockResolvedValue({ data: { items: [] } } as never)
      const vm = useDclTypedArchiveViewModel(entity)
      vm.openCreate()

      await expect(
        vm.save({
          ...vm.editorModel.value,
          legalName: '档案甲',
          displayName: '档案甲',
          operatingEntityIds: ['OPE-1'],
          defaultOperatingEntityId: 'OPE-1',
        }),
      ).resolves.toBe(true)
      expect(post).toHaveBeenCalledWith(`dcl/${entity}/create`, {
        data: expect.objectContaining({ legalIdentifier: '' }),
      })
    },
  )
})

describe('DCL typed business archive legal identifier', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it.each(['other-unit', 'sales-partner'] as const)(
    'round-trips the legal identifier when editing and disabling %s',
    async (entity) => {
      const view = {
        objectId: `${entity}-1`,
        entity,
        code: 'ARC-001',
        updatedAt: '2026-09-01T00:00:00Z',
        availableApprovalActions: [],
        approval: {
          approvalEntryId: `APR-${entity}`,
          revision: 3,
          status: 'APPROVED',
          versionNo: 1,
        },
        data: {
          kind: 'ORGANIZATION',
          legalName: '档案甲',
          legalIdentifier: '91350211M000100Y46',
          enabled: true,
          operatingEntityIds: ['OPE-1'],
          defaultOperatingEntityId: 'OPE-1',
          operatingEntities: [
            { sourceObjectId: 'OPE-1', code: 'OPE-001', name: '经营主体甲' },
          ],
          ...(entity === 'other-unit'
            ? { settlementMethodId: null }
            : { capabilities: [] }),
        },
      } as never
      const row = {
        objectId: view.objectId,
        code: view.code,
        availableApprovalActions: [],
        latestApproved: { approval: view.approval, data: view.data },
        openVersion: null,
      } as never
      post.mockImplementation(
        async (path) =>
          ({
            data:
              path === `dcl/${entity}/get`
                ? view
                : { items: [], total: 0, page: 1, pageSize: 20 },
          }) as never,
      )
      useSessionStore().permissions = [
        `/dcl/${entity}/get`,
        `/dcl/${entity}/save`,
        '/bob/operating-entity/query',
        ...(entity === 'other-unit' ? ['/aux/settlement-method/query'] : []),
      ]
      const vm = useDclTypedArchiveViewModel(entity)

      await vm.openEdit(row)

      expect(vm.editorModel.value.legalIdentifier).toBe(
        view.data.legalIdentifier,
      )
      await expect(vm.save(vm.editorModel.value)).resolves.toBe(true)
      expect(post).toHaveBeenCalledWith(
        `dcl/${entity}/save`,
        expect.objectContaining({
          data: expect.objectContaining({
            legalIdentifier: view.data.legalIdentifier,
          }),
        }),
      )
      post.mockClear()
      post.mockImplementation(
        async (path) =>
          ({
            data:
              path === `dcl/${entity}/get`
                ? view
                : { items: [], total: 0, page: 1, pageSize: 20 },
          }) as never,
      )

      await expect(vm.changeEnabled(row)).resolves.toBe(true)

      expect(post).toHaveBeenCalledWith(
        `dcl/${entity}/save`,
        expect.objectContaining({
          data: expect.objectContaining({
            enabled: false,
            legalIdentifier: view.data.legalIdentifier,
          }),
        }),
      )
    },
  )
})
