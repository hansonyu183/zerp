import { identityKindOptions } from '../components/version-page/identity-data.ts'
import * as api from '../api.ts'
import { defineVersionPage } from '../components/version-page/definition.ts'
export const salesPartnerPage = defineVersionPage<'bob/sales-partner'>({
  resource: 'bob/sales-partner',
  fields: [
    { key: 'legalName', type: 'text', caption: '法定名称', required: true },
    { key: 'displayName', type: 'text', caption: '显示名称', required: true },
    { key: 'legalIdentifier', type: 'text', caption: '法定识别号' },
    {
      key: 'identityKind',
      type: 'enum',
      caption: '身份类型',
      options: identityKindOptions,
    },
    { key: 'contactName', type: 'text', caption: '联系人' },
    { key: 'phone', type: 'text', caption: '联系电话' },
    { key: 'address', type: 'textarea', caption: '地址' },
    { key: 'remark', type: 'textarea', caption: '备注' },
  ],
  adapter: {
    empty: () => ({
      identityKind: 'ORGANIZATION',
      legalName: '',
      displayName: '',
      legalIdentifier: '',
      contactName: '',
      phone: '',
      address: '',
      operatingEntities: [],
      defaultOperatingEntityId: null,
      remark: '',
      capabilities: [],
    }),
    clone: (snapshot) => structuredClone(snapshot),
    validate: (snapshot) =>
      snapshot.capabilities.length === 0
        ? '请至少选择一种合作能力。'
        : !snapshot.legalName.trim() || !snapshot.displayName.trim()
          ? '请填写法定名称和显示名称。'
          : snapshot.defaultOperatingEntityId &&
              !snapshot.operatingEntities.some(
                (item) => item.objectId === snapshot.defaultOperatingEntityId,
              )
            ? '默认经营主体必须在适用经营主体内。'
            : null,
    query: (token, input) =>
      api.queryTargetSalesPartners(token, {
        page: input.page,
        pageSize: input.pageSize,
        filters: input.keyword ? { keyword: input.keyword } : {},
      }),
    current: api.getTargetSalesPartner,
    submissions: (token, input) =>
      api.queryTargetSalesPartnerSubmissions(token, {
        page: input.page,
        pageSize: input.pageSize,
        filters: input.keyword ? { keyword: input.keyword } : {},
      }),
    submission: api.getTargetSalesPartnerSubmission,
    versions: api.queryTargetSalesPartnerVersions,
    audit: api.queryTargetSalesPartnerAuditHistory,
    submitNew: api.submitNewTargetSalesPartner,
    submitChange: api.submitChangeTargetSalesPartner,
    approve: api.approveTargetSalesPartner,
    reject: api.rejectTargetSalesPartner,
    unreject: api.unrejectTargetSalesPartner,
    unapprove: api.unapproveTargetSalesPartner,
    delete: api.deleteTargetSalesPartner,
    setEnabled: (token, item, enabled) =>
      api.setTargetSalesPartnerEnabled(
        token,
        { objectId: item.objectId, expectedRevision: item.revision },
        enabled,
      ),
  },
})
