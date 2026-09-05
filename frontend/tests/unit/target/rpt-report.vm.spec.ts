import { describe, expect, it, vi } from 'vitest'

import { createRptReportViewModel } from '@/target/pages/rpt/report/vm.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const report = {
  subjectId: '01K4A000000000000000000001',
  approvalEntryId: '01K4A000000000000000000002',
  code: 'rpt-000001',
  name: '科目余额表',
  parameters: [
    {
      key: 'bookId',
      name: '会计账簿',
      type: 'REFERENCE' as const,
      required: true,
      referenceType: 'ACCOUNTING_BOOK' as const,
    },
    {
      key: 'asOfDate',
      name: '截止日期',
      type: 'DATE' as const,
      required: true,
      defaultValue: '2026-09-05',
    },
  ],
  columns: [
    {
      alias: 'subject_name',
      name: '科目',
      order: 1,
      type: 'TEXT' as const,
      width: 180,
      visible: true,
    },
    {
      alias: 'balance',
      name: '余额',
      order: 2,
      type: 'DECIMAL' as const,
      width: 140,
      visible: true,
      format: 'money',
    },
  ],
}

function ports() {
  return {
    directory: vi.fn().mockResolvedValue([report]),
    query: vi.fn().mockResolvedValue({
      approvalEntryId: report.approvalEntryId,
      columns: report.columns,
      rows: [{ subject_name: '库存现金', balance: '100.50' }],
      page: 2,
      pageSize: 20,
      hasMore: false,
    }),
    export: vi.fn().mockResolvedValue({
      approvalEntryId: report.approvalEntryId,
      columns: report.columns,
      rows: [{ subject_name: '库存现金', balance: '100.50' }],
    }),
    reference: vi.fn().mockResolvedValue({
      items: [
        {
          id: '01K4A000000000000000000010',
          code: 'ACC-0001',
          name: '控制账簿',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    }),
    download: vi.fn(),
  }
}

describe('RPT dynamic report public view-model seam', () => {
  it('switches report identity and ignores requests belonging to the previous route parameter', async () => {
    const api = ports()
    const oldDirectory = deferred<(typeof report)[]>()
    const newReport = {
      ...report,
      subjectId: '01K4A000000000000000000011',
      approvalEntryId: '01K4A000000000000000000012',
      code: 'rpt-000002',
      name: '往来余额表',
    }
    api.directory
      .mockReturnValueOnce(oldDirectory.promise)
      .mockResolvedValueOnce([newReport])
    const vm = createRptReportViewModel(
      {
        csrfToken: 'csrf-token',
        permissions: ['/rpt/rpt-000001/query', '/rpt/rpt-000002/query'],
        reportCode: 'rpt-000001',
      },
      api,
    )

    const oldLoad = vm.load()
    await vm.switchReport('rpt-000002')
    oldDirectory.resolve([report])
    await oldLoad

    expect(vm.reportCode.value).toBe('rpt-000002')
    expect(vm.definition.value?.code).toBe('rpt-000002')
    expect(vm.definition.value?.name).toBe('往来余额表')
  })

  it('keeps query and each reference search on independent latest-request sequences', async () => {
    const api = ports()
    const oldQuery = deferred<Awaited<ReturnType<typeof api.query>>>()
    const newQuery = deferred<Awaited<ReturnType<typeof api.query>>>()
    const oldReference = deferred<Awaited<ReturnType<typeof api.reference>>>()
    const newReference = deferred<Awaited<ReturnType<typeof api.reference>>>()
    api.query
      .mockReturnValueOnce(oldQuery.promise)
      .mockReturnValueOnce(newQuery.promise)
    api.reference
      .mockReturnValueOnce(oldReference.promise)
      .mockReturnValueOnce(newReference.promise)
    const vm = createRptReportViewModel(
      {
        csrfToken: 'csrf-token',
        permissions: ['/rpt/rpt-000001/query'],
        reportCode: 'rpt-000001',
      },
      api,
    )
    await vm.load()
    vm.parameterValues.bookId = '01K4A000000000000000000010'

    const firstQuery = vm.query(1)
    const secondQuery = vm.query(1)
    const firstReference = vm.loadReference(report.parameters[0], '旧')
    const secondReference = vm.loadReference(report.parameters[0], '新')
    newQuery.resolve({
      approvalEntryId: report.approvalEntryId,
      columns: report.columns,
      rows: [{ subject_name: '新查询', balance: '2.00' }],
      page: 1,
      pageSize: 20,
      hasMore: false,
    })
    newReference.resolve({
      items: [{ id: 'new-book', code: 'NEW', name: '新候选' }],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    await Promise.all([secondQuery, secondReference])
    oldQuery.resolve({
      approvalEntryId: report.approvalEntryId,
      columns: report.columns,
      rows: [{ subject_name: '旧查询', balance: '1.00' }],
      page: 1,
      pageSize: 20,
      hasMore: true,
    })
    oldReference.resolve({
      items: [{ id: 'old-book', code: 'OLD', name: '旧候选' }],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    await Promise.all([firstQuery, firstReference])

    expect(vm.rows.value).toEqual([{ subject_name: '新查询', balance: '2.00' }])
    expect(vm.referenceOptions.bookId).toEqual([
      { id: 'new-book', code: 'NEW', name: '新候选' },
    ])
  })

  it('loads the exact directory entry, reference option, and sends typed parameters with fixed paging', async () => {
    const api = ports()
    const vm = createRptReportViewModel(
      {
        csrfToken: 'csrf-token',
        permissions: ['/rpt/rpt-000001/query'],
        reportCode: 'rpt-000001',
      },
      api,
    )

    await vm.load()
    await vm.loadReference(
      report.parameters[0],
      ' 控制 ',
      '01K4A000000000000000000010',
    )
    vm.parameterValues.bookId = '01K4A000000000000000000010'
    await vm.query(2)

    expect(api.reference).toHaveBeenCalledWith('csrf-token', 'rpt-000001', {
      parameterKey: 'bookId',
      keyword: '控制',
      selectedId: '01K4A000000000000000000010',
      page: 1,
      pageSize: 20,
    })
    expect(api.query).toHaveBeenCalledWith('csrf-token', 'rpt-000001', {
      parameters: {
        bookId: '01K4A000000000000000000010',
        asOfDate: '2026-09-05',
      },
      page: 2,
      pageSize: 20,
    })
    expect(vm.hasMore.value).toBe(false)
  })

  it('exports the server result without granting result disclosure from export permission alone', async () => {
    const api = ports()
    const vm = createRptReportViewModel(
      {
        csrfToken: 'csrf-token',
        permissions: ['/rpt/rpt-000001/export'],
        reportCode: 'rpt-000001',
      },
      api,
    )
    await vm.load()
    vm.parameterValues.bookId = '01K4A000000000000000000010'

    await vm.exportRows()

    expect(api.export).toHaveBeenCalledOnce()
    expect(api.download).toHaveBeenCalledWith(
      'rpt-000001.csv',
      '\uFEFF科目,余额\r\n库存现金,100.50',
    )
    expect(vm.rows.value).toEqual([])
  })

  it('normalizes optional empty parameters to null while preserving boolean false', async () => {
    const api = ports()
    api.directory.mockResolvedValue([
      {
        ...report,
        parameters: [
          ...report.parameters,
          {
            key: 'minimumAmount',
            name: '最小金额',
            type: 'DECIMAL' as const,
            required: false,
          },
          {
            key: 'counterpartyId',
            name: '往来单位',
            type: 'REFERENCE' as const,
            required: false,
            referenceType: 'COUNTERPARTY' as const,
          },
          {
            key: 'occurredRange',
            name: '发生日期',
            type: 'DATE_RANGE' as const,
            required: false,
          },
          {
            key: 'includeZero',
            name: '包含零余额',
            type: 'BOOLEAN' as const,
            required: false,
          },
        ],
      },
    ])
    const vm = createRptReportViewModel(
      {
        csrfToken: 'csrf-token',
        permissions: ['/rpt/rpt-000001/query'],
        reportCode: 'rpt-000001',
      },
      api,
    )

    await vm.load()
    vm.parameterValues.bookId = '01K4A000000000000000000010'
    await vm.query(1)

    expect(api.query).toHaveBeenCalledWith(
      'csrf-token',
      'rpt-000001',
      expect.objectContaining({
        parameters: expect.objectContaining({
          minimumAmount: null,
          counterpartyId: null,
          occurredRange: null,
          includeZero: false,
        }),
      }),
    )
  })

  it('reuses the successful first-page parameter snapshot while paging', async () => {
    const api = ports()
    api.query
      .mockResolvedValueOnce({
        approvalEntryId: report.approvalEntryId,
        columns: report.columns,
        rows: [{ subject_name: '库存现金', balance: '100.50' }],
        page: 1,
        pageSize: 20,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        approvalEntryId: report.approvalEntryId,
        columns: report.columns,
        rows: [{ subject_name: '银行存款', balance: '200.00' }],
        page: 2,
        pageSize: 20,
        hasMore: false,
      })
    const vm = createRptReportViewModel(
      {
        csrfToken: 'csrf-token',
        permissions: ['/rpt/rpt-000001/query'],
        reportCode: 'rpt-000001',
      },
      api,
    )
    await vm.load()
    vm.parameterValues.bookId = '01K4A000000000000000000010'
    await vm.query(1)

    vm.parameterValues.bookId = '01K4A000000000000000000099'
    await vm.query(2)

    expect(api.query).toHaveBeenLastCalledWith('csrf-token', 'rpt-000001', {
      parameters: {
        bookId: '01K4A000000000000000000010',
        asOfDate: '2026-09-05',
      },
      page: 2,
      pageSize: 20,
    })
    expect(vm.page.value).toBe(2)
  })
})
