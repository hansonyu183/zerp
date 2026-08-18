import type { SystemParameterEffectMode, SystemParameterValueType } from './api'

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

export const systemParameterEffectModeLabels: Readonly<
  Record<SystemParameterEffectMode, string>
> = {
  IMMEDIATE: '立即生效',
  NEXT_REQUEST: '下次请求生效',
  RESTART_REQUIRED: '重启后生效',
}

export const systemParameterEffectModeOptions = Object.entries(
  systemParameterEffectModeLabels,
).map(([value, title]) => ({
  title,
  value: value as SystemParameterEffectMode,
}))

export function formatSystemParameterValueType(
  valueType: SystemParameterValueType,
): string {
  return systemParameterValueTypeLabels[valueType]
}

export function formatSystemParameterEffectMode(
  effectMode: SystemParameterEffectMode,
): string {
  return systemParameterEffectModeLabels[effectMode]
}
