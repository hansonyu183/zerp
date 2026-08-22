import { computed, ref } from 'vue'
import { apiClient, type ApiPostRequest } from '@/api/client'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { downloadBlob } from '@/utils/download'
import { customerApi } from './api'
import { createCustomerForm, creditLimitErrors, pricingPolicyErrors } from './form'
import { customerAccountPayload, customerCreatePayload } from './payload'
import { salesAttributionSubjectEntity, type CustomerAccount, type CustomerAttachment, type CustomerDetail, type CustomerForm, type CustomerListItem, type CustomerReference, type CustomerReferenceKey } from './types'

export type CustomerLifecycleAction = 'submit' | 'unsubmit' | 'approve' | 'reject' | 'enable' | 'disable' | 'delete'
type Mode = 'create' | 'add-account' | 'edit'
interface CustomerFilters { status: string[]; customerType: string; operatingEntityId: string; salesAttributionType: string; salesAttributionSubjectId: string }
const emptyFilters = (): CustomerFilters => ({ status: [], customerType: '', operatingEntityId: '', salesAttributionType: '', salesAttributionSubjectId: '' })
type WireVersion = {
  version: { versionId: string; revision: number; status: string; submittedBy?: string | null }
  data: components['schemas']['CustomerAccountDataView']
  attachments?: CustomerAttachment[]
}
type WireAccount = {
  objectId: string; code: string; objectRevision: number; enabled: boolean
  effective?: WireVersion | null; candidate?: WireVersion | null
}
type WireDetail = Omit<components['schemas']['CustomerDetailView'], 'accounts'> & { accounts: WireAccount[] }

function toReference(value: { sourceObjectId: string; code: string; name: string } | null | undefined, entity: CustomerReference['entity']): CustomerReference | null {
  return value ? { objectId: value.sourceObjectId, versionId: '', code: value.code, name: value.name, entity } : null
}
function accountForm(data: components['schemas']['CustomerAccountDataView'], code = ''): CustomerForm['account'] {
  const attribution = data.primarySalesAttribution
  return {
    ...createCustomerForm().account, code, name: data.name, customerTypeCode: data.customerTypeCode,
    shortName: data.shortName ?? '', contactName: data.contactName ?? '', contactPhone: data.contactPhone ?? '',
    email: data.email ?? '', address: data.address ?? '', operatingEntity: toReference(data.operatingEntity, 'operating-entity'),
    settlementMethod: toReference(data.settlementMethod, 'settlement-method'), paymentMethod: toReference(data.paymentMethod, 'payment-method'),
    defaultTransportMethodCode: data.defaultTransportMethodCode ?? '', defaultTransportMethodName: data.defaultTransportMethodName ?? '',
    transportSurcharge: data.transportSurcharge ?? '0.00', pricingPolicy: data.pricingPolicy,
    creditLimits: data.creditLimits, primarySalesAttribution: {
      type: attribution.type, subject: attribution.subjectObjectId ? { objectId: attribution.subjectObjectId, versionId: attribution.subjectVersionId, code: attribution.subjectCode, name: attribution.subjectName, entity: salesAttributionSubjectEntity(attribution.type) } : null,
    }, internalReminder: data.internalReminder ?? '', defaultSalesOrderRemark: data.defaultSalesOrderRemark ?? '',
  }
}
function detailFromWire(raw: WireDetail): CustomerDetail {
  return {
    objectId: raw.objectId, code: raw.code, objectRevision: raw.objectRevision, enabled: raw.enabled, partyId: raw.partyId,
    partyKind: raw.partyKind, partyDisplayName: raw.partyDisplayName, operatingEntityId: raw.operatingEntityId,
    operatingEntityCode: raw.operatingEntityCode, operatingEntityName: raw.operatingEntityName, attachments: raw.attachments,
    accounts: raw.accounts.map((entry) => {
      const version = entry.candidate ?? entry.effective
      if (!version || !entry.objectId || !entry.code || entry.objectRevision === undefined) throw new Error('客户关系包含不可读取的结算账户。')
      return { objectId: entry.objectId, code: entry.code, objectRevision: entry.objectRevision, enabled: entry.enabled,
        status: version.version.status, versionId: version.version.versionId, revision: version.version.revision,
        data: accountForm(version.data, entry.code), attachments: version.attachments ?? [] }
    }),
  }
}
function listItem(item: components['schemas']['CustomerListItem']): CustomerListItem {
  const current = item.candidate ?? item.effective
  return { objectId: item.objectId, code: item.code, name: current?.name ?? '', enabled: item.enabled, status: current?.status ?? '', customerType: current?.customerTypeCode ?? '', hasCandidate: item.candidate !== null, objectRevision: item.objectRevision, versionId: current?.versionId ?? '', revision: current?.revision ?? 0, submittedBy: current?.submittedBy ?? null }
}

