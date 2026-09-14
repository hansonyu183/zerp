import {
  assignedId,
  canonical,
  list,
  preserve,
  record,
  rows,
  str,
  type ConversionPlan,
  type CustomerMap,
  type Row,
} from './plan.ts'

export function customerFor(
  plan: ConversionPlan,
  objectId: string,
  table: string,
  identity: string,
): CustomerMap | undefined {
  const exact = plan.customers.find((item) => item.oldSubunitId === objectId)
  if (exact) return exact
  const root = plan.customers.filter((item) => item.oldCustomerId === objectId)
  if (root.length > 1)
    plan.review.push({ kind: 'AMBIGUOUS_CUSTOMER_REFERENCE', table, identity })
  return root.length === 1 ? root[0] : undefined
}
export function entryFor(
  plan: ConversionPlan,
  customer: CustomerMap,
  entryId: string,
  table: string,
  identity: string,
) {
  const version = plan.versions.find(
    (item) =>
      item.oldSubunitId === customer.oldSubunitId &&
      item.oldEntryId === entryId,
  )
  if (!version)
    plan.review.push({ kind: 'UNMAPPABLE_CUSTOMER_VERSION', table, identity })
  return version?.entryId ?? entryId
}
const vocabulary = (text: string) =>
  text
    .replace(/\bCUSTOMER_SUBUNIT\b/g, 'CUSTOMER')
    .replace(/\bcustomerSubunitId\b/g, 'customerId')
    .replace(/\bcustomerSubunit\b/g, 'customer')
    .replace(/\bcustomer-subunit\b/g, 'customer')
