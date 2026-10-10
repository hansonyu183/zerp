/** Ordinary attachment transport kinds; opaque originals make no format claim. */
export const attachmentMimePresentation = {
  'application/pdf': 'PDF 文档',
  'image/jpeg': 'JPEG 图片',
  'image/png': 'PNG 图片',
  'application/octet-stream': '原始文件',
} as const
export type AttachmentMimeType = keyof typeof attachmentMimePresentation
export const attachmentMimeTypes = Object.keys(attachmentMimePresentation) as [
  AttachmentMimeType,
  ...AttachmentMimeType[],
]
export const attachmentMaxSizeBytes = 20 * 1024 * 1024
export const attachmentMaxCount = 20
// One staged file is base64 JSON. Ordinary actions retain their own lower limit.
export const attachmentStageBodyLimitBytes = 32 * 1024 * 1024

export function attachmentContentMatches(
  mimeType: string,
  content: Uint8Array,
): boolean {
  if (mimeType === 'application/octet-stream') return true
  const prefix =
    mimeType === 'application/pdf'
      ? [37, 80, 68, 70, 45]
      : mimeType === 'image/png'
        ? [137, 80, 78, 71, 13, 10, 26, 10]
        : mimeType === 'image/jpeg'
          ? [255, 216]
          : undefined
  if (!prefix || !prefix.every((byte, index) => content[index] === byte))
    return false
  return (
    mimeType !== 'image/jpeg' ||
    (content[content.length - 2] === 255 && content[content.length - 1] === 217)
  )
}
