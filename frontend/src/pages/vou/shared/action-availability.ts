import { computed, type Ref } from 'vue'
import type {
  VoucherActionAvailability,
  VoucherDocumentView,
  VoucherEntityConfig,
} from '@/components/voucher'

export function useVoucherActionAvailability(
  config: VoucherEntityConfig,
  documentView: Ref<VoucherDocumentView | null>,
  can: (permission: string) => boolean,
) {
  const permission = (action: string) => `/vou/${config.entity}/${action}`

  return computed<VoucherActionAvailability>(() => {
    const status = documentView.value?.approval.status
    const lifecycleActions = new Set(
      documentView.value?.availableApprovalActions ?? [],
    )
    return {
      get: can(permission('get')),
      save: status === 'DRAFT' && can(permission('save')),
      submit: lifecycleActions.has('submit'),
      unsubmit: lifecycleActions.has('unsubmit'),
      reject: lifecycleActions.has('reject'),
      approve: lifecycleActions.has('approve'),
      unapprove: lifecycleActions.has('unapprove'),
      delete: status === 'DRAFT' && can(permission('delete')),
      audit: Boolean(documentView.value) && can(permission('audit-history')),
      attachmentInitiate:
        status === 'DRAFT' && can(permission('attachment-initiate')),
      attachmentDownload:
        Boolean(documentView.value) && can(permission('attachment-download')),
      attachmentRemove:
        status === 'DRAFT' && can(permission('attachment-remove')),
    }
  })
}