export function useCustomerViewModel() {
  const session = useSessionStore()
  const loading = ref(false); const saving = ref(false); const actionLoading = ref<CustomerLifecycleAction | null>(null)
  const errorMessage = ref<string | null>(null); const successMessage = ref<string | null>(null)
  const rows = ref<CustomerListItem[]>([]); const total = ref(0); const page = ref(1); const pageSize = ref(20); const keyword = ref(''); const filters = ref(emptyFilters())
  const workspaceOpen = ref(false); const mode = ref<Mode>('create'); const form = ref(createCustomerForm()); const detail = ref<CustomerDetail | null>(null); const selectedAccountId = ref('')
  const attachmentLoading = ref(false); const selectedDocumentCategoryId = ref('')
  const partyOptions = ref<components['schemas']['PartyListItem'][]>([])
  const referenceOptions = ref<Record<CustomerReferenceKey, CustomerReference[]>>({ operatingEntity: [], settlementMethod: [], paymentMethod: [], customerType: [], documentCategory: [], employee: [], salesPartner: [] })
  let querySequence = 0; let partySequence = 0; let savedFormSignature = ''
  const requiredReferences = ['/bob/operating-entity/query', '/bob/employee/query', '/bob/sales-partner/query', '/aux/settlement-method/query', '/aux/payment-method/query', '/aux/dictionary-item/query'] as const
  const canQuery = computed(() => session.can('/bob/customer/query'))
  const canCreateNewParty = computed(() => session.can('/bob/customer/create') && session.can('/bob/party/create') && requiredReferences.every((path) => session.can(path)))
  const canCreateExistingParty = computed(() => session.can('/bob/customer/create') && session.can('/bob/party/get') && session.can('/bob/party/query') && requiredReferences.every((path) => session.can(path)))
  const canCreate = computed(() => canCreateNewParty.value || canCreateExistingParty.value)
  const canEdit = computed(() => session.can('/bob/customer/get') && session.can('/bob/customer/save') && requiredReferences.every((path) => session.can(path)))
  const canAddAccount = computed(() => Boolean(detail.value) && session.can('/bob/customer-account/create') && requiredReferences.every((path) => session.can(path)))
  const canDeleteAccount = computed(() => session.can('/bob/customer-account/delete'))
  const canAttachmentInitiate = computed(() => session.can('/bob/customer/attachment-initiate'))
  const canAttachmentDownload = computed(() => session.can('/bob/customer/attachment-download'))
  const canAttachmentRemove = computed(() => session.can('/bob/customer/attachment-remove'))
  const selectedAccount = computed(() => detail.value?.accounts.find((account) => account.objectId === selectedAccountId.value) ?? null)
  const formErrors = computed(() => [
    ...(mode.value === 'create' && form.value.party.mode === 'EXISTING' && !form.value.party.partyId ? ['请选择已有主体。'] : []),
    ...(mode.value === 'create' && form.value.party.mode === 'NEW' && !form.value.party.legalName.trim() ? ['请输入主体法定名称。'] : []),
    ...(form.value.account.name.trim() ? [] : ['请输入客户账户名称。']), ...(form.value.account.operatingEntity ? [] : ['请选择经营主体。']),
    ...(form.value.account.primarySalesAttribution.subject ? [] : ['请选择主要业务归属主体。']), ...pricingPolicyErrors(form.value.account.pricingPolicy), ...creditLimitErrors(form.value.account.creditLimits),
  ])
  const isDirty = computed(() => workspaceOpen.value && JSON.stringify(form.value) !== savedFormSignature)
  const referenceConfigs: Record<CustomerReferenceKey, CustomerReference['entity']> = { operatingEntity: 'operating-entity', settlementMethod: 'settlement-method', paymentMethod: 'payment-method', customerType: 'dictionary-item', documentCategory: 'dictionary-item', employee: 'employee', salesPartner: 'sales-partner' }
  function queryFilters() { const all = { keyword: keyword.value.trim(), ...filters.value }; return Object.fromEntries(Object.entries(all).filter(([, value]) => Array.isArray(value) ? value.length : value !== '')) }
  async function query() { if (!canQuery.value) return; const sequence = ++querySequence; loading.value = true; errorMessage.value = null; try { const result = await customerApi.query({ page: page.value, pageSize: 20, filters: queryFilters(), sort: [{ field: 'code', order: 'asc' }] }); if (sequence !== querySequence) return; rows.value = result.data.items.map(listItem); total.value = result.data.total; page.value = result.data.page; pageSize.value = result.data.pageSize } catch (error) { if (sequence === querySequence) { rows.value = []; total.value = 0; errorMessage.value = getErrorMessage(error) } } finally { if (sequence === querySequence) loading.value = false } }
  async function search() { page.value = 1; await query() }
  async function changePage(value: number) { if (value < 1 || value === page.value || loading.value) return; page.value = value; await query() }
  async function resetFilters() { keyword.value = ''; filters.value = emptyFilters(); await search() }
  async function loadReferenceOptions(key: CustomerReferenceKey, searchKeyword = '') { const entity = referenceConfigs[key]; try { const result = entity === 'operating-entity' || entity === 'employee' || entity === 'sales-partner' ? await customerApi.queryBobReferences({ entity: entity as ApiPostRequest<'bob/reference/query'>['entity'], keyword: searchKeyword.trim() }) : await customerApi.queryAuxReferences({ entity, keyword: searchKeyword.trim(), ...(key === 'customerType' ? { dictionaryTypeCode: 'DCT-0001' } : {}), ...(key === 'documentCategory' ? { dictionaryTypeCode: 'DCT-0003' } : {}) }); const loaded = result.data.map((item) => ({ ...item, entity }) satisfies CustomerReference); const selected = [form.value.account.operatingEntity, form.value.account.settlementMethod, form.value.account.paymentMethod, form.value.account.primarySalesAttribution.subject].filter((item): item is CustomerReference => item?.entity === entity); referenceOptions.value[key] = [...selected, ...loaded].filter((item, index, all) => all.findIndex((candidate) => candidate.objectId === item.objectId) === index) } catch (error) { errorMessage.value = `基础资料加载失败：${getErrorMessage(error)}` } }
  function preloadReferences() { for (const key of Object.keys(referenceConfigs) as CustomerReferenceKey[]) void loadReferenceOptions(key) }
  async function searchParties(keyword = '') { if (!session.can('/bob/party/query')) return; const sequence = ++partySequence; try { const result = await customerApi.partyQuery({ page: 1, pageSize: 20, filters: keyword.trim() ? { keyword: keyword.trim() } : {} }); if (sequence === partySequence) partyOptions.value = result.data?.items ?? [] } catch (error) { if (sequence === partySequence) errorMessage.value = getErrorMessage(error) } }
  function changeSalesAttributionType(value: unknown) { if (value !== 'INTERNAL_EMPLOYEE' && value !== 'EXTERNAL_PART_TIME' && value !== 'CHANNEL_PARTNER') return; if (form.value.account.primarySalesAttribution.type === value) return; form.value.account.primarySalesAttribution = { type: value, subject: null }; void loadReferenceOptions(salesAttributionSubjectEntity(value) === 'employee' ? 'employee' : 'salesPartner') }
  function openCreate() { if (!canCreate.value) return; mode.value = 'create'; detail.value = null; selectedAccountId.value = ''; form.value = createCustomerForm(); if (!canCreateNewParty.value) form.value.party.mode = 'EXISTING'; savedFormSignature = JSON.stringify(form.value); errorMessage.value = null; workspaceOpen.value = true; preloadReferences(); if (canCreateExistingParty.value) void searchParties() }
  function openAddAccount() { if (!canAddAccount.value || !detail.value) return; mode.value = 'add-account'; form.value = createCustomerForm(); form.value.party.mode = 'EXISTING'; form.value.party.partyId = detail.value.partyId; form.value.account.operatingEntity = { objectId: detail.value.operatingEntityId, versionId: '', code: detail.value.operatingEntityCode, name: detail.value.operatingEntityName, entity: 'operating-entity' }; savedFormSignature = JSON.stringify(form.value); workspaceOpen.value = true; preloadReferences() }
  async function openEdit(row: CustomerListItem) { if (!session.can('/bob/customer/get')) return; loading.value = true; errorMessage.value = null; try { const result = await customerApi.get({ objectId: row.objectId }); if (!result.data) throw new Error('客户关系不存在。'); detail.value = detailFromWire(result.data as unknown as WireDetail); const account = detail.value.accounts.find((item) => item.objectId === row.objectId) ?? detail.value.accounts[0]; if (!account) throw new Error('客户关系没有结算账户。'); selectedAccountId.value = account.objectId; form.value = { party: createCustomerForm().party, account: structuredClone(account.data) }; mode.value = 'edit'; savedFormSignature = JSON.stringify(form.value); workspaceOpen.value = true; preloadReferences() } catch (error) { errorMessage.value = getErrorMessage(error) } finally { loading.value = false } }
  function selectAccount(accountId: string) { const account = detail.value?.accounts.find((item) => item.objectId === accountId); if (!account || saving.value) return; selectedAccountId.value = accountId; form.value = { party: createCustomerForm().party, account: structuredClone(account.data) }; mode.value = 'edit'; savedFormSignature = JSON.stringify(form.value) }
  function closeWorkspace() { if (saving.value) return; if (isDirty.value && typeof window !== 'undefined' && !window.confirm('尚有未保存的客户资料，确认放弃修改吗？')) return; workspaceOpen.value = false }
  async function save(): Promise<boolean> { if (saving.value || formErrors.value.length || (mode.value === 'create' ? !canCreate.value : mode.value === 'add-account' ? !canAddAccount.value : !canEdit.value)) return false; saving.value = true; errorMessage.value = null; try { if (mode.value === 'create') await customerApi.create(customerCreatePayload(form.value)); else if (mode.value === 'add-account' && detail.value) await customerApi.accountAdd({ customerRelationshipId: detail.value.objectId, data: customerAccountPayload(form.value.account) }); else if (mode.value === 'edit' && selectedAccount.value) await customerApi.save({ objectId: selectedAccount.value.objectId, versionId: selectedAccount.value.versionId, revision: selectedAccount.value.revision, data: customerAccountPayload(form.value.account) }); workspaceOpen.value = false; savedFormSignature = JSON.stringify(form.value); successMessage.value = mode.value === 'create' ? '客户关系与首个结算账户已创建。' : mode.value === 'add-account' ? '结算账户已新增。' : '结算账户已保存。'; await query(); return true } catch (error) { errorMessage.value = getErrorMessage(error); return false } finally { saving.value = false } }
  async function removeAccount(account: CustomerAccount) { if (!detail.value || !canDeleteAccount.value || detail.value.accounts.length <= 1 || account.status !== 'DRAFT') return false; try { await customerApi.accountDelete({ objectId: account.objectId, versionId: account.versionId, revision: account.revision, objectRevision: account.objectRevision }); await openRelationship(detail.value.objectId); successMessage.value = '结算账户已删除。'; return true } catch (error) { errorMessage.value = getErrorMessage(error); return false } }
  async function openRelationship(objectId: string) { const result = await customerApi.get({ objectId }); if (!result.data) throw new Error('客户关系不存在。'); detail.value = detailFromWire(result.data as unknown as WireDetail); if (!detail.value.accounts.some((item) => item.objectId === selectedAccountId.value)) selectedAccountId.value = detail.value.accounts[0]?.objectId ?? '' }
  function canLifecycleFor(row: CustomerListItem, action: CustomerLifecycleAction) { if (!session.can(`/bob/customer-account/${action}`)) return false; if (action === 'submit') return row.status === 'DRAFT'; if (action === 'unsubmit') return row.status === 'PENDING'; if (action === 'approve' || action === 'reject') return row.status === 'PENDING' && row.submittedBy !== null && row.submittedBy !== session.user?.id; if (action === 'enable') return row.status === 'EFFECTIVE' && !row.hasCandidate && !row.enabled; if (action === 'disable') return row.status === 'EFFECTIVE' && !row.hasCandidate && row.enabled; return false }
  async function runLifecycle(row: CustomerListItem, action: CustomerLifecycleAction, reason = ''): Promise<boolean> { if (actionLoading.value || !canLifecycleFor(row, action)) return false; const normalized = reason.trim(); if ((action === 'unsubmit' || action === 'reject') && !normalized) { errorMessage.value = '请填写操作原因。'; return false }; actionLoading.value = action; try { const base = { objectId: row.objectId, versionId: row.versionId, revision: row.revision }; if (action === 'enable' || action === 'disable') await customerApi[action]({ objectId: row.objectId, objectRevision: row.objectRevision }); else if (action === 'unsubmit') await customerApi.unsubmit({ ...base, objectRevision: row.objectRevision, reason: normalized }); else if (action === 'reject') await customerApi.reject({ ...base, comment: normalized }); else if (action === 'submit') await customerApi.submit(base); else await customerApi.approve(base); await query(); successMessage.value = `${row.code} 已完成生命周期操作。`; return true } catch (error) { errorMessage.value = getErrorMessage(error); return false } finally { actionLoading.value = null } }
  async function sha256(file: File) { const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer()); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('') }
  async function refreshAttachments() { if (detail.value) await openRelationship(detail.value.objectId) }
  async function uploadAttachments(scope: 'RELATIONSHIP' | 'ACCOUNT', files: File[]) { const owner = scope === 'RELATIONSHIP' ? detail.value : selectedAccount.value; if (!owner || !canAttachmentInitiate.value || !selectedDocumentCategoryId.value || !files.length || attachmentLoading.value) return; attachmentLoading.value = true; try { for (const file of files) { const initiated = await customerApi.attachmentInitiate({ scope, ownerId: owner.objectId, revision: owner.objectRevision, categoryObjectId: selectedDocumentCategoryId.value, fileName: file.name, contentType: file.type as 'application/pdf' | 'image/jpeg' | 'image/png', size: file.size, sha256: await sha256(file) }); await apiClient.uploadCustomerAttachment(initiated.data.uploadUrl, file) }; await refreshAttachments() } catch (error) { errorMessage.value = getErrorMessage(error) } finally { attachmentLoading.value = false } }
  async function downloadAttachment(scope: 'RELATIONSHIP' | 'ACCOUNT', attachment: CustomerAttachment) { const owner = scope === 'RELATIONSHIP' ? detail.value : selectedAccount.value; if (!owner || !canAttachmentDownload.value || attachmentLoading.value) return; attachmentLoading.value = true; try { const result = await customerApi.attachmentDownload({ scope, ownerId: owner.objectId, fileId: attachment.fileId }); downloadBlob(await apiClient.fetchCustomerAttachment(result.data.downloadUrl), attachment.fileName) } catch (error) { errorMessage.value = getErrorMessage(error) } finally { attachmentLoading.value = false } }
  async function removeAttachment(scope: 'RELATIONSHIP' | 'ACCOUNT', attachment: CustomerAttachment) { const owner = scope === 'RELATIONSHIP' ? detail.value : selectedAccount.value; if (!owner || !canAttachmentRemove.value || attachmentLoading.value) return; attachmentLoading.value = true; try { await customerApi.attachmentRemove({ scope, ownerId: owner.objectId, revision: owner.objectRevision, fileId: attachment.fileId }); await refreshAttachments() } catch (error) { errorMessage.value = getErrorMessage(error) } finally { attachmentLoading.value = false } }
  return { loading, saving, actionLoading, errorMessage, successMessage, rows, total, page, pageSize, keyword, filters, workspaceOpen, mode, form, detail, selectedAccountId, selectedAccount, attachmentLoading, selectedDocumentCategoryId, partyOptions, referenceOptions, canQuery, canCreate, canCreateNewParty, canCreateExistingParty, canEdit, canAddAccount, canDeleteAccount, canAttachmentInitiate, canAttachmentDownload, canAttachmentRemove, formErrors, isDirty, query, search, changePage, resetFilters, loadReferenceOptions, searchParties, changeSalesAttributionType, openCreate, openAddAccount, openEdit, selectAccount, closeWorkspace, save, removeAccount, uploadAttachments, downloadAttachment, removeAttachment, canLifecycleFor, runLifecycle }
}
export type CustomerViewModel = ReturnType<typeof useCustomerViewModel>
