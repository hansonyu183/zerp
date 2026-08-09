import { shallowMount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import VoucherBillLinesEditor from '@/components/voucher/VoucherBillLinesEditor.vue'
import type { BillLineDraft } from '@/pages/vou/shared/bill/vm'

const changeBill: BillLineDraft = {
  key: 'change-1',
  billId: 'bill-1',
  positionType: 'ASSET',
  direction: 'IN',
  purpose: 'CHANGE',
  billType: 'COMMERCIAL_ACCEPTANCE',
  billNo: 'CHANGE-001',
  medium: 'PAPER',
  currency: 'CNY',
  faceAmount: '88.00',
  issueDate: '2026-08-01',
  maturityDate: '2026-09-01',
  drawer: '出票企业',
  acceptor: '承兑企业',
  payee: '收款企业',
  originatingParty: {
    objectId: 'customer-1',
    versionId: 'customer-v1',
    code: 'CUS-001',
    name: '客户一',
    entity: 'customer',
  },
  annualRateBps: 125,
  remark: '移动端可核对备注',
}

describe('VoucherBillLinesEditor', () => {
  it('shows every fixed change-bill fact on mobile', () => {
    const wrapper = shallowMount(VoucherBillLinesEditor, {
      props: { modelValue: [changeBill], editable: false },
    })
    const mobileText = wrapper.find('.voucher-bill-lines__mobile').text()

    for (const expected of [
      '号码',
      'CHANGE-001',
      '类型',
      '商业承兑',
      '介质',
      '纸质',
      '币种',
      'CNY',
      '票面金额',
      '88.00',
      '出票日',
      '2026-08-01',
      '到期日',
      '2026-09-01',
      '出票人',
      '出票企业',
      '承兑人',
      '承兑企业',
      '收款人',
      '收款企业',
      '年利率(bps)',
      '125',
      '备注',
      '移动端可核对备注',
    ]) {
      expect(mobileText).toContain(expected)
    }
  })

  it('identifies held change bills by type and originating party', async () => {
    const wrapper = shallowMount(VoucherBillLinesEditor, {
      props: { modelValue: [], heldOptions: [changeBill], editable: true },
    })

    await wrapper
      .findAll('v-btn')
      .find((button) => button.text().includes('选择找零票据'))!
      .trigger('click')

    const option = wrapper
      .findAll('v-list-item')
      .find((item) => item.attributes('title')?.includes('CHANGE-001'))!
    expect(option.attributes('title')).toContain('商业承兑')
    expect(option.attributes('subtitle')).toContain('来源 CUS-001 · 客户一')
  })
})
