const exactMessages: Readonly<Record<string, string>> = {
  'authentication failed': '用户名或密码错误。',
  'session expired': '登录状态已过期，请重新登录。',
  'permission denied': '没有权限执行此操作，请联系管理员。',
  'account has no safe signout permission': '账号权限配置异常，请联系管理员。',
  'current password is incorrect': '当前密码错误，请重新输入。',
  'new password must differ from current password':
    '新密码不能与当前密码相同。',
  'assigned roles must grant /app/user/signout':
    '所选角色缺少安全退出权限，请调整角色授权。',
  'every enabled user must retain /app/user/signout':
    '启用中的用户必须保留安全退出权限。',
  'cannot disable the last authorization administrator':
    '不能停用最后一个授权管理员。',
  'cannot disable the last authorization administrator role':
    '不能停用最后一个授权管理员角色。',
  'change would remove the last authorization administrator':
    '该操作会移除最后一个授权管理员，无法继续。',
  'one or more permissions do not exist or are disabled':
    '部分权限不存在或已停用，请刷新后重新选择。',
  'one or more roles do not exist or are disabled':
    '部分角色不存在或已停用，请刷新后重新选择。',
  'generated sales draft is missing required business data':
    '自动生成的销售单据缺少必填业务资料，请先编辑补全并保存后再核对。',
  'document attributes are incomplete; return to draft and save before continuing':
    '单据资料不完整，请先退回草稿、补全并保存后再继续。',
  'inventory timeline would become negative':
    '库存不足，无法完成本次出库，请先补充库存。',
  'inventory cost balance became negative':
    '库存成本余额不能为负数，请检查数量和金额。',
  'zero inventory retained a cost balance':
    '库存数量为零时仍有成本余额，请先调整库存成本。',
  'settlement-method reference is unavailable':
    '结算方式已失效，请重新选择后再提交。',
  'submitter cannot review the same version':
    '提交人与审核人不能为同一人，请由其他有审批权限的用户处理。',
  'system identity is managed internally':
    '系统用户和系统角色由系统维护，不能人工修改。',
  'role code is reserved': '该角色编码为系统保留编码，请使用其他编码。',
  'referenced object cannot be deleted; disable it instead':
    '该资料已被引用，不能删除；可以改为停用。',
  'object cannot be edited in its current state': '当前状态下不能编辑该资料。',
  'object cannot reference itself': '资料不能引用自身。',
  'object is not currently effective': '该资料当前未生效，请重新选择。',
  'only one sort item is allowed': '每次只能选择一个排序字段。',
  'only one packaging specification can be default':
    '只能设置一个默认包装规格。',
  'only packaging products can be returnable': '只有包装物料可以设置为可回收。',
  'product cannot package itself': '产品不能把自身设置为包装物。',
  'product formula cannot reference itself': '产品配方不能引用产品自身。',
  'packaging products cannot contain a formula': '包装物料不能设置生产配方。',
  'packaging products cannot contain packaging specifications':
    '包装物料不能继续设置包装规格。',
  'packaging specification must reference a packaging product':
    '包装规格必须引用包装物料。',
  'packaging pricing unit must match inventory unit':
    '包装计价单位必须与库存单位一致。',
  'goods pricing unit must be KG': '货物计价单位必须为千克。',
  'formula component must reference a raw material': '配方明细必须引用原材料。',
  'formula only applies to sale order lines': '配方只适用于销售订单明细。',
  'formula only applies to standard finished products':
    '配方只适用于标准产成品。',
  'formula source document is not allowed': '当前来源单据不允许使用配方。',
  'standard finished product formula is required': '标准产成品必须设置配方。',
  'custom finished product formula is required': '定制产成品必须填写本单配方。',
  'purchaseUnitPrice is required for intermediary sale lines':
    '中间商销售明细必须填写采购单价。',
  'purchaseUnitPrice only applies to intermediary sale lines':
    '采购单价只适用于中间商销售明细。',
  'supplier does not apply to sale order': '当前供应商不适用于该销售订单。',
  'supplier must be a general supplier': '请选择普通供应商。',
  'salesperson employee is required': '请选择负责销售的员工。',
  'salesperson is required': '请选择销售人员。',
  'purchaser is required': '请选择采购人员。',
  'settlement method is required': '请选择结算方式。',
  'settlement method is not configured': '尚未配置结算方式，请先完成配置。',
  'settlement methods are system-defined':
    '结算方式由系统固定维护，不能新增或删除。',
  'settlement rule does not match fixed term':
    '结算规则与系统固定期限不一致，请刷新后重试。',
  'unsupported settlement term': '当前订单的结算方式不受支持，请重新选择。',
  'order currency is required for settlement approval':
    '订单缺少币种，无法校验结算资金。',
  'settlement ledger is not active': '业务账簿尚未启用，无法校验结算资金。',
  'insufficient prepaid funds': '预付款余额不足，无法批准订单。',
  'counterparty has outstanding debt': '往来单位仍有欠款，不能批准现结订单。',
  'counterparty already has an unfinished cash-on-delivery order':
    '往来单位已有一张未完成的现结订单。',
  'fund account currency does not match document currency':
    '资金账户币种与单据币种不一致。',
  'fund account currency does not match reimbursement':
    '资金账户币种与报销单币种不一致。',
  'fund account currency does not match source document':
    '资金账户币种与来源单据币种不一致。',
  'legacy expense fund account is missing':
    '历史费用单缺少资金账户，请先补充后再继续。',
  'document is not a draft': '当前单据不是草稿状态，不能执行该操作。',
  'draft has attachments or child documents':
    '草稿已有附件或下游单据，不能删除。',
  'source document cannot be changed': '来源单据已经确定，不能更换。',
  'source document is not approved': '来源单据尚未审核通过。',
  'source document not found': '未找到来源单据，请刷新后重试。',
  'parent document does not match parentEntity':
    '上级单据与所选单据类型不匹配。',
  'downstream sales document exists': '已有下游销售单据，不能执行该操作。',
  'downstream workflow document cannot be removed':
    '流程已有下游单据，不能移除。',
  'downstream workflow document has changed':
    '下游流程单据已变化，请刷新后重试。',
  'sales-chain source is not finalized': '销售来源单据尚未完成。',
  'sales-chain source is not ready': '销售来源资料尚未准备完成。',
  'sales fulfillment cannot be changed': '销售履约已生成后续单据，不能修改。',
  'purchase fulfillment cannot be changed':
    '采购履约已生成后续单据，不能修改。',
  'sale order is closed': '销售订单已关闭。',
  'sale order is not finalized': '销售订单尚未完成审核。',
  'order is closed for outbound': '订单已关闭出库。',
  'order still has in-transit quantity': '订单仍有在途数量，不能完成当前操作。',
  'order has unfinished return documents': '订单仍有未完成的退货单。',
  'order cannot perform short-close action': '当前订单不能执行短关闭操作。',
  'short close is not requested': '订单未申请短关闭。',
  'purchase order cannot request short close': '当前采购订单不能申请短关闭。',
  'purchase order has no remaining inbound quantity':
    '采购订单没有剩余可入库数量。',
  'purchase order has no remaining quantity': '采购订单没有剩余数量。',
  'purchase order is not open':
    '采购订单当前未开放执行，请先在采购订单中撤销完成后重试。',
  'unfinished documents exist on or before the closing date':
    '结账日及以前仍有未完成单据，请先处理这些单据，或选择更早的结账月末。',
  'purchase order is not returnable': '采购订单当前不能退货。',
  'purchase order is not short closed': '采购订单尚未短关闭。',
  'purchase document has no source order': '采购单据缺少来源订单。',
  'purchase inbound has return documents':
    '采购入库单已有退货单，不能执行该操作。',
  'source inbound is not returnable': '来源入库单当前不能退货。',
  'source signoff is not returnable': '来源签收单当前不能退货。',
  'return lines must belong to one purchase fulfillment':
    '退货明细必须来自同一采购履约。',
  'return lines must belong to one sales fulfillment':
    '退货明细必须来自同一销售履约。',
  'return quantity exceeds available inbound quantity':
    '退货数量超过可退的入库数量。',
  'return quantity exceeds available signed quantity':
    '退货数量超过可退的签收数量。',
  'outbound quantity exceeds available order quantity':
    '出库数量超过订单剩余可出库数量。',
  'outbound warehouse must match sale order warehouse':
    '出库仓库必须与销售订单仓库一致。',
  'outbound date precedes order date': '出库日期不能早于订单日期。',
  'delivery date precedes outbound date': '配送日期不能早于出库日期。',
  'signoff date precedes delivery date': '签收日期不能早于配送日期。',
  'return date precedes signoff': '退货日期不能早于签收日期。',
  'outbound already has a delivery': '该出库单已生成配送单。',
  'delivery already has a signoff': '该配送单已生成签收单。',
  'signoff has return documents': '该签收单已有退货单。',
  'signoff must include every outbound line': '签收单必须包含全部出库明细。',
  'sale quantities do not reconcile': '销售各环节数量不一致，请检查后重试。',
  'automatic refusal lines cannot be changed': '系统生成的拒收明细不能修改。',
  'automatic refusal return cannot be deleted':
    '系统生成的拒收退货单不能删除。',
  'expense reimbursement is not approved': '费用报销单尚未审核通过。',
  'production material output is unavailable':
    '生产材料产出资料不可用，请检查生产单据。',
  'employee loan balance is insufficient for writeoff':
    '员工借款余额不足，无法完成核销。',
  'inventory count currency must be CNY': '盘点单币种必须为人民币。',
  'inventory count date is already closed': '盘点日期所在期间已关账。',
  'inventory count predates the active ledger': '盘点日期早于台账启用日期。',
  'inventory count result is incomplete': '盘点结果不完整，请补全实盘数量。',
  'inventory ledger is not active': '库存台账尚未启用。',
  'ledger cannot be activated': '当前台账不能启用。',
  'ledger cannot be reopened': '当前台账不能重新打开。',
  'fixed asset currency must be CNY': '固定资产业务币种必须为人民币。',
  'asset is fully depreciated': '固定资产已提足折旧。',
  'asset is not active': '固定资产当前未启用。',
  'depreciation businessDate must be month end': '折旧业务日期必须为月末。',
  'depreciationMonth must use YYYY-MM': '折旧月份格式必须为 YYYY-MM。',
  'useful life or residual rate is invalid': '使用年限或残值率不正确。',
  'unsupported transition': '当前状态不支持该操作。',
  'unsupported reverse transition': '当前状态不支持撤销该操作。',
  'bill receipt net settlement is invalid': '票据净结算金额必须为正。',
  'bill receipt requires customer counterparty': '请选择客户往来方。',
  'bill ledger identity conflicts with different fixed facts':
    '票据标识与已保存的固定资料冲突。',
  'bill document with ledger history cannot be deleted':
    '该票据单已形成台账历史，不能删除。',
  'billCashLines supports at most 20 items': '现金行数不能超过 20 行。',
  'billLineId is not supported in bill receipt cash lines':
    '现金行不能关联票据行。',
  'change bill requires billId': '找零票据必须引用当前持有票据。',
  'customer net settlement must be positive': '客户净结算金额必须为正。',
  'duplicate bill':
    '该票据已存在，请核对票据类型、号码、承兑人、票面金额和到期日。',
  'fields do not match bill receipt': '提交字段与票据收入业务不匹配。',
  'source bill is not available': '所选找零票据当前不可用。',
  'bill payment line is invalid': '付出票据明细无效，请重新选择可用持有票据。',
  'bill payment requires available billId': '付出票据必须引用当前可用持有票据。',
  'bill payment requires supplier': '请选择供应商。',
  'bill payment total is invalid': '付出票面合计必须大于零。',
  'fields do not match bill payment': '提交内容与票据付出业务不匹配。',
  'unsupported settlement rule': '当前结算规则不受支持。',
  'asset acquisition requires 1-200 lines':
    '固定资产购置单必须包含 1 至 200 条明细。',
  'asset cannot be disposed before acquisition':
    '固定资产不能在购置日期之前处置。',
  'asset cannot be disposed before existing depreciation history':
    '固定资产处置日期不能早于已有折旧记录。',
  'asset depreciation requires 1-500 lines':
    '固定资产折旧单必须包含 1 至 500 条明细。',
  'asset has later depreciation or disposal':
    '固定资产已有更晚的折旧或处置记录，不能执行当前操作。',
  'asset is not due for this depreciation month':
    '固定资产在所选月份无需计提折旧。',
  'asset liquidation requires 1-200 lines':
    '固定资产清理单必须包含 1 至 200 条明细。',
  'asset must be depreciated through the disposal month':
    '固定资产必须先完成至处置月份的折旧。',
  'asset sale requires 1-200 lines': '固定资产出售单必须包含 1 至 200 条明细。',
  'assetId is invalid or duplicated': '固定资产无效或重复，请重新选择。',
  'attachment limit reached': '附件数量已达到上限。',
  'attachment must be PNG or JPEG': '附件必须是 PNG 或 JPEG 图片。',
  'attachment not found or already submitted': '附件不存在或已经提交。',
  'attachment not found or not ready': '附件不存在或尚未上传完成。',
  'attachment size must be between 1 byte and 10 MiB':
    '附件大小必须在 1 字节至 10 MiB 之间。',
  'attachments are still uploading': '附件仍在上传，请等待完成后再提交。',
  'bootstrap is disabled after the first user exists':
    '系统已有用户，不能再次初始化管理员。',
  'category is only supported for products': '分类只适用于产品资料。',
  'code already exists': '编码已存在，请使用其他编码。',
  'counterpartyType must be customer or other-party':
    '往来对象类型必须是客户或其他往来单位。',
  'counterpartyType requires counterparty':
    '选择往来对象类型后必须填写往来对象。',
  'csrf validation failed': '页面安全凭证已失效，请刷新页面后重试。',
  'data conflict': '数据已被其他操作修改，请刷新后重试。',
  'dateFrom must not exceed dateTo': '开始日期不能晚于结束日期。',
  'disposalExpense is invalid': '处置费用不正确，请检查后重试。',
  'document number exhausted': '单据编号已用尽，请联系管理员。',
  'download token is invalid or expired': '下载凭证无效或已过期，请重新获取。',
  'feedback accepts at most 3 attachments': '每条反馈最多上传 3 个附件。',
  'feedback attachment daily limit reached': '今日反馈附件上传次数已达到上限。',
  'feedback attachment limit reached': '反馈附件数量已达到上限。',
  'feedback content must be between 1 and 4000 characters':
    '反馈内容必须为 1 至 4000 个字符。',
  'feedback daily limit reached': '今日反馈提交次数已达到上限。',
  'feedback submission key was already used':
    '当前反馈草稿已发生变化，请刷新页面后重新填写。',
  'feedback title must be between 1 and 120 characters':
    '反馈标题必须为 1 至 120 个字符。',
  'fields do not match sale-delivery': '提交内容与销售配送单不匹配。',
  'fields do not match sale-outbound': '提交内容与销售出库单不匹配。',
  'fields do not match sale-signoff': '提交内容与销售签收单不匹配。',
  'fields do not match sales-chain entity':
    '提交内容与当前销售单据类型不匹配。',
  'formula must contain 1 to 200 components':
    '配方必须包含 1 至 200 条材料明细。',
  invalid: '输入内容不正确，请检查后重试。',
  'invalid feedback submission key': '反馈提交标识无效，请重新打开反馈窗口。',
  'ledger is not available': '业务台账不可用，请先完成台账配置。',
  'load parent document': '上级单据加载失败，请刷新后重试。',
  'object changed before delete': '资料已被其他操作修改，请刷新后再删除。',
  'object number exhausted': '资料编码已用尽，请联系管理员。',
  'originalValue is invalid': '资产原值不正确，请检查后重试。',
  'permission catalog is empty': '权限目录为空，请联系管理员完成系统配置。',
  'platform is not an effective logistics platform':
    '所选平台不是当前有效的物流平台。',
  'product pricing conversion is invalid':
    '产品计价换算关系不正确，请检查单位配置。',
  'purchase inbound quantity exceeds remaining quantity':
    '采购入库数量超过订单剩余可入库数量。',
  'purchase inbound with attachments cannot be deleted':
    '采购入库单已有附件，不能删除。',
  'purchase order is not open for inbound': '采购订单当前不能继续入库。',
  'quantity per container is not allowed for NONE':
    '未使用容器时不能填写每箱数量。',
  'referenced category target cannot change':
    '分类已被引用，不能修改适用对象。',
  'replacement inbound has consumed returned capacity':
    '补货入库已占用本次退货释放的数量，不能继续操作。',
  'request body must be an empty object': '该操作不接受额外输入内容。',
  'role revision conflict': '角色已被其他操作修改，请刷新后重试。',
  'role status unchanged': '角色已经是目标状态，无需重复操作。',
  'saleAmount is invalid': '销售金额不正确，请检查后重试。',
  'salvageIncome is invalid': '残值收入不正确，请检查后重试。',
  'settlement surcharge is invalid': '结算附加费不正确，请检查后重试。',
  'short close must be confirmed by another user':
    '短关闭必须由另一名用户确认。',
  'sourceLines are required': '请选择来源明细。',
  'unsupported VOU entity': '当前单据类型不受支持。',
  'unsupported product kind': '当前产品类型不受支持。',
  'unsupported workflow converter': '当前流程转换方式不受支持。',
  'upload headers do not match declaration':
    '上传文件信息与申请内容不一致，请重新上传。',
  'upload token is invalid or expired':
    '上传凭证无效或已过期，请重新选择文件。',
  'user changed concurrently; retry with the current password':
    '用户资料已被其他操作修改，请使用当前密码重新提交。',
  'user revision conflict': '用户资料已被其他操作修改，请刷新后重试。',
  'user status unchanged': '用户已经是目标状态，无需重复操作。',
  'vehicle does not belong to platform': '车辆不属于所选物流平台，请重新选择。',
  'IN condition value must be an array': 'IN 条件的值必须是列表。',
  'IN requires array': 'IN 条件必须提供列表值。',
  'LED pool and BOB resolver are required':
    '账簿服务配置不完整，请联系管理员。',
  'VOU pool, BOB/AUX resolvers, and event publisher are required':
    '单据服务配置不完整，请联系管理员。',
  'WFL pool, event bus, and document service are required':
    '流程服务配置不完整，请联系管理员。',
  'account subject direction does not match income/expense type':
    '会计科目方向与收支类型不匹配。',
  'auxiliary resolver is not configured':
    '辅助资料服务尚未配置，请联系管理员。',
  'condition group cannot contain siblings': '条件组不能同时包含同级条件。',
  'condition group must be an array': '条件组必须是条件列表。',
  'condition item must be an object': '每条条件必须是完整的条件对象。',
  'condition must contain one group or one predicate':
    '条件必须包含一个条件组或一个判断项。',
  'monthly closing day must be 1-31': '月结日必须为 1 至 31。',
  'defaultSalesSurcharge must be a non-negative amount':
    '默认销售附加费不能为负数。',
  'defaultUsefulLifeMonths 1-1200 and defaultResidualRate 0-99.99 are required':
    '默认使用月数必须为 1 至 1200，默认残值率必须为 0 至 99.99。',
  'direction must be INCOME or EXPENSE': '收支方向必须为收入或支出。',
  'dueDays must be 0-3650': '账期天数必须为 0 至 3650。',
  'feedback publication lease was lost': '反馈发布任务已失效，请稍后重试。',
  'inventory count gain cost was not prepared':
    '盘盈成本尚未准备完成，请先补充计价资料。',
  'inventory inbound cost source is unsupported': '当前入库成本来源不受支持。',
  'inventory purchase cost must be complete and use CNY':
    '采购入库成本必须完整且使用人民币。',
  'inventory quantity is insufficient for costing':
    '库存数量不足，无法完成成本计算。',
  'line condition cannot contain siblings': '明细条件不能同时包含同级条件。',
  'line condition must be an object': '明细条件必须是完整的条件对象。',
  'name must contain 1-200 characters': '名称必须为 1 至 200 个字符。',
  'parent account subject direction must match': '上级会计科目方向必须一致。',
  'parent cycle is not allowed': '不能形成循环的上级关系。',
  'parent hierarchy is too deep': '上级层级过深，请调整层级关系。',
  'parent income/expense direction must match':
    '上下级科目的收支方向必须一致。',
  'password must include lowercase, uppercase, number, and symbol characters':
    '密码必须同时包含大写字母、小写字母、数字和符号。',
  'ruleType must be DUE_DAYS or MONTH_END':
    '结算规则类型必须为账期天数或月末结算。',
  'sale return quantity exceeds source outbound cost':
    '销售退货数量超过来源出库成本对应数量。',
  'sortOrder must be an integer': '排序序号必须是整数。',
  'symbol and quantityScale 0-6 are required':
    '必须填写单位符号，数量精度必须为 0 至 6。',
  'unknown condition operator': '条件运算符不受支持。',
}

