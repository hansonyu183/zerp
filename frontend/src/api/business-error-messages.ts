export const businessErrorMessages: Readonly<Record<string, string>> = {
  unauthenticated: '登录状态已失效，请重新登录。',
  forbidden: '没有权限执行此操作，请联系管理员。',
  validation_failed: '输入内容不符合要求，请检查必填项、格式和取值范围。',
  conflict: '当前数据状态不允许此操作，请刷新并检查相关业务资料。',
  not_found: '所需业务资料不存在或不可用，请刷新后重试。',
  internal_error: '系统暂时无法完成操作，请稍后重试。',
  role_changed: '角色已被其他操作修改，请刷新后重试。',
  user_changed: '用户资料已被其他操作修改，请刷新后重试。',
  role_name_exists: '角色名称已存在，请使用其他名称。',
  invalid_credentials: '用户名或密码错误，请检查后重试。',
  account_disabled: '账号已停用，请联系管理员。',
  account_locked: '账号已临时锁定，请稍后重试。',
  invalid_current_password: '当前密码错误，请重新输入。',
  submitter_cannot_review:
    '提交人与审核人不能为同一人，请由其他有审批权限的用户处理。',
  document_data_incomplete:
    '自动生成的单据缺少必填业务资料，请先编辑补全并保存后再核对。',
  warehouse_disable_blocked:
    '仓库仍有库存、待处理业务或有效引用，暂时不能停用。',
  object_has_active_references:
    '该资料仍被当前有效业务对象引用，请先修改引用方资料并完成审核后再停用。',
  inventory_insufficient: '库存不足，无法完成本次操作，请先补充库存。',
  funds_insufficient: '可用资金不足，无法完成本次操作。',
  candidate_exists: '该资料已有候选版本，请先处理现有候选版本。',
  approval_open_version_exists:
    '该资料已有草稿或待审核版本，请先处理现有版本后再撤销审核。',
  invalid_reference: '所选业务资料不存在、已失效或不适用于当前操作。',
}

export function businessErrorMessage(
  errorKey: string | undefined,
): string | undefined {
  return errorKey ? businessErrorMessages[errorKey] : undefined
}
