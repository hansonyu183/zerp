import { vouDocumentPrefixes } from '@zerp/model'
import {
  assignedId,
  preserve,
  record,
  rows,
  str,
  type ConversionPlan,
  type Row,
} from './plan.ts'
import { customerFor } from './references.ts'

const fixed = (value: unknown) => {
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(str(value))
  if (!match) throw new Error('customer_cutover_invalid_amount')
  return (
    BigInt(match[1]!) * 100000000n + BigInt((match[2] ?? '').padEnd(8, '0'))
  )
}
const decimal = (value: bigint) =>
  `${value / 100000000n}.${String(value % 100000000n).padStart(8, '0')}`
function documentNumber(plan: ConversionPlan, businessDate: string) {
  let counter = rows(plan.tables, 'vou_document_counters').find(
    (row) =>
      row.entity === 'sales-receipt' &&
      str(row.business_date).slice(0, 10) === businessDate,
  )
  if (!counter) {
    counter = {
      entity: 'sales-receipt',
      business_date: businessDate,
      last_value: 0,
    }
    rows(plan.tables, 'vou_document_counters').push(counter)
  }
  const occupied = new Set(
    rows(plan.tables, 'vou_documents').map((row) => row.document_no),
  )
  let next = Number(counter.last_value),
    result: string
  do {
    result = `${vouDocumentPrefixes['sales-receipt']}-${businessDate.replaceAll('-', '')}-${String(++next).padStart(4, '0')}`
  } while (occupied.has(result))
  if (next > 9999) throw new Error('customer_cutover_code_exhausted')
  counter.last_value = next
  return result
}
export function splitReceipts(plan: ConversionPlan) {
  const target = plan.tables
  const originals = structuredClone(target)
  for (const header of rows(originals, 'vou_sales_receipt_details')) {
    const oldEntry = str(header.approval_entry_id),
      oldDocument = str(header.document_id)
    const allocations = rows(
      originals,
      'vou_amount_allocation_snapshots',
    ).filter((row) => row.approval_entry_id === oldEntry)
    const references = rows(originals, 'vou_reference_snapshots').filter(
      (row) => row.approval_entry_id === oldEntry,
    )
    const entry = rows(originals, 'approval_entries').find(
      (row) => row.id === oldEntry,
    )
    const document = rows(originals, 'vou_documents').find(
      (row) => row.id === oldDocument,
    )
    const groups = new Map<string, { amount: bigint; reference: Row }>()
    for (const allocation of allocations) {
      const adopted = references.find(
        (row) => row.field === 'subunit' && row.line_no === allocation.line_no,
      )
      const customer =
        adopted &&
        customerFor(
          plan,
          str(adopted.object_id),
          'vou_sales_receipt_details',
          oldDocument,
        )
      if (!adopted || !customer || BigInt(str(allocation.amount_minor)) <= 0n) {
        plan.review.push({
          kind: 'RECEIPT_ALLOCATION_UNMAPPABLE',
          table: 'vou_sales_receipt_details',
          identity: oldDocument,
        })
        continue
      }
      const prior = groups.get(customer.customerId)
      if (
        prior &&
        prior.reference.approval_reference_id !== adopted.approval_reference_id
      )
        plan.review.push({
          kind: 'RECEIPT_VERSION_CONFLICT',
          table: 'vou_sales_receipt_details',
          identity: oldDocument,
        })
      groups.set(customer.customerId, {
        amount: (prior?.amount ?? 0n) + BigInt(str(allocation.amount_minor)),
        reference: adopted,
      })
    }
    const total = BigInt(str(header.total_amount_minor))
    if (
      !entry ||
      !document ||
      !groups.size ||
      [...groups.values()].reduce((sum, item) => sum + item.amount, 0n) !==
        total
    ) {
      plan.review.push({
        kind: 'RECEIPT_ALLOCATION_TOTAL',
        table: 'vou_sales_receipt_details',
        identity: oldDocument,
      })
      continue
    }
    for (const [customerId, group] of groups) {
      const entryId =
        groups.size === 1
          ? oldEntry
          : assignedId(`receipt-entry:${oldEntry}:${customerId}`)
      const documentId =
        groups.size === 1
          ? oldDocument
          : assignedId(`receipt-document:${oldDocument}:${customerId}`)
      plan.receipts.push({
        oldEntryId: oldEntry,
        oldDocumentId: oldDocument,
        customerId,
        entryId,
        documentId,
        amountMinor: String(group.amount),
      })
      if (groups.size > 1) {
        rows(target, 'vou_documents').push({
          ...document,
          id: documentId,
          document_no: documentNumber(
            plan,
            str(header.business_date).slice(0, 10),
          ),
        })
        rows(target, 'approval_entries').push({
          ...entry,
          id: entryId,
          subject_id: documentId,
        })
        for (const event of rows(originals, 'approval_events').filter(
          (row) => row.entry_id === oldEntry,
        ))
          rows(target, 'approval_events').push({
            ...event,
            id: assignedId(`receipt-event:${event.id}:${customerId}`),
            entry_id: entryId,
            subject_id: documentId,
          })
      }
      for (const [table, data] of Object.entries(originals)) {
        if (
          !table.startsWith('vou_') ||
          [
            'vou_idempotency',
            'vou_amount_allocation_snapshots',
            'vou_attachment_download_tokens',
          ].includes(table)
        )
          continue
        const owned = data.filter((row) => row.approval_entry_id === oldEntry)
        for (const row of owned) {
          preserve(plan, table, row)
          if (
            table === 'vou_reference_snapshots' &&
            ['customer', 'subunit'].includes(str(row.field))
          )
            continue
          const copy: Row = { ...row, approval_entry_id: entryId }
          if ('document_id' in copy) copy.document_id = documentId
          if (table === 'vou_sales_receipt_details')
            copy.total_amount_minor = String(group.amount)
          rows(target, table).push(copy)
        }
      }
      rows(target, 'vou_reference_snapshots').push({
        ...group.reference,
        approval_entry_id: entryId,
        field: 'customer',
        line_no: 0,
        item_no: 0,
      })
    }
    const mappings = plan.receipts.filter(
      (item) => item.oldEntryId === oldEntry,
    )
    // Copies above include the one-to-one case; remove only the original row
    // identities, so preservation does not duplicate a receipt or its bank sum.
    for (const [table, data] of Object.entries(originals)) {
      if (!table.startsWith('vou_') || table === 'vou_idempotency') continue
      const owned = data.filter((row) => row.approval_entry_id === oldEntry)
      for (const row of owned) {
        preserve(plan, table, row)
        const index = rows(target, table).findIndex(
          (item) => JSON.stringify(item) === JSON.stringify(row),
        )
        if (index >= 0) rows(target, table).splice(index, 1)
      }
    }
    if (groups.size === 1) continue
    for (const table of ['approval_entries', 'approval_events']) {
      const removed = rows(target, table).filter((row) =>
        table === 'approval_entries'
          ? row.id === oldEntry
          : row.entry_id === oldEntry,
      )
      for (const row of removed) preserve(plan, table, row)
      target[table] = rows(target, table).filter(
        (row) => !removed.includes(row),
      )
    }
    for (const journal of rows(originals, 'acc_journal_entries').filter(
      (row) => row.vou_approval_entry_id === oldEntry,
    )) {
      const lines = rows(originals, 'acc_journal_lines').filter(
        (row) => row.journal_entry_id === journal.id,
      )
      preserve(plan, 'acc_journal_entries', journal)
      for (const line of lines) preserve(plan, 'acc_journal_lines', line)
      target.acc_journal_entries = rows(target, 'acc_journal_entries').filter(
        (row) => row.id !== journal.id,
      )
      target.acc_journal_lines = rows(target, 'acc_journal_lines').filter(
        (row) => row.journal_entry_id !== journal.id,
      )
      const remainders = new Map(
        lines.map((row) => [str(row.id), fixed(row.amount)]),
      )
      for (const [index, mapping] of mappings.entries()) {
        const journalId = assignedId(
          `receipt-journal:${journal.id}:${mapping.customerId}`,
        )
        rows(target, 'acc_journal_entries').push({
          ...journal,
          id: journalId,
          vou_document_id: mapping.documentId,
          vou_approval_entry_id: mapping.entryId,
        })
        for (const line of lines) {
          const customer = record(line.dimensions).CUSTOMER_SUBUNIT
          let amount: bigint
          if (customer) {
            const selected = customerFor(
              plan,
              str(customer),
              'acc_journal_lines',
              str(line.id),
            )
            if (!selected || selected.customerId !== mapping.customerId)
              continue
            amount = fixed(line.amount)
          } else {
            amount =
              index === mappings.length - 1
                ? remainders.get(str(line.id))!
                : (fixed(line.amount) * BigInt(mapping.amountMinor)) / total
            remainders.set(str(line.id), remainders.get(str(line.id))! - amount)
          }
          if (amount)
            rows(target, 'acc_journal_lines').push({
              ...line,
              id: assignedId(`receipt-line:${line.id}:${mapping.customerId}`),
              journal_entry_id: journalId,
              amount: decimal(amount),
            })
        }
      }
      for (const table of ['acc_inventory_entries', 'acc_register_entries'])
        if (
          rows(originals, table).some(
            (row) => row.journal_entry_id === journal.id,
          )
        )
          plan.review.push({
            kind: 'RECEIPT_NON_CASH_POSTING',
            table,
            identity: str(journal.id),
          })
    }
  }
  const dependencies = rows(target, 'vou_intermediary_dependencies')
  target.vou_intermediary_dependencies = dependencies.flatMap((row) => {
    const mappings = plan.receipts.filter(
      (item) =>
        item.oldDocumentId === row.source_document_id &&
        item.documentId !== item.oldDocumentId,
    )
    if (!mappings.length) return [row]
    preserve(plan, 'vou_intermediary_dependencies', row)
    return mappings.map((item) => ({
      ...row,
      source_document_id: item.documentId,
    }))
  })
  // Resolve downstream references by their own adopted customer. If a workflow
  // or source has no customer discriminator, expose that ambiguity for review.
  for (const [table, data] of Object.entries(target)) {
    if (
      ['vou_documents', 'approval_events', 'app_audit_events'].includes(table)
    )
      continue
    for (const row of data)
      for (const field of [
        'parent_document_id',
        'root_document_id',
        'document_id',
        'source_document_id',
        'receipt_document_id',
        'target_document_id',
      ]) {
        const options = plan.receipts.filter(
          (item) =>
            item.oldDocumentId === row[field] &&
            item.documentId !== item.oldDocumentId,
        )
        if (!options.length) continue
        const adopted = rows(target, 'vou_reference_snapshots').filter(
          (ref) =>
            ref.approval_entry_id === row.approval_entry_id &&
            (row.line_no === undefined ||
              ref.line_no === row.line_no ||
              ref.line_no === 0),
        )
        const customerIds = adopted
          .map(
            (ref) =>
              customerFor(
                plan,
                str(ref.object_id),
                table,
                str(row.id ?? row.approval_entry_id),
              )?.customerId,
          )
          .filter(Boolean)
        const choices = options.filter((item) =>
          customerIds.includes(item.customerId),
        )
        if (choices.length !== 1) {
          plan.review.push({
            kind: 'RECEIPT_SOURCE_AMBIGUOUS',
            table,
            identity: str(row.id ?? row.approval_entry_id),
            field,
          })
          continue
        }
        preserve(plan, table, row)
        row[field] = choices[0]!.documentId
        if (field === 'receipt_document_id' && 'receipt_document_no' in row)
          row.receipt_document_no = rows(target, 'vou_documents').find(
            (item) => item.id === row[field],
          )?.document_no
      }
  }
  // References to a removed receipt version must never be left for an FK failure
  // during apply: report the unresolved consumer in the read-only review first.
  for (const [table, data] of Object.entries(target)) {
    if (table === 'vou_amount_allocation_snapshots') continue
    for (const row of data)
      for (const [field, value] of Object.entries(row)) {
        if (!field.endsWith('entry_id')) continue
        if (
          plan.receipts.some(
            (item) =>
              item.oldEntryId === value && item.entryId !== item.oldEntryId,
          )
        )
          plan.review.push({
            kind: 'RECEIPT_VERSION_REFERENCE_AMBIGUOUS',
            table,
            identity: str(row.id ?? row.approval_entry_id),
            field,
          })
      }
  }
  delete target.vou_amount_allocation_snapshots
}
