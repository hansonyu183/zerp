import type { CustomerIdentityKind } from '@/api/generated/models/CustomerIdentityKind'

export const customerIdentityKindOptions: ReadonlyArray<{
  title: string
  value: CustomerIdentityKind
}> = [
  { title: '大陆企业', value: 'MAINLAND_ENTERPRISE' },
  { title: '大陆个人', value: 'MAINLAND_INDIVIDUAL' },
  { title: '其他', value: 'OTHER' },
]

const legalIdentifierLabel: Readonly<Record<CustomerIdentityKind, string>> = {
  MAINLAND_ENTERPRISE: '统一社会信用代码',
  MAINLAND_INDIVIDUAL: '居民身份证号',
  OTHER: '法定识别号',
}

const mainlandUnifiedSocialCreditCharset = '0123456789ABCDEFGHJKLMNPQRTUWXY'
const unifiedSocialCreditWeights = [
  1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28,
]
const residentIdentityWeights = [
  7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2,
]
const residentIdentityChecks = '10X98765432'

export function customerLegalIdentifierLabel(
  kind: CustomerIdentityKind,
): string {
  return legalIdentifierLabel[kind]
}

export function customerLegalIdentifierError(
  kind: CustomerIdentityKind,
  value: string,
): string | undefined {
  if (!value.trim()) return undefined
  if (kind === 'MAINLAND_ENTERPRISE') {
    const normalized = value.replace(/\s/gu, '').toUpperCase()
    return validUnifiedSocialCreditCode(normalized)
      ? undefined
      : '统一社会信用代码须为校验通过的 18 位代码。'
  }
  if (kind === 'MAINLAND_INDIVIDUAL') {
    const normalized = value.trim().toUpperCase()
    return validResidentIdentityNumber(normalized)
      ? undefined
      : '居民身份证号须为校验通过的 18 位号码。'
  }
  return undefined
}

function validUnifiedSocialCreditCode(value: string): boolean {
  if (value.length !== 18) return false
  let sum = 0
  for (let index = 0; index < 17; index += 1) {
    const characterIndex = mainlandUnifiedSocialCreditCharset.indexOf(
      value[index]!,
    )
    if (characterIndex < 0) return false
    sum += characterIndex * unifiedSocialCreditWeights[index]!
  }
  const checkCharacterIndex = (31 - (sum % 31)) % 31
  return mainlandUnifiedSocialCreditCharset[checkCharacterIndex] === value[17]
}

function validResidentIdentityNumber(value: string): boolean {
  if (!/^\d{17}[\dX]$/u.test(value)) return false
  const year = Number(value.slice(6, 10))
  const month = Number(value.slice(10, 12))
  const day = Number(value.slice(12, 14))
  const birthDate = new Date(year, month - 1, day)
  if (
    birthDate.getFullYear() !== year ||
    birthDate.getMonth() !== month - 1 ||
    birthDate.getDate() !== day ||
    birthDate > new Date()
  )
    return false

  let sum = 0
  for (let index = 0; index < 17; index += 1)
    sum += Number(value[index]!) * residentIdentityWeights[index]!
  return value[17] === residentIdentityChecks[sum % 11]
}
