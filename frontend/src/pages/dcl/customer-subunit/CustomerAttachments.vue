<script setup lang="ts">
import { computed, ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import { downloadBlob } from '@/utils/download'
import { useSessionStore } from '@/stores/session'
import {
  createCustomerAttachmentDownload,
  initiateCustomerAttachment,
  removeCustomerAttachment,
} from './attachments'
import type { components } from '@/api/generated/schema'

type DclCustomerAttachmentView =
  components['schemas']['DclCustomerAttachmentView']

const props = defineProps<{
  scope: 'CUSTOMER' | 'CUSTOMER_SUBUNIT'
  ownerApprovalEntryId: string
  subunitId?: string
  approvalRevision: number
  attachments: readonly DclCustomerAttachmentView[]
  editable: boolean
}>()
const emit = defineEmits<{ changed: [] }>()
const session = useSessionStore()
const categoryObjectId = ref('')
const busy = ref(false)
const errorMessage = ref<string | null>(null)
const attachmentStatusText = { PENDING: '等待上传', READY: '可下载' } as const
const canInitiate = computed(
  () =>
    props.editable &&
    session.can(
      props.scope === 'CUSTOMER_SUBUNIT'
        ? '/dcl/customer/save-subunits'
        : '/dcl/customer/attachment-initiate',
    ),
)
const canDownload = computed(() =>
  session.can('/dcl/customer/get'),
)
const canRemove = computed(
  () =>
    props.editable &&
    session.can(
      props.scope === 'CUSTOMER_SUBUNIT'
        ? '/dcl/customer/save-subunits'
        : '/dcl/customer/attachment-remove',
    ),
)

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('')
}

async function upload(value: File | File[] | null): Promise<void> {
  const file = Array.isArray(value) ? value[0] : value
  if (
    !file ||
    !canInitiate.value ||
    !categoryObjectId.value.trim() ||
    busy.value
  )
    return
  busy.value = true
  errorMessage.value = null
  try {
    const { data } = await initiateCustomerAttachment({
      scope: props.scope,
      ownerApprovalEntryId: props.ownerApprovalEntryId,
      ...(props.scope === 'CUSTOMER_SUBUNIT' ? { subunitId: props.subunitId } : {}),
      approvalRevision: props.approvalRevision,
      categoryObjectId: categoryObjectId.value.trim(),
      fileName: file.name,
      contentType: file.type as 'application/pdf' | 'image/jpeg' | 'image/png',
      size: file.size,
      sha256: await sha256(file),
    })
    await apiClient.uploadCustomerAttachment(data.uploadUrl, file)
    emit('changed')
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    busy.value = false
  }
}

async function download(attachment: DclCustomerAttachmentView): Promise<void> {
  if (!canDownload.value || busy.value) return
  busy.value = true
  try {
    const { data } = await createCustomerAttachmentDownload({
      scope: props.scope,
      ownerApprovalEntryId: props.ownerApprovalEntryId,
      ...(props.scope === 'CUSTOMER_SUBUNIT' ? { subunitId: props.subunitId } : {}),
      fileId: attachment.fileId,
    })
    downloadBlob(
      await apiClient.fetchCustomerAttachment(data.downloadUrl),
      attachment.fileName,
    )
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    busy.value = false
  }
}

async function remove(attachment: DclCustomerAttachmentView): Promise<void> {
  if (!canRemove.value || busy.value) return
  busy.value = true
  try {
    await removeCustomerAttachment({
      scope: props.scope,
      ownerApprovalEntryId: props.ownerApprovalEntryId,
      ...(props.scope === 'CUSTOMER_SUBUNIT' ? { subunitId: props.subunitId } : {}),
      approvalRevision: props.approvalRevision,
      fileId: attachment.fileId,
    })
    emit('changed')
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <v-alert v-if="errorMessage" class="mb-3" type="error" variant="tonal">{{
    errorMessage
  }}</v-alert>
  <div v-if="canInitiate" class="d-flex ga-3 align-start mb-3">
    <v-text-field
      v-model="categoryObjectId"
      label="附件类别 ID"
      density="compact"
    />
    <v-file-input
      accept="application/pdf,image/jpeg,image/png"
      density="compact"
      label="上传附件"
      :loading="busy"
      @update:model-value="upload"
    />
  </div>
  <v-list v-if="attachments.length" density="compact">
    <v-list-item
      v-for="attachment in attachments"
      :key="attachment.fileId"
      :title="attachment.fileName"
      :subtitle="`${attachment.categoryCode} · ${attachmentStatusText[attachment.status]}`"
    >
      <template #append>
        <v-btn
          icon="mdi-download-outline"
          variant="text"
          :disabled="!canDownload || busy || attachment.status !== 'READY'"
          @click="download(attachment)"
        />
        <v-btn
          v-if="canRemove"
          icon="mdi-delete-outline"
          color="error"
          variant="text"
          :disabled="busy"
          @click="remove(attachment)"
        />
      </template>
    </v-list-item>
  </v-list>
  <div v-else class="text-medium-emphasis">暂无附件</div>
</template>
