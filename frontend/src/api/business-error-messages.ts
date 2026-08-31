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
  approval_self_review_forbidden:
    '提交人与审核人不能为同一人，请由其他有审批权限的用户处理。',
  document_data_incomplete:
    '自动生成的单据缺少必填业务资料，请先编辑补全并保存后再提交。',
  warehouse_disable_blocked:
    '仓库仍有库存、待处理业务或有效引用，暂时不能停用。',
  object_has_active_references:
    '该资料仍被当前有效业务对象引用，请先修改引用方资料并完成审核后再停用。',
  inventory_insufficient: '库存不足，无法完成本次操作，请先补充库存。',
  funds_insufficient: '可用资金不足，无法完成本次操作。',
  candidate_exists: '该资料已有候选版本，请先处理现有候选版本。',
  approval_open_version_exists:
    '该资料已有草稿或待批准版本，请先处理现有版本后再反批准。',
  approval_stale_revision: '当前版本已被其他操作修改，请刷新后重试。',
  bob_unapprove_blocked:
    '该主体仍被已批准的业务关系引用，不能撤销最后一个批准版本。',
  party_merged: '该主体已被合并，不能继续操作。',
  vou_settlement_term_required: '订单必须具有明确账期，请先维护结算方式。',
  vehicle_identifier_conflict: '车牌号或 VIN 已被其他车辆占用，请修改后重试。',
  vehicle_type_reference_unavailable:
    '车型资料不存在、已失效或不属于车辆类型字典。',
  vehicle_type_reference_stale: '车型资料已更新，请重新选择并保存。',
  vehicle_carrier_reference_stale: '承运方资料已更新，请重新选择并保存。',
  fund_account_identifier_conflict: '资金账户标识已存在，请检查后重试。',
  fund_account_operating_reference_stale:
    '所选经营主体已发生变化，请刷新后重试。',
  invalid_reference: '所选业务资料不存在、已失效或不适用于当前操作。',
}

export function businessErrorMessage(
  errorKey: string | undefined,
): string | undefined {
  return errorKey ? businessErrorMessages[errorKey] : undefined
}
