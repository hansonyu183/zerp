import { createHash } from 'node:crypto'
import { ulid } from 'ulid'
import type { TaxInformationSnapshot } from '@zerp/model'

// This is a one-shot conversion of the #438 storage format. No runtime reader
// imports this module; original rows remain recovery/audit evidence only.
export type Row = Record<string, unknown>
export type Tables = Record<string, Row[]>
export interface ReviewItem {
  kind: string
  table: string
  identity: string
  field?: string
}
export interface CustomerMap {
  oldCustomerId: string
  oldSubunitId: string
  customerId: string
  code: string
  enabled: boolean
}
export interface VersionMap {
  oldEntryId: string
  oldSubunitId: string
  customerId: string
  entryId: string
}
export interface ReceiptMap {
  oldDocumentId: string
  oldEntryId: string
  customerId: string
  documentId: string
  entryId: string
  amountMinor: string
}
export interface ConversionPlan {
  tables: Tables
  customers: CustomerMap[]
  versions: VersionMap[]
  receipts: ReceiptMap[]
  review: ReviewItem[]
  evidence: Tables
}
export const rows = (tables: Tables, name: string) => tables[name] ?? []
export const str = (value: unknown): string =>
  typeof value === 'string' ? value : value == null ? '' : String(value)
export const record = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : {}
export const list = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : []
export function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export const digest = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex')
export function assignedId(key: string) {
  let counter = 0
  return ulid(
    1,
    () =>
      createHash('sha256')
        .update(`${key}:${counter++}`)
        .digest()
        .readUInt32BE(0) / 0x100000000,
  )
}
export function preserve(plan: ConversionPlan, table: string, row: Row) {
  const saved = (plan.evidence[table] ??= [])
  if (!saved.some((item) => canonical(item) === canonical(row)))
    saved.push(structuredClone(row))
}
function allocateCustomerCode(plan: ConversionPlan) {
  const counters = rows(plan.tables, 'archive_code_counters')
  const counter = counters.find((row) => row.entity === 'customer')!
  const used = new Set(rows(plan.tables, 'dcl_subjects').map((row) => row.code))
  let next = Number(counter.next_value)
  while (used.has(`CUS-${String(next).padStart(4, '0')}`)) next++
  if (next >= 9999) throw new Error('customer_cutover_code_exhausted')
  counter.next_value = next + 1
  return `CUS-${String(next).padStart(4, '0')}`
}
function taxInformation(
  plan: ConversionPlan,
  table: string,
  row: Row,
  owner: Row,
): TaxInformationSnapshot[] {
  const information = {
    name: str(
      table === 'dcl_customer_versions'
        ? row.invoice_title || row.legal_name
        : row.legal_name,
    ).trim(),
    taxNumber: str(row.legal_identifier).replace(/\s/g, '').toUpperCase(),
    registeredAddress: str(
      table === 'dcl_customer_versions' ? row.invoice_address : null,
    ).trim(),
    phone: str(
      table === 'dcl_customer_versions' ? row.invoice_phone : null,
    ).trim(),
    bank: str(row.invoice_bank).trim(),
    accountNumber: str(row.invoice_account).trim(),
    remark: '',
  }
  if (
    !information.name ||
    !information.taxNumber ||
    Boolean(information.bank) !== Boolean(information.accountNumber)
  ) {
    plan.review.push({
      kind: 'TAX_REQUIRED_INFORMATION',
      table,
      identity: str(row.approval_entry_id),
    })
    return []
  }
  const existing = rows(plan.tables, 'aux_objects').find(
    (item) =>
      item.entity === 'tax-information' &&
      record(item.data).taxNumber === information.taxNumber,
  )
  if (existing) {
    if (canonical(existing.data) !== canonical(information))
      plan.review.push({
        kind: 'TAX_CONTENT_CONFLICT',
        table,
        identity: str(row.approval_entry_id),
        field: 'legal_identifier',
      })
    return [
      {
        ...information,
        id: str(existing.id),
        code: str(existing.code),
        revision: str(existing.revision),
      },
    ]
  }
  const occupied = new Set(
    rows(plan.tables, 'aux_objects').map((item) => item.code),
  )
  let next = 1
  while (occupied.has(`TAX-${String(next).padStart(4, '0')}`)) next++
  if (next > 9999) throw new Error('customer_cutover_code_exhausted')
  const id = assignedId(`tax:${information.taxNumber}`),
    code = `TAX-${String(next).padStart(4, '0')}`
  rows(plan.tables, 'aux_objects').push({
    id,
    entity: 'tax-information',
    code,
    data: information,
    enabled: true,
    revision: '1',
    created_by: owner.submitted_by,
    updated_by: owner.updated_by,
    created_at: owner.submitted_at,
    updated_at: owner.updated_at,
  })
  return [{ ...information, id, code, revision: '1' }]
}
function commonField(
  plan: ConversionPlan,
  root: Row,
  child: Row,
  rootKey: string,
  childKey: string,
) {
  const a = str(root[rootKey]).trim(),
    b = str(child[childKey]).trim()
  if (a && b && a !== b)
    plan.review.push({
      kind: 'CUSTOMER_ATTRIBUTE_CONFLICT',
      table: 'dcl_customer_versions',
      identity: str(root.approval_entry_id),
      field: `${rootKey}/${childKey}`,
    })
  return b || a || null
}
function customerVersion(
  plan: ConversionPlan,
  root: Row,
  child: Row,
  entry: Row,
  mapping: CustomerMap,
  projectedEntryId: string,
) {
  const attachments = new Map<string, unknown>()
  for (const item of [
    ...list(root.tax_attachments),
    ...list(child.business_attachments),
  ]) {
    const id = str(record(item).id)
    if (
      !id ||
      (attachments.has(id) &&
        canonical(attachments.get(id)) !== canonical(item))
    )
      plan.review.push({
        kind: 'ATTACHMENT_CONFLICT',
        table: 'dcl_customer_versions',
        identity: str(entry.id),
      })
    attachments.set(id, item)
  }
  const name =
    mapping.customerId === mapping.oldCustomerId
      ? root.display_name
      : `${root.display_name} · ${child.name}`
  if (str(name).length > 200)
    plan.review.push({
      kind: 'CUSTOMER_NAME_TOO_LONG',
      table: 'dcl_customer_versions',
      identity: str(entry.id),
    })
  const result: Row = {
    approval_entry_id: projectedEntryId,
    display_name: name,
    default_operating_entity_id: root.default_operating_entity_id,
    default_operating_entity_code: root.default_operating_entity_code,
    default_operating_entity_name: root.default_operating_entity_name,
    phone: commonField(plan, root, child, 'phone', 'contact_phone'),
    email: root.email,
    address: commonField(plan, root, child, 'address', 'business_address'),
    contact_name: child.contact_name,
    attachments: [...attachments.values()],
    remittance_profiles: root.remittance_profiles,
    tax_information: taxInformation(plan, 'dcl_customer_versions', root, entry),
  }
  for (const key of [
    'customer_type_id',
    'customer_type_snapshot',
    'settlement_method_id',
    'primary_sales_attribution_type',
    'primary_sales_attribution_object_id',
    'primary_sales_attribution_approval_entry_id',
    'primary_sales_attribution_code',
    'primary_sales_attribution_name',
    'sales_attribution_snapshot',
    'settlement_snapshot',
    'payment_snapshot',
    'transport_snapshot',
    'pricing_snapshot',
    'credit_limits',
    'internal_reminder',
    'default_order_remark',
  ])
    result[key] = child[key]
  return result
}
export function projectArchives(source: Tables): ConversionPlan {
  const plan: ConversionPlan = {
    tables: structuredClone(source),
    customers: [],
    versions: [],
    receipts: [],
    review: [],
    evidence: {},
  }
  const target = plan.tables
  target.dcl_customer_versions = []
  const entries = rows(source, 'approval_entries'),
    roots = rows(source, 'dcl_customer_subunit_roots'),
    children = rows(source, 'dcl_customer_version_subunits')
  const sourceCustomers = rows(source, 'dcl_subjects').filter(
    (row) => row.entity === 'customer',
  )
  for (const subject of sourceCustomers) {
    const versions = entries
      .filter(
        (row) =>
          row.domain === 'dcl' &&
          row.entity === 'customer' &&
          row.subject_id === subject.id,
      )
      .sort((a, b) => Number(a.version_no) - Number(b.version_no))
    const ids = new Set(versions.map((row) => row.id))
    const union = [
      ...new Set(
        children
          .filter((row) => ids.has(row.customer_approval_entry_id))
          .map((row) => str(row.subunit_id)),
      ),
    ].sort()
    for (const entry of versions)
      if (!children.some((row) => row.customer_approval_entry_id === entry.id))
        plan.review.push({
          kind: 'CUSTOMER_WITHOUT_HISTORICAL_CONTENT',
          table: 'dcl_customer_versions',
          identity: str(entry.id),
        })
    const current = versions.filter((row) => row.status === 'APPROVED').at(-1)
    const enabled = rows(source, 'bob_objects').find(
      (row) => row.id === subject.id,
    )
    if (
      !union.length ||
      roots.some(
        (row) =>
          row.customer_id === subject.id &&
          !union.includes(str(row.subunit_id)),
      )
    )
      plan.review.push({
        kind: 'CUSTOMER_WITHOUT_HISTORICAL_CONTENT',
        table: 'dcl_subjects',
        identity: str(subject.id),
      })
    for (const subunitId of union) {
      const root = roots.find((row) => row.subunit_id === subunitId)
      if (!root || root.customer_id !== subject.id)
        plan.review.push({
          kind: 'CUSTOMER_OWNERSHIP_CONFLICT',
          table: 'dcl_customer_subunit_roots',
          identity: subunitId,
        })
      const customerId =
        union.length === 1
          ? str(subject.id)
          : assignedId(`customer:${subject.id}:${subunitId}`)
      const code =
        union.length === 1 ? str(subject.code) : allocateCustomerCode(plan)
      const available = Boolean(
        enabled?.enabled &&
        current &&
        children.some(
          (row) =>
            row.customer_approval_entry_id === current.id &&
            row.subunit_id === subunitId &&
            row.enabled,
        ),
      )
      const mapping = {
        oldCustomerId: str(subject.id),
        oldSubunitId: subunitId,
        customerId,
        code,
        enabled: available,
      }
      plan.customers.push(mapping)
      if (customerId !== subject.id) {
        rows(target, 'dcl_subjects').push({ ...subject, id: customerId, code })
        rows(target, 'bob_objects').push({
          id: customerId,
          enabled: available,
          revision: enabled?.revision ?? '1',
        })
      } else if (enabled)
        rows(target, 'bob_objects').find(
          (row) => row.id === subject.id,
        )!.enabled = available
      for (const entry of versions) {
        const child = children.find(
          (row) =>
            row.customer_approval_entry_id === entry.id &&
            row.subunit_id === subunitId,
        )
        if (!child) continue
        const rootVersion = rows(source, 'dcl_customer_versions').find(
          (row) => row.approval_entry_id === entry.id,
        )
        if (!rootVersion) {
          plan.review.push({
            kind: 'CUSTOMER_VERSION_MISSING',
            table: 'dcl_customer_versions',
            identity: str(entry.id),
          })
          continue
        }
        const entryId =
          union.length === 1
            ? str(entry.id)
            : assignedId(`entry:${entry.id}:${subunitId}`)
        plan.versions.push({
          oldEntryId: str(entry.id),
          oldSubunitId: subunitId,
          customerId,
          entryId,
        })
        rows(target, 'dcl_customer_versions').push(
          customerVersion(plan, rootVersion, child, entry, mapping, entryId),
        )
        if (entryId !== entry.id) {
          rows(target, 'approval_entries').push({
            ...entry,
            id: entryId,
            subject_id: customerId,
          })
          for (const event of rows(source, 'approval_events').filter(
            (row) => row.entry_id === entry.id,
          ))
            rows(target, 'approval_events').push({
              ...event,
              id: assignedId(`event:${event.id}:${subunitId}`),
              entry_id: entryId,
              subject_id: customerId,
            })
          for (const attachment of rows(
            source,
            'dcl_customer_attachments',
          ).filter((row) => row.approval_entry_id === entry.id)) {
            const snapshot = rows(target, 'dcl_customer_versions').find(
              (row) => row.approval_entry_id === entryId,
            )!
            if (
              list(snapshot.attachments).some(
                (item) => record(item).id === attachment.file_id,
              )
            )
              rows(target, 'dcl_customer_attachments').push({
                ...attachment,
                approval_entry_id: entryId,
              })
          }
        }
      }
    }
    if (union.length > 1) {
      // Keep the old stable identity reserved. It has no formal object or live
      // version after the split; the old snapshots/events belong to evidence.
      for (const [table, matches] of [
        ['bob_objects', (row: Row) => row.id === subject.id],
        ['approval_entries', (row: Row) => ids.has(row.id)],
        [
          'approval_events',
          (row: Row) =>
            row.domain === 'dcl' &&
            row.entity === 'customer' &&
            row.subject_id === subject.id,
        ],
        [
          'dcl_customer_attachments',
          (row: Row) => ids.has(row.approval_entry_id),
        ],
        [
          'bob_legacy_enablement_evidence',
          (row: Row) => ids.has(row.approval_entry_id),
        ],
        [
          'archive_idempotency',
          (row: Row) =>
            row.entity === 'customer' && row.subject_id === subject.id,
        ],
      ] as const) {
        for (const row of rows(target, table).filter(matches))
          preserve(plan, table, row)
        target[table] = rows(target, table).filter((row) => !matches(row))
      }
    }
  }
  for (const row of rows(target, 'dcl_supplier_versions')) {
    preserve(plan, 'dcl_supplier_versions', row)
    const owner = entries.find((entry) => entry.id === row.approval_entry_id)
    if (!owner || owner.entity !== 'supplier' || owner.domain !== 'dcl') {
      plan.review.push({
        kind: 'SUPPLIER_VERSION_MISSING',
        table: 'dcl_supplier_versions',
        identity: str(row.approval_entry_id),
      })
      continue
    }
    row.tax_information = taxInformation(
      plan,
      'dcl_supplier_versions',
      row,
      owner,
    )
    delete row.kind
    delete row.legal_name
    delete row.legal_identifier
  }
  for (const version of rows(source, 'dcl_customer_versions'))
    if (
      !plan.versions.some(
        (item) => item.oldEntryId === version.approval_entry_id,
      )
    )
      plan.review.push({
        kind: 'UNMAPPABLE_CUSTOMER_VERSION',
        table: 'dcl_customer_versions',
        identity: str(version.approval_entry_id),
      })
  for (const table of [
    'dcl_customer_versions',
    'dcl_customer_subunit_roots',
    'dcl_customer_version_subunits',
  ])
    for (const row of rows(source, table)) preserve(plan, table, row)
  delete target.dcl_customer_subunit_roots
  delete target.dcl_customer_version_subunits
  return plan
}