const phraseLabels: Readonly<Record<string, string>> = {
  account: '账户',
  amount: '金额',
  asset: '固定资产',
  'asset category': '资产分类',
  attachment: '附件',
  category: '分类',
  comment: '备注',
  container: '容器',
  counterparty: '往来对象',
  currency: '币种',
  custodian: '保管人',
  customer: '客户',
  date: '日期',
  department: '部门',
  document: '单据',
  'document detail': '单据明细',
  'download token': '下载凭证',
  employee: '员工',
  entity: '业务类型',
  field: '字段',
  fields: '业务字段',
  'formula component': '配方明细',
  'fund account': '资金账户',
  'inventory count result': '盘点结果',
  line: '明细行',
  'logistics platform': '物流平台',
  object: '资料',
  order: '订单',
  permission: '权限',
  platform: '平台',
  price: '价格',
  product: '产品',
  'purchase order': '采购订单',
  quantity: '数量',
  reason: '原因',
  reference: '引用资料',
  revision: '版本',
  role: '角色',
  'sale order': '销售订单',
  salesperson: '销售人员',
  'settlement surcharge': '结算附加费',
  sort: '排序条件',
  source: '来源资料',
  status: '状态',
  supplier: '供应商',
  token: '凭证',
  unit: '单位',
  user: '用户',
  vehicle: '车辆',
  version: '版本',
  warehouse: '仓库',
}

