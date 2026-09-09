import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareAccMappingSave } from '../src/archives.ts'

test('ACC current mapping validates configuration without submission or approval facts', () => {
  const data = {
    book: { id: 'book', code: 'B', name: '账簿' },
    vouEntity: { id: 'sale', code: 'sale-order', name: '销售订单' },
    defaultResult: 'UN_POST' as const,
    definition: {
      defaultTemplateId: null,
      rules: [],
      templates: [],
      assetConfiguration: null,
    },
  }
  const facts = {
    book: { id: 'book', enabled: true },
    vouEntity: { id: 'sale', enabled: true },
    fieldCatalog: { collections: ['lines'], headerFields: [], lineFields: [] },
    accounts: [],
  }
  assert.deepEqual(prepareAccMappingSave(data, facts), { ok: true, data })
  assert.deepEqual(
    prepareAccMappingSave({ ...data, defaultResult: 'POST' }, facts),
    {
      ok: false,
      error: { errorKey: 'acc_mapping_invalid_data' },
    },
  )
})

test('current configuration rejects duplicate template identities and unknown line collections', () => {
  const line = {
    subjectSource: 'FIXED' as const,
    subjectValue: 'cash',
    direction: 'DEBIT' as const,
    amountField: 'amount',
    currencyField: 'currency',
    dimensions: {},
    quantityField: null,
    costCounterpartSubjectId: null,
    costCounterpartDimensions: {},
  }
  const template = {
    templateId: 'same',
    collection: null,
    lines: [line, { ...line, direction: 'CREDIT' as const }],
  }
  const data = {
    book: { id: 'book', code: 'B', name: '账簿' },
    vouEntity: { id: 'sale', code: 'sale', name: '单据' },
    defaultResult: 'POST' as const,
    definition: {
      defaultTemplateId: 'same',
      rules: [],
      templates: [template, template],
      assetConfiguration: null,
    },
  }
  const facts = {
    book: { id: 'book', enabled: true },
    vouEntity: { id: 'sale', enabled: true },
    fieldCatalog: {
      headerFields: ['amount', 'currency'],
      lineFields: [],
      collections: [],
    },
    accounts: [
      {
        id: 'cash',
        bookId: 'book',
        enabled: true,
        leaf: true,
        requiredDimensions: [],
      },
    ],
  }
  assert.equal(prepareAccMappingSave(data, facts).ok, false)
  assert.equal(
    prepareAccMappingSave(
      {
        ...data,
        definition: {
          ...data.definition,
          templates: [{ ...template, collection: 'invented' }],
        },
      },
      facts,
    ).ok,
    false,
  )
})

test('mapping preserves separate line collections and rejects an unpublished collection', () => {
  const line = {
    subjectSource: 'FIXED' as const,
    subjectValue: 'cash',
    direction: 'DEBIT' as const,
    amountField: 'line.amount',
    currencyField: 'currency',
    dimensions: {},
    quantityField: null,
    costCounterpartSubjectId: null,
    costCounterpartDimensions: {},
    collection: 'billCashLines',
  }
  const data = {
    book: { id: 'book', code: 'B', name: '账簿' },
    vouEntity: { id: 'bill', code: 'bill-receipt', name: '收票' },
    defaultResult: 'POST' as const,
    definition: {
      defaultTemplateId: 'mixed',
      rules: [],
      assetConfiguration: null,
      templates: [
        {
          templateId: 'mixed',
          collection: null,
          lines: [
            line,
            {
              ...line,
              collection: null,
              amountField: 'total',
              direction: 'CREDIT' as const,
            },
          ],
        },
      ],
    },
  }
  const facts = {
    book: { id: 'book', enabled: true },
    vouEntity: { id: 'bill', enabled: true },
    fieldCatalog: {
      headerFields: ['currency', 'total'],
      lineFields: ['line.amount'],
      collections: ['billCashLines'],
    },
    accounts: [
      {
        id: 'cash',
        bookId: 'book',
        enabled: true,
        leaf: true,
        requiredDimensions: [],
      },
    ],
  }
  assert.deepEqual(prepareAccMappingSave(data, facts), { ok: true, data })
  assert.equal(
    prepareAccMappingSave(
      {
        ...data,
        definition: {
          ...data.definition,
          templates: [
            {
              ...data.definition.templates[0]!,
              lines: [{ ...line, collection: 'unpublished' }, line],
            },
          ],
        },
      },
      facts,
    ).ok,
    false,
  )
})
