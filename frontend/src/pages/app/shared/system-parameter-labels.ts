import type { SystemParameterValueType } from './api'

export const systemParameterValueTypeLabels: Readonly<
  Record<SystemParameterValueType, string>
> = {
  STRING: '文本',
  INTEGER: '整数',
  DECIMAL: '小数',
  BOOLEAN: '布尔值',
}

export const systemParameterValueTypeOptions = Object.entries(
  systemParameterValueTypeLabels,
).map(([value, title]) => ({
  title,
  value: value as SystemParameterValueType,
}))

export function formatSystemParameterValueType(
  valueType: SystemParameterValueType,
): string {
  return systemParameterValueTypeLabels[valueType]
}