function label(value: string): string | undefined {
  const normalized = value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .trim()
    .toLowerCase()
  return phraseLabels[normalized]
}

export function translateBusinessMessage(message: string): string | undefined {
  const normalized = message.trim()
  if (!normalized) return undefined
  if (exactMessages[normalized]) return exactMessages[normalized]

  let match = /^invalid (.+)$/u.exec(normalized)
  if (match) {
    const target = label(match[1]!)
    return target
      ? `${target}格式或取值不正确，请检查后重试。`
      : '输入内容格式或取值不正确，请检查后重试。'
  }

  match = /^(.+) is required(?: by workflow)?$/u.exec(normalized)
  if (match) {
    const target = label(match[1]!)
    return target ? `请填写${target}。` : '缺少必填内容，请补全后重试。'
  }

  match = /^(.+) (?:is |are )?(?:not found|unavailable)$/u.exec(normalized)
  if (match) {
    const target = label(match[1]!)
    return target
      ? `${target}不存在或不可用，请刷新后重新选择。`
      : '所需业务资料不存在或不可用，请刷新后重试。'
  }

  match = /^(.+) (?:is )?not (?:currently )?effective$/u.exec(normalized)
  if (match) {
    const target = label(match[1]!)
    return target
      ? `${target}当前未生效，请重新选择。`
      : '所选业务资料当前未生效，请重新选择。'
  }

  match = /^(.+) (?:has )?changed(?: concurrently| before save)?$/u.exec(
    normalized,
  )
  if (match) {
    const target = label(match[1]!)
    return target
      ? `${target}已被其他操作修改，请刷新后重试。`
      : '数据已被其他操作修改，请刷新后重试。'
  }

  match = /^duplicate (.+)$/u.exec(normalized)
  if (match) {
    const target = label(match[1]!)
    return target
      ? `${target}重复，请删除重复项后重试。`
      : '存在重复内容，请删除重复项后重试。'
  }

  match = /^(.+) (?:is )?too long$/u.exec(normalized)
  if (match) {
    const target = label(match[1]!)
    return target
      ? `${target}过长，请缩短后重试。`
      : '输入内容过长，请缩短后重试。'
  }

  match = /^(.+) (?:is )?out of range$/u.exec(normalized)
  if (match) {
    const target = label(match[1]!)
    return target
      ? `${target}超出允许范围，请调整后重试。`
      : '数值超出允许范围，请调整后重试。'
  }

  match = /^(.+) must contain (\d+) to (\d+) items$/u.exec(normalized)
  if (match) {
    const target = label(match[1]!) ?? '明细'
    return `${target}数量必须为 ${match[2]} 至 ${match[3]} 项。`
  }

  match = /^(.+) do(?:es)? not match (?:the )?entity$/u.exec(normalized)
  if (match) {
    const target = label(match[1]!)
    return target
      ? `${target}与当前业务类型不匹配。`
      : '提交内容与当前业务类型不匹配。'
  }

  return undefined
}
