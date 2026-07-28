const CODE_RANDOM_LENGTH = 6

function timestamp(value: Date): string {
  const parts = [
    value.getFullYear(),
    value.getMonth() + 1,
    value.getDate(),
    value.getHours(),
    value.getMinutes(),
    value.getSeconds(),
    value.getMilliseconds(),
  ]
  return parts
    .map((part, index) => String(part).padStart(index === 6 ? 3 : index === 0 ? 4 : 2, '0'))
    .join('')
}

function randomSuffix(value: string): string {
  return value
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, CODE_RANDOM_LENGTH)
    .padEnd(CODE_RANDOM_LENGTH, '0')
}

export function generateObjectCode(
  domain: 'bob' | 'aux',
  entity: string,
  now = new Date(),
  randomId = globalThis.crypto.randomUUID(),
): string {
  const entityCode = entity
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase()
  return [
    domain.toUpperCase(),
    entityCode,
    timestamp(now),
    randomSuffix(randomId),
  ].join('-')
}
