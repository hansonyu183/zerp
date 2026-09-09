import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { vouEntities, vouEntityInputDescriptors } from '@zerp/model'
import SnapshotValue from '@/target/components/document-page/SnapshotValue.vue'
import { vouPages } from '@/target/components/document-page/catalog-list.ts'

describe('voucher catalog consumers', () => {
  it('initializes only registered filters for every type and preserves nullable summaries', () => {
    for (const entity of vouEntities) {
      const page = vouPages[entity]
      expect(
        () => page.normalizeFilters(page.initialFilters()),
        entity,
      ).not.toThrow()
      expect(
        () =>
          page.validateRows([
            {
              vouType: entity,
              documentId: '01J00000000000000000000001',
              documentNo: 'DOC-1',
              handlerName: null,
              revision: '1',
              businessDate: '2026-09-04',
              submittedDate: '2026-09-04',
              status: 'PENDING',
              counterpartyName: null,
              amount: null,
              currency: 'CNY',
            },
          ]),
        entity,
      ).not.toThrow()
    }
  })
  it('displays nested read-only facts with Chinese values, exact decimals and safe text', () => {
    const view = mount(SnapshotValue, {
      props: {
        value: {
          businessDate: '2026-09-04',
          currency: 'CNY',
          withRecourse: false,
          amount: '9007199254740993.30',
          handler: null,
          serviceContract: {
            capabilities: ['CHANNEL_PARTNER'],
            terms: '<script>alert(1)</script>',
          },
          billLines: [{ billType: 'BANK_ACCEPTANCE', annualRateBps: 0 }],
        },
      },
    })
    expect(view.text()).toContain('人民币')
    expect(view.text()).toContain('渠道合作方')
    expect(view.text()).toContain('银行承兑汇票')
    expect(view.text()).toContain('9007199254740993.30')
    expect(view.text()).toContain('否')
    expect(view.text()).toContain('—')
    expect(view.text()).toContain('0')
    expect(view.text()).toContain('<script>alert(1)</script>')
    expect(view.find('script').exists()).toBe(false)
  })
  it('renders every enum from the shared descriptor as a known Chinese caption', () => {
    const cases = new Map<string, Set<string>>()
    function visit(fields: (typeof vouEntityInputDescriptors)['sale-order']) {
      for (const field of fields) {
        if (field.enumValues) {
          const values = cases.get(field.key) ?? new Set<string>()
          field.enumValues.forEach((value) => values.add(value))
          cases.set(field.key, values)
        }
        if (field.fields) visit(field.fields)
        if (field.item) visit(field.item)
      }
    }
    Object.values(vouEntityInputDescriptors).forEach(visit)
    for (const [field, values] of cases)
      for (const value of values) {
        const view = mount(SnapshotValue, { props: { field, value } })
        expect(view.text(), `${field}/${value}`).not.toBe(value)
        expect(view.text(), `${field}/${value}`).not.toContain('未知')
        view.unmount()
      }
  })
})

it('shows legal foreign currencies and the complete adopted AUX reference facts', () => {
  for (const [value, caption] of [
    ['USD', '美元'],
    ['HKD', '港元'],
  ]) {
    const view = mount(SnapshotValue, { props: { field: 'currency', value } })
    expect(view.text()).toContain(caption)
  }
  const view = mount(SnapshotValue, {
    props: {
      value: {
        fundAccount: {
          objectId: 'account-id',
          name: '旧账户',
          snapshot: {
            name: '旧账户',
            currency: 'USD',
            accountName: '历史户名',
            bank: '历史银行',
            branch: '历史支行',
            accountNumber: 'TEST-ACCOUNT',
            operatingEntity: { id: 'entity-id', code: 'OE1', name: '历史主体' },
            remark: '',
          },
        },
      },
    },
  })
  expect(view.text()).toContain('历史银行')
  expect(view.text()).toContain('TEST-ACCOUNT')
  expect(view.text()).toContain('历史主体')
  expect(view.text()).not.toContain('未登记字段')
})

it('renders complete opening asset and operating-entity bill snapshots without unknown fields', () => {
  const view = mount(SnapshotValue, {
    props: {
      value: [
        {
          assetId: 'asset-id',
          assetNo: 'A-01',
          name: '期初设备',
          categoryId: 'category-id',
          departmentId: 'department-id',
          usefulLifeMonths: 12,
          residualRate: '0.05',
          acquiredOn: '2026-08-01',
          currency: 'CNY',
          originalValue: '100.00',
          accumulatedDepreciation: '10.00',
        },
        {
          billId: 'bill-id',
          billNo: 'B-01',
          billType: 'BANK_ACCEPTANCE',
          positionType: 'ASSET',
          medium: 'ELECTRONIC',
          currency: 'CNY',
          faceAmount: '100.00',
          issueDate: '2026-08-01',
          maturityDate: '2026-12-01',
          drawer: '出票人',
          acceptor: '承兑人',
          payee: '收款人',
          annualRateBps: 0,
          interestDays: 0,
          interestAmount: '0.00',
          customerCostAmount: '0.00',
          valueAmount: '100.00',
          originatingCounterparty: {
            entity: 'operating-entity',
            objectId: 'entity-id',
            code: 'ENT',
            name: '经营主体',
          },
        },
      ],
    },
  })
  expect(view.text()).not.toContain('未登记字段')
  expect(view.text()).not.toContain('未知选项')
  expect(view.text()).toContain('资产编号')
  expect(view.text()).toContain('取得日期')
  expect(view.text()).toContain('经营主体')
})
