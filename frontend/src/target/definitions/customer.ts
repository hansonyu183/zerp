import {
  emptyCustomer,
  cloneCustomer,
  validateCustomer,
  customerIdentityLabels,
  customerTextFields,
} from '../components/version-page/customer-data.ts'
import * as api from '../api.ts'
import { defineVersionPage } from '../components/version-page/definition.ts'
export const customerPage = defineVersionPage<'bob/customer'>({
  resource: 'bob/customer',
  fields: [
    {
      key: 'identityKind',
      type: 'enum',
      caption: '身份类型',
      options: Object.entries(customerIdentityLabels).map(
        ([value, caption]) => ({ value, caption }),
      ),
    },
    ...customerTextFields.map((field) => ({
      key: field.key,
      type: 'text' as const,
      caption: field.label,
    })),
  ],
  adapter: {
    empty: emptyCustomer,
    clone: cloneCustomer,
    validate: validateCustomer,
    query: (token, input) =>
      api.queryTargetCustomers(token, {
        page: input.page,
        pageSize: input.pageSize,
        filters: input.keyword ? { keyword: input.keyword } : {},
      }),
    current: api.getTargetCustomer,
    submissions: (token, input) =>
      api.queryTargetCustomerSubmissions(token, {
        page: input.page,
        pageSize: input.pageSize,
        filters: input.keyword ? { keyword: input.keyword } : {},
      }),
    submission: api.getTargetCustomerSubmission,
    versions: api.queryTargetCustomerVersions,
    audit: api.queryTargetCustomerAuditHistory,
    submitNew: api.submitNewTargetCustomer,
    submitChange: api.submitChangeTargetCustomer,
    approve: api.approveTargetCustomer,
    reject: api.rejectTargetCustomer,
    unreject: api.unrejectTargetCustomer,
    unapprove: api.unapproveTargetCustomer,
    delete: api.deleteTargetCustomer,
    setEnabled: (token, item, enabled) =>
      api.setTargetCustomerEnabled(
        token,
        { objectId: item.objectId, expectedRevision: item.revision },
        enabled,
      ),
  },
})
