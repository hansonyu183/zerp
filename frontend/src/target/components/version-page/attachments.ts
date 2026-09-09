import type { VouEntity } from '@zerp/model'
import { shallowRef, type InjectionKey } from 'vue'
import { ulid } from 'ulid'
import {
  stageTargetCustomerAttachment,
  stageTargetVoucherAttachment,
  type TargetCustomerAttachmentStageInput,
} from '../../api.ts'
import type { CustomerSnapshot } from './customer-data.ts'
type Attachment = CustomerSnapshot['identityAttachments'][number]
type LocalFile = {
  file: File
  stagingId: string
  metadata: Attachment
  status: string
  staged: boolean
}
export type AttachmentScope = {
  resource: 'bob/customer' | `vou/${VouEntity}`
  add: (file: File) => Promise<Attachment>
  status: (id: string) => string
}
export const attachmentScope: InjectionKey<AttachmentScope> = Symbol(
  'customer-attachments',
)
export function createAttachments(
  resource: 'bob/customer' | `vou/${VouEntity}`,
  token: () => string,
  owns: () => boolean,
) {
  const files = shallowRef(new Map<string, LocalFile>())
  let generation = 0
  function status(id: string, value: string) {
    const file = files.value.get(id)
    if (file)
      files.value = new Map(files.value).set(id, { ...file, status: value })
  }
  async function add(file: File): Promise<Attachment> {
    const version = generation
    if (
      !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) ||
      file.size < 1 ||
      file.size > 10_485_760
    )
      throw new Error('附件仅支持 10 MB 以内的 PDF、JPEG 或 PNG。')
    const bytes = await file.arrayBuffer()
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (value) => value.toString(16).padStart(2, '0'),
    ).join('')
    if (!owns() || version !== generation) throw new Error('编辑会话已关闭。')
    const metadata = {
      id: ulid(),
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      sha256: digest,
    }
    files.value = new Map(files.value).set(metadata.id, {
      file,
      metadata,
      stagingId: ulid(),
      status: '待提交时上传',
      staged: false,
    })
    return metadata
  }
  async function prepare(attachments: readonly Attachment[]) {
    const version = generation
    for (const attachment of attachments) {
      const local = files.value.get(attachment.id)
      if (!local) continue
      if (!owns() || version !== generation) throw new Error('编辑会话已关闭。')
      if (!local.staged) {
        status(attachment.id, '正在上传')
        try {
          const bytes = new Uint8Array(await local.file.arrayBuffer())
          let binary = ''
          for (let i = 0; i < bytes.length; i += 8192)
            binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
          if (!owns() || version !== generation)
            throw new Error('编辑会话已关闭。')
          const input = {
            stagingId: local.stagingId,
            fileId: attachment.id,
            fileName: attachment.fileName,
            mimeType:
              attachment.contentType as TargetCustomerAttachmentStageInput['mimeType'],
            size: attachment.sizeBytes,
            digest: attachment.sha256,
            contentBase64: btoa(binary),
          }
          if (resource === 'bob/customer')
            await stageTargetCustomerAttachment(token(), input)
          else
            await stageTargetVoucherAttachment(
              token(),
              resource.slice(4) as VouEntity,
              input,
            )
          if (!owns() || version !== generation)
            throw new Error('编辑会话已关闭。')
          files.value = new Map(files.value).set(attachment.id, {
            ...local,
            staged: true,
            status: '上传完成',
          })
        } catch (cause) {
          if (owns() && version === generation)
            status(attachment.id, '上传失败，可重新提交重试')
          throw cause
        }
      }
      attachment.stagingId = local.stagingId
    }
  }
  function reset() {
    generation++
    files.value = new Map()
  }
  return {
    scope: {
      resource,
      add,
      status: (id: string) => files.value.get(id)?.status ?? '已采用附件',
    } satisfies AttachmentScope,
    prepare,
    reset,
  }
}
