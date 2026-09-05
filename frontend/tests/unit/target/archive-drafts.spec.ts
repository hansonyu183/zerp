import { describe, expect, it } from 'vitest'

import {
  archiveEntityPresentation,
  archiveReferencePermissions,
  archiveSubmitPermission,
  archiveSubmitPermissions,
  canCloneArchive,
  canSubmitArchive,
} from '../../../src/target/archive-presentation.ts'
import {
  createArchiveDraft,
  initialArchiveSnapshot,
} from '../../../src/target/archive-drafts.ts'
import { targetArchiveEntities } from '../../../src/target/api.ts'

describe('target archive drafts', () => {
  it('creates complete editable snapshots for every archive entity', () => {
    const operatingEntity = createArchiveDraft('owner-1', 'operating-entity')
    const customer = createArchiveDraft('owner-1', 'customer')

    expect(operatingEntity.snapshot).toMatchObject({
      legalName: '新经营主体',
      legalIdentifier: '91350211M000100Y46',
      registeredAddress: '',
      contactName: '',
      contactPhone: '',
      invoiceTitle: '',
      invoiceAddress: '',
      invoicePhone: '',
      invoiceBank: '',
      invoiceAccount: '',
      remark: '',
      enabled: true,
    })
    expect(customer.snapshot).toMatchObject({
      identityKind: 'MAINLAND_ENTERPRISE',
      legalIdentifier: '91350211M000100Y46',
      phone: '',
      email: '',
      enabled: true,
    })

    for (const entity of targetArchiveEntities) {
      expect(initialArchiveSnapshot(entity)).not.toEqual({})
    }
  })

  it('presents every archive entity and its exact submit permission in Chinese', () => {
    expect(archiveEntityPresentation).toEqual({
      'operating-entity': { label: '经营主体', draftLabel: '经营主体资料' },
      vehicle: { label: '车辆', draftLabel: '车辆资料' },
      'fund-account': { label: '资金账户', draftLabel: '资金账户资料' },
      product: { label: '产品', draftLabel: '产品资料' },
      employee: { label: '员工', draftLabel: '员工资料' },
      supplier: { label: '供应商', draftLabel: '供应商资料' },
      customer: { label: '客户', draftLabel: '客户资料' },
      'other-unit': { label: '其他单位', draftLabel: '其他单位资料' },
      'sales-partner': { label: '销售合作方', draftLabel: '销售合作方资料' },
      'acc-mapping': { label: '记账映射', draftLabel: '记账映射规则' },
      'rpt-definition': { label: '报表定义', draftLabel: '报表定义资料' },
    })

    for (const entity of targetArchiveEntities) {
      expect(archiveEntityPresentation[entity].label).not.toContain('-')
      expect(archiveSubmitPermission(entity, 'NEW')).toBe(
        `/dcl/${entity}/submit-new`,
      )
      expect(archiveSubmitPermission(entity, 'CHANGE')).toBe(
        `/dcl/${entity}/submit-change`,
      )
      expect(
        canSubmitArchive([`/dcl/${entity}/submit-change`], entity, 'NEW'),
      ).toBe(false)
      expect(
        canSubmitArchive(
          [
            `/dcl/${entity}/submit-change`,
            ...archiveReferencePermissions(entity),
          ],
          entity,
          'CHANGE',
        ),
      ).toBe(true)
    }

    expect(archiveSubmitPermissions('customer', 'NEW')).toEqual([
      '/dcl/customer/submit-new',
      '/aux/reference/query',
      '/aux/dictionary-item/query',
      '/aux/settlement-method/query',
      '/aux/payment-method/query',
      '/bob/reference/query',
      '/dcl/customer/save-subunits',
    ])
    expect(archiveSubmitPermissions('customer', 'CHANGE')).not.toContain(
      '/dcl/customer/save-subunits',
    )
    expect(
      canSubmitArchive(['/dcl/customer/submit-new'], 'customer', 'NEW'),
    ).toBe(false)
    expect(
      canSubmitArchive(
        [
          '/dcl/customer/submit-new',
          ...archiveReferencePermissions('customer'),
          '/dcl/customer/save-subunits',
        ],
        'customer',
        'NEW',
      ),
    ).toBe(true)

    for (const entity of targetArchiveEntities) {
      const complete = [
        `/dcl/${entity}/submit-new`,
        ...archiveReferencePermissions(entity),
        ...(entity === 'customer' ? ['/dcl/customer/save-subunits'] : []),
      ]
      for (const required of archiveReferencePermissions(entity)) {
        expect(
          canSubmitArchive(
            complete.filter((permission) => permission !== required),
            entity,
            'NEW',
          ),
        ).toBe(false)
      }
      expect(canCloneArchive(complete, entity, 'NEW')).toBe(false)
      expect(
        canCloneArchive([...complete, `/dcl/${entity}/get`], entity, 'NEW'),
      ).toBe(true)
    }
  })
})
