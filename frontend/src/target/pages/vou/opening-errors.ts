export const openingErrorCaptions: Record<string, string> = {
  acc_opening_delete_blocked: '已批准期初不能删除，请先反批准。',
  acc_opening_unapprove_blocked:
    '账簿已有后续账务、锁定期间或关联登记，不能反批准期初。',
  acc_opening_asset_configuration_required:
    '请先在会计映射中配置固定资产科目。',
  acc_opening_asset_reconciliation_invalid: '资产登记金额与期初明细不一致。',
  acc_opening_bill_reconciliation_invalid: '票据登记金额与期初明细不一致。',
  forbidden: '没有此操作权限。',
  validation_failed: '请检查必填项、日期及金额格式。',
  acc_book_not_found: '账簿不存在。',
  acc_book_access_denied: '没有此账簿的操作权限。',
  approval_open_version_exists:
    '此账簿已有期初，请打开现有期初；修改前需显式删除开放提交。',
  vou_idempotency_conflict: '该提交标识已用于另一份内容，请核实原提交。',
  acc_opening_unbalanced: '期初必须逐币种借贷平衡。',
  acc_opening_subject_invalid: '请选择启用的末级科目。',
  acc_opening_dimension_required: '请完整且仅填写科目要求的辅助核算维度。',
  acc_inventory_quantity_required: '库存科目必须填写数量。',
  acc_inventory_quantity_invalid: '库存期初必须填写正数量和借方金额。',
  acc_inventory_dimension_required: '库存科目必须选择仓库和产品。',
  acc_opening_asset_invalid: '请检查资产登记及金额。',
  acc_opening_bill_invalid: '请检查票据登记、日期及金额。',
  acc_opening_bill_counterparty_invalid: '票据原始相对方不可用，请重新选择。',
  acc_opening_container_current_snapshot_invalid:
    '请选择当前有效的客户子单位。',
  vou_reference_unavailable: '所选引用不可用，请重新选择。',
}
