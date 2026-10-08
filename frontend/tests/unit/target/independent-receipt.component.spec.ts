import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DocumentFields from '../../../src/target/components/document-page/DocumentFields.vue'
import IndependentReceiptBlock from '../../../src/target/components/document-page/IndependentReceiptBlock.vue'
import {
  createDocumentDraft,
  cloneDocumentDraft,
  documentCommand,
} from '../../../src/target/components/document-page/draft.ts'
import {
  cloneIndependentReceipt,
  independentReceiptPayload,
} from '../../../src/target/components/document-page/independent-receipt-data.ts'
import type { VouPayloadFor } from '@zerp/model'
import type { VouDetail } from '../../../src/target/components/document-page/list-runtime.ts'

const payload: Extract<
  VouPayloadFor<'purchase-inbound'>,
  { productLines: readonly unknown[] }
> = {
  businessDate: '2026-09-11',
  currency: 'CNY',
  attachments: [],
  supplier: { objectId: 'supplier', approvalEntryId: 'supplier-approved' },
  warehouse: { objectId: 'warehouse' },
  priorFact: {
    sourceClosed: false,
    sourceInstanceId: 'fixture',
    sourceSchema: 'fixture',
    sourceDocumentType: 'AH',
    sourceDocumentKey: '548914',
    sourceDocumentNo: 'AH-008',
    capturedAt: '2026-09-30T23:59:59.123456Z',
    snapshotDigest: 'a'.repeat(64),
  },
  productLines: [
    {
      lineId: 'old-line',
      product: { objectId: 'product' },
      enteredQuantity: '1100',
      enteredUnit: {
        objectId: 'unit',
        code: 'KG',
        name: '公斤',
        fixedFactor: '1',
      },
      baseQuantity: '1100',
      unitPrice: '7.500000',
      agreedAmount: '8250.00',
    },
  ],
  priorLineOrigins: [
    {
      lineId: 'old-line',
      sourceDocumentType: 'BB',
      sourceDocumentKey: '548909',
      sourceLineKey: '5',
    },
  ],
}
describe('independent receipt editor', () => {
  it('switches explicitly from order fulfillment and never drops existing source rows', () => {
    const draft = createDocumentDraft('purchase-inbound')!
    expect(draft.kind).toBe('fulfillment')
    const wrapper = mount(DocumentFields, {
      props: { modelValue: draft, disabled: false },
      global: {
        stubs: {
          FulfillmentBlock: { name: 'FulfillmentBlock', template: '<div />' },
          IndependentReceiptBlock: true,
        },
      },
    })
    wrapper.findComponent({ name: 'FulfillmentBlock' }).vm.$emit('standalone')
    const next = wrapper.emitted('update:modelValue')![0]![0]
    expect(next.kind).toBe('independent-receipt')
    expect(next.value.priorFact).toBeNull()
    expect(next.value.lines).toEqual([])
    if (draft.kind === 'fulfillment')
      draft.value.lines.push({
        id: 'source-row',
        source: null,
        baseQuantity: '1',
        remark: '',
      })
    wrapper.findComponent({ name: 'FulfillmentBlock' }).vm.$emit('standalone')
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
    wrapper.unmount()
  })
  it('copies facts into fresh lines but requires an explicit new prior identity and line origins', () => {
    const editor = cloneDocumentDraft({
      entity: 'purchase-inbound',
      payload,
    } as VouDetail)!
    expect(editor.kind).toBe('independent-receipt')
    if (editor.kind !== 'independent-receipt') throw new Error('wrong editor')
    const draft = editor.value
    expect(draft.priorFact).toBeNull()
    expect(draft.lines[0]!.lineId).not.toBe('old-line')
    expect(draft.lines[0]!.origin).toEqual({
      sourceDocumentType: '',
      sourceDocumentKey: '',
      sourceLineKey: '',
    })
    expect(draft.lines[0]!.agreedAmount).toBe('8250.00')
    expect(() =>
      documentCommand(editor, {
        documentId: 'new',
        submissionId: 'new',
        idempotencyKey: 'new',
      }),
    ).toThrow('必须明确登记此前事实')
    const wrapper = mount(IndependentReceiptBlock, {
      props: { modelValue: draft, disabled: false },
      global: {
        stubs: {
          VBtn: {
            props: ['disabled'],
            template: '<button :disabled="disabled"><slot /></button>',
          },
          VAlert: { template: '<p><slot /></p>' },
          PriorFactBlock: true,
          FormBlock: true,
          VouReference: true,
          CollectionBlock: true,
        },
      },
    })
    expect(wrapper.text()).toContain('复制不沿用原单身份')
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
  it('submits exact amounts and external references through the purchase-inbound command, without a parent', () => {
    const draft = cloneIndependentReceipt(payload, ['new-line'])
    draft.priorFact = {
      ...payload.priorFact,
      sourceDocumentKey: 'another-real-receipt',
    }
    const line = draft.lines[0]!
    line.current = {
      data: {
        productType: { behaviorProfile: 'RAW_MATERIAL' },
        unitConversions: [
          { unit: { id: 'unit', code: 'KG', name: '公斤', fixedFactor: '1' } },
        ],
      },
    } as NonNullable<typeof line.current>
    expect(() => independentReceiptPayload(draft)).toThrow('完整原单据行关联')
    line.origin = {
      sourceDocumentType: 'BB',
      sourceDocumentKey: '548909',
      sourceLineKey: '5',
    }
    const command = documentCommand(
      { kind: 'independent-receipt', value: draft },
      {
        documentId: 'new',
        submissionId: 'new-entry',
        idempotencyKey: 'new-entry',
      },
    )
    expect(command.kind).toBe('fulfillment')
    if (command.kind !== 'fulfillment') throw new Error('wrong command')
    expect(command.entity).toBe('purchase-inbound')
    expect(command.input.payload).toMatchObject({
      productLines: [
        {
          enteredQuantity: '1100',
          baseQuantity: '1100',
          unitPrice: '7.500000',
          agreedAmount: '8250.00',
        },
      ],
      priorLineOrigins: [
        {
          lineId: 'new-line',
          sourceDocumentType: 'BB',
          sourceDocumentKey: '548909',
          sourceLineKey: '5',
        },
      ],
    })
    expect(command.input.payload).not.toHaveProperty('parentEntity')
    line.agreedAmount = ''
    line.unitPrice = '7.50'
    expect(() => independentReceiptPayload(draft)).toThrow('真实实际金额')
  })
})