function reference(
  plan: ConversionPlan,
  value: Row,
  table: string,
  identity: string,
): Row {
  const objectId = str(value.objectId)
  const mapping = customerFor(plan, objectId, table, identity)
  if (!mapping) return value
  const entryId = value.approvalEntryId
    ? entryFor(plan, mapping, str(value.approvalEntryId), table, identity)
    : undefined
  const snapshot = entryId
    ? rows(plan.tables, 'dcl_customer_versions').find(
        (row) => row.approval_entry_id === entryId,
      )
    : undefined
  const output: Row = {
    ...value,
    objectId: mapping.customerId,
    ...(entryId ? { approvalEntryId: entryId } : {}),
    ...(value.code ? { code: mapping.code } : {}),
    ...(snapshot && value.name ? { name: snapshot.display_name } : {}),
  }
  delete output.customerId
  return output
}
export function rewriteValue(
  plan: ConversionPlan,
  value: unknown,
  table: string,
  identity: string,
  key = '',
): unknown {
  if (Array.isArray(value))
    return value.map((item) => rewriteValue(plan, item, table, identity, key))
  if (value instanceof Date || value == null) return value
  if (typeof value === 'string') {
    if (
      key === 'CUSTOMER' ||
      key === 'CUSTOMER_SUBUNIT' ||
      key === 'customerSubunitId'
    )
      return (
        customerFor(plan, value, table, identity)?.customerId ??
        vocabulary(value)
      )
    // Only protocol identifiers and executable field expressions are rewritten;
    // free-form historical business names and remarks retain their text.
    if (
      [
        'entity',
        'dimension',
        'field',
        'path',
        'source',
        'sourceField',
        'expression',
        'script',
        'script_source',
        'sql_text',
        'amountField',
        'currencyField',
        'quantityField',
        'subjectValue',
        'headerFields',
        'lineFields',
        'reference_entity',
        'counterparty_type',
      ].includes(key) ||
      [
        'CUSTOMER_SUBUNIT',
        'customer-subunit',
        'customerSubunit',
        'customerSubunitId',
      ].includes(value)
    )
      return vocabulary(value)
    return value
  }
  if (typeof value !== 'object') return value
  const original = record(value)
  const mapped = original.objectId
    ? reference(plan, original, table, identity)
    : original
  const output: Row = {}
  for (const [field, item] of Object.entries(mapped))
    output[field === 'subunit' ? 'customer' : vocabulary(field)] = rewriteValue(
      plan,
      item,
      table,
      identity,
      field,
    )
  return output
}
export function convertReferences(plan: ConversionPlan) {
  const target = plan.tables
  for (const table of [
    'acc_container_entries',
    'acc_opening_container_balances',
  ]) {
    for (const row of rows(target, table)) {
      preserve(plan, table, row)
      const mapping = customerFor(
        plan,
        str(row.customer_subunit_id),
        table,
        str(row.id ?? row.opening_approval_entry_id),
      )
      if (!mapping || mapping.oldCustomerId !== row.customer_id) {
        plan.review.push({
          kind: 'CONTAINER_CUSTOMER_MISMATCH',
          table,
          identity: str(row.customer_subunit_id),
        })
        continue
      }
      row.customer_id = mapping.customerId
      row.customer_approval_entry_id = entryFor(
        plan,
        mapping,
        str(row.customer_approval_entry_id),
        table,
        str(row.id ?? row.opening_approval_entry_id),
      )
      if (table === 'acc_opening_container_balances') {
        row.customer_code = mapping.code
        row.customer_name = rows(target, 'dcl_customer_versions').find(
          (item) => item.approval_entry_id === row.customer_approval_entry_id,
        )?.display_name
        delete row.customer_subunit_code
        delete row.customer_subunit_name
      }
      delete row.customer_subunit_id
    }
  }
  for (const row of rows(target, 'vou_reference_snapshots')) {
    const mapping = customerFor(
      plan,
      str(row.object_id),
      'vou_reference_snapshots',
      `${row.approval_entry_id}:${row.field}:${row.line_no}`,
    )
    if (!mapping) {
      if (
        ['customer-subunit', 'customer'].includes(str(row.reference_entity)) ||
        /customerSubunit|^subunit$/.test(str(row.field))
      )
        plan.review.push({
          kind: 'UNMAPPABLE_CUSTOMER_REFERENCE',
          table: 'vou_reference_snapshots',
          identity: str(row.approval_entry_id),
          field: str(row.field),
        })
      continue
    }
    preserve(plan, 'vou_reference_snapshots', row)
    const entry = entryFor(
      plan,
      mapping,
      str(row.approval_reference_id),
      'vou_reference_snapshots',
      str(row.approval_entry_id),
    )
    const snapshot = rows(target, 'dcl_customer_versions').find(
      (item) => item.approval_entry_id === entry,
    )
    row.object_id = mapping.customerId
    row.approval_reference_id = entry
    row.reference_entity = 'customer'
    row.reference_code = mapping.code
    row.reference_name = snapshot?.display_name
  }
  // A deleted/converted submission is never reconstructed by an idempotency
  // response. Old request evidence is retained with the migration, while all
  // sessions are revoked before the new executable contract becomes available.
  for (const table of ['archive_idempotency', 'vou_idempotency']) {
    const obsolete = rows(target, table).filter(
      (row) =>
        table === 'vou_idempotency' ||
        row.entity === 'customer' ||
        row.entity === 'supplier',
    )
    for (const row of obsolete) preserve(plan, table, row)
    target[table] = rows(target, table).filter((row) => !obsolete.includes(row))
  }
  const oldAux = rows(target, 'aux_reference_facts')
  target.aux_reference_facts = []
  for (const row of oldAux) {
    const match = /^dcl:customer:([^:]+):/.exec(str(row.source))
    if (!match) {
      rows(target, 'aux_reference_facts').push(row)
      continue
    }
    preserve(plan, 'aux_reference_facts', row)
    for (const version of plan.versions.filter(
      (item) => item.oldEntryId === match[1],
    )) {
      const content = rows(target, 'dcl_customer_versions').find(
        (item) => item.approval_entry_id === version.entryId,
      )
      if (
        content &&
        canonical(content).includes(JSON.stringify(row.aux_object_id))
      )
        rows(target, 'aux_reference_facts').push({
          ...row,
          id:
            version.entryId === match[1]
              ? row.id
              : assignedId(`aux-reference:${row.id}:${version.entryId}`),
          source: `dcl:customer:${version.entryId}:converted`,
        })
    }
  }
  for (const entity of ['customer', 'supplier'])
    for (const row of rows(target, `dcl_${entity}_versions`)) {
      for (const tax of list(row.tax_information))
        rows(target, 'aux_reference_facts').push({
          id: assignedId(
            `tax-reference:${row.approval_entry_id}:${record(tax).id}`,
          ),
          aux_object_id: record(tax).id,
          source: `dcl:${entity}:${row.approval_entry_id}:taxInformation`,
        })
    }
  for (const table of ['acc_mappings', 'acc_mapping_history'])
    for (const row of rows(target, table)) {
      if (
        row.vou_entity !== 'sales-receipt' &&
        record(row.vou_entity_snapshot).code !== 'sales-receipt'
      )
        continue
      const definition = record(row.mapping_definition)
      if (!canonical(definition).includes('subunitAllocations')) continue
      preserve(plan, table, row)
      for (const item of list(definition.templates)) {
        const template = record(item),
          originalCollection = template.collection
        for (const member of list(template.lines)) {
          const line = record(member)
          if (
            (line.collection === undefined
              ? originalCollection
              : line.collection) !== 'subunitAllocations'
          )
            continue
          line.collection = null
          const field = (value: unknown) =>
            typeof value === 'string'
              ? value
                  .replace(/^line\.subunit(?=\.|$)/, 'customer')
                  .replace(/^line\.amount$/, 'amount')
              : value
          for (const key of ['amountField', 'currencyField', 'quantityField'])
            line[key] = field(line[key])
          if (line.subjectSource === 'FIELD')
            line.subjectValue = field(line.subjectValue)
          for (const [key, value] of Object.entries(record(line.dimensions)))
            record(line.dimensions)[key] = field(value)
        }
        if (originalCollection === 'subunitAllocations')
          template.collection = null
      }
    }
  for (const [table, data] of Object.entries(target)) {
    if (
      [
        'dcl_customer_versions',
        'dcl_supplier_versions',
        'app_sessions',
        'app_users',
        'app_audit_events',
        'archive_code_counters',
        'aux_reference_facts',
      ].includes(table)
    )
      continue
    for (let index = 0; index < data.length; index++) {
      const original = data[index]!
      const changed = rewriteValue(
        plan,
        original,
        table,
        str(original.id ?? original.approval_entry_id ?? index),
      ) as Row
      if (canonical(original) !== canonical(changed)) {
        preserve(plan, table, original)
        data[index] = changed
      }
    }
  }
  const removedPermissions = rows(target, 'app_permissions').filter((row) =>
    /\/customer\/save-subunits$/.test(str(row.path)),
  )
  const ids = new Set(removedPermissions.map((row) => row.id))
  for (const table of ['app_permissions', 'app_role_permissions']) {
    const removed = rows(target, table).filter((row) =>
      ids.has(table === 'app_permissions' ? row.id : row.permission_id),
    )
    for (const row of removed) preserve(plan, table, row)
    target[table] = rows(target, table).filter((row) => !removed.includes(row))
  }
}
