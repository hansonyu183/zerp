import {
  emptyProduct,
  validateProduct,
} from '../components/version-page/product-data.ts'
import * as api from '../api.ts'
import { defineVersionPage } from '../components/version-page/definition.ts'
export const productPage = defineVersionPage<'bob/product'>({
  resource: 'bob/product',
  fields: [
    { key: 'name', type: 'text', caption: '名称', required: true },
    { key: 'barcode', type: 'text', caption: '条码' },
    { key: 'specification', type: 'text', caption: '规格' },
    { key: 'model', type: 'text', caption: '型号' },
    { key: 'remark', type: 'textarea', caption: '备注' },
  ],
  adapter: {
    empty: emptyProduct,
    clone: (snapshot) => structuredClone(snapshot),
    validate: validateProduct,
    query: (token, input) =>
      api.queryTargetProducts(token, {
        page: input.page,
        pageSize: input.pageSize,
        filters: input.keyword ? { keyword: input.keyword } : {},
      }),
    current: api.getTargetProduct,
    submissions: (token, input) =>
      api.queryTargetProductSubmissions(token, {
        page: input.page,
        pageSize: input.pageSize,
        filters: input.keyword ? { keyword: input.keyword } : {},
      }),
    submission: api.getTargetProductSubmission,
    versions: api.queryTargetProductVersions,
    audit: api.queryTargetProductAuditHistory,
    submitNew: api.submitNewTargetProduct,
    submitChange: api.submitChangeTargetProduct,
    approve: api.approveTargetProduct,
    reject: api.rejectTargetProduct,
    unreject: api.unrejectTargetProduct,
    unapprove: api.unapproveTargetProduct,
    delete: api.deleteTargetProduct,
    setEnabled: (token, item, enabled) =>
      api.setTargetProductEnabled(
        token,
        { objectId: item.objectId, expectedRevision: item.revision },
        enabled,
      ),
  },
})
