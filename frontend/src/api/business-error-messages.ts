const exactMessages: Readonly<Record<string, string>> = {
  'Party changed before delete': '主体资料已发生变化，请重新读取后再删除。',
  'authentication failed': '用户名或密码错误。',
  'session expired': '登录状态已过期，请重新登录。',
  'permission denied': '没有权限执行此操作，请联系管理员。',
  'approved report cannot be deleted': '已批准过的报表不能删除，请停用该报表。',
  'report already has a draft': '该报表已有草稿版本，请先处理现有草稿。',
  'report code already exists': '报表编码已存在，请使用其他编码。',
  'report is invalid':
    '报表依赖的结构已变化，当前版本已失效，请联系管理员修复。',
  'report not found or draft exists':
    '报表不存在或已有草稿版本，请刷新后重试。',
  'current password is incorrect': '当前密码错误，请重新输入。',
  'password change is required': '请先完成密码修改后再使用业务功能。',
  'cannot change own roles': '不能通过用户管理修改自己的角色。',
  'cannot change current user status': '不能修改当前登录用户的状态。',
  'cannot reset this user password': '该用户当前不能重置密码。',
  'invalid password reset request': '重置密码请求无效，请刷新后重试。',
  'user is not enabled': '该用户未启用，不能执行此操作。',
  'invalid user query pagination or sort':
    '用户查询条件无效，请按默认排序和分页重新查询。',
  'new password must differ from current password':
    '新密码不能与当前密码相同。',
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
  'role code is server assigned': '角色编码由系统自动生成，不能手工指定。',
  'role name already exists': '角色名称已存在，请使用其他名称。',
  'role code capacity exhausted': '角色编码已用尽，请联系管理员。',
  'requested permissions exceed authorization ceiling':
    '所选权限超出当前授权上限，请刷新权限目录后重新选择。',
  'role cannot be maintained': '当前角色不可维护，请刷新后查看最新授权状态。',
  'one or more roles exceed authorization ceiling':
    '所选角色超出当前授权上限，请刷新角色目录后重新选择。',
  'user cannot be maintained': '当前用户的授权高于您的管理范围，只能查看。',
  'invalid role query pagination or sort':
    '角色查询条件无效，请按默认排序和分页重新查询。',
  'invalid role fields': '角色资料不完整或格式不正确，请检查后重试。',
  'invalid role id': '角色标识无效，请刷新列表后重试。',
  'role not found': '角色不存在，请刷新列表。',
  'invalid permission id': '权限标识无效，请刷新权限目录后重试。',
  'permission not found': '权限不存在，请刷新权限目录。',
  'role changed concurrently': '角色已被其他操作修改，请刷新后重试。',
  'invalid status request': '状态操作请求无效，请刷新后重试。',
  'invalid user fields': '用户资料不完整或格式不正确，请检查后重试。',
  'invalid user id': '用户标识无效，请刷新列表后重试。',
  'user not found': '用户不存在，请刷新列表。',
  'user changed concurrently': '用户资料已被其他操作修改，请刷新后重试。',
  'internal server error': '服务暂时不可用，请稍后重试。',
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
  'formula material replacement must be a raw material':
    '配方原料的继任资料必须是原材料。',
  'packaging product replacement must be a packaging product':
    '包装物的继任资料必须是包装物料。',
  'customer attachment limit reached': '该范围最多只能保存 10 个客户附件。',
  'customer version is not a draft': '只有客户草稿版本可以修改附件。',
  'only the customer draft can change attachments':
    '只有客户草稿版本可以修改附件。',
  'category name is not text': '客户资料类别配置无效，请联系管理员。',
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
  'other-units must be created with a Party relationship':
    '其他单位必须通过主体关系入口创建。',
  'customers must be created with a Party relationship and account':
    '客户必须通过主体关系入口创建，并同时建立首个客户结算账户。',
  'settlement rule does not match fixed term':
    '结算规则与系统固定期限不一致，请刷新后重试。',
  'settlement method facts do not match fixed term':
    '结算方式参数与系统固定期限不一致，请刷新后重试。',
  'termCode must be one of the 11 fixed settlement terms':
    '结算期限必须从系统固定的十一种方式中选择。',
  'customer name and customerTypeCode are required':
    '请填写客户名称并选择客户类型。',
  'customer transaction defaults are incomplete':
    '客户交易默认资料不完整，请补全经营主体、结算、收款和运输方式。',
  'supplier transaction defaults are incomplete':
    '供应商交易默认资料不完整，请补全结算方式和默认采购员。',
  'settlementMethod is read-only': '结算方式快照由系统生成，不能直接修改。',
  'continuous-effective objects are edited through candidate save':
    '该资料采用连续生效模式，请直接保存候选版本。',
  'only CNY credit limits are supported': '当前信用额度仅支持人民币。',
  'referencing object already has a candidate version':
    '被引用资料已有候选版本，请先处理该候选版本。',
  'object has active direct references':
    '该资料仍被当前有效业务对象引用，请先选择接替资料并批量转移。',
  'source object changed before transfer':
    '待停用资料已被修改，请刷新引用清单后重试。',
  'target object is not a current effective object of the same type':
    '接任资料类型不一致、未启用或尚未生效，请重新选择。',
  'multiple JSON values': '定价资料格式无效，请重新填写。',
  'unsupported settlement term': '当前订单的结算方式不受支持，请重新选择。',
  'order currency is required for settlement approval':
    '订单缺少币种，无法校验结算资金。',
  'settlement ledger is not active': '业务账簿尚未启用，无法校验结算资金。',
  'insufficient prepaid funds': '预付款余额不足，无法批准订单。',
  'counterparty has outstanding debt': '往来单位仍有欠款，不能批准现结订单。',
  'counterpartyType must be customer-account or other-unit':
    '相对方必须选择客户结算账户或其他单位。',
  'accounting settlement balance is unavailable':
    '结算余额暂时不可用，请稍后重试。',
  'ENUM parameter requires values': '枚举参数必须配置可选值。',
  'REFERENCE parameter requires reference type':
    '引用参数必须配置引用资料类型。',
  'enum values only apply to ENUM': '可选值只能用于枚举参数。',
  'process definition code already exists': '流程编码已存在，请使用其他编码。',
  'process definition changed': '流程定义已被其他操作修改，请刷新后重试。',
  'process definition code is immutable': '流程编码创建后不能修改。',
  'reference type only applies to REFERENCE': '引用资料类型只能用于引用参数。',
  'report SQL database validation failed':
    '报表 SQL 未通过数据库校验，请检查后重试。',
  'report SQL is invalid': '报表 SQL 不正确，请检查后重试。',
  'report SQL is not read-only': '报表 SQL 只能执行只读查询。',
  'report SQL must be a SELECT': '报表 SQL 必须是 SELECT 查询。',
  'report SQL must contain one statement': '报表 SQL 只能包含一条语句。',
  'report SQL placeholders do not match parameters':
    '报表 SQL 占位符与参数定义不一致。',
  'report enum value is invalid': '报表枚举参数值不在允许范围内。',
  'report export exceeds row limit': '报表导出行数超过限制，请缩小查询范围。',
  'report parameter keys must be unique': '报表参数标识不能重复。',
  'report parameter type is invalid': '报表参数类型不受支持。',
  'report parameters do not match definition':
    '报表参数与当前定义不一致，请刷新后重试。',
  'report reference parameter is invalid': '报表引用参数不正确，请重新选择。',
  'report reference type is unsupported': '报表引用资料类型不受支持。',
  'report result columns do not match contract':
    '报表结果列与当前定义不一致，请联系管理员修复。',
  'report result columns must be unique': '报表结果列标识不能重复。',
  'required report parameter is missing': '请填写必填的报表参数。',
  'the current draft requires a successful document trial before publication':
    '当前草稿必须先使用真实单据成功试算，才能发布。',
  'publish the workflow before enabling it': '请先发布流程修订，再启用流程。',
  'only unused draft definitions can be deleted':
    '只能删除尚未使用的草稿流程。',
  'requestKey is already bound to another workflow intent':
    '该请求键已用于其他创建意图，请使用新的请求键。',
  'the original create-child result is no longer available; use a new requestKey':
    '原创建结果已不存在，请使用新的请求键重新创建。',
  'the workflow target is no longer available':
    '当前流程目标已不可用，请刷新后重新选择。',
  'workflow target is not currently available':
    '当前条件不允许创建该流程目标，请刷新后重试。',
  'workflow action result is already registered at another position':
    '该动作结果已登记在流程中的其他位置，不能重复登记。',
  'multiple enabled workflows match this document':
    '当前单据同时命中多个已启用流程，请先停用冲突流程。',
  'trial source entity does not match the workflow root':
    '试算单据类型与流程根节点不一致。',
  'workflow action did not create a document':
    '流程动作未创建预期单据，操作已回滚。',
  'workflow action initial values failed':
    '流程动作初始值计算失败，操作已回滚。',
  'workflow branch condition failed': '流程分支条件执行失败，操作已回滚。',
  'workflow start condition failed': '流程启动条件执行失败，操作已回滚。',
  'counterparty already has an unfinished cash-on-delivery order':
    '往来单位已有一张未完成的现结订单。',
  'fund account currency does not match document currency':
    '资金账户币种与单据币种不一致。',
  'fund account currency does not match reimbursement':
    '资金账户币种与报销单币种不一致。',
  'fund account currency does not match source document':
    '资金账户币种与来源单据币种不一致。',
  'document is not a draft': '当前单据不是草稿状态，不能执行该操作。',
  'draft has attachments or child documents':
    '草稿已有附件或下游单据，不能删除。',
  'source document cannot be changed': '来源单据已经确定，不能更换。',
  'source document is not approved': '来源单据尚未审核通过。',
  'source document not found': '未找到来源单据，请刷新后重试。',
  'parent document does not match parentEntity':
    '上级单据与所选单据类型不匹配。',
  'downstream sales document exists': '已有下游销售单据，不能执行该操作。',
  'downstream sales document blocks the reverse transition':
    '已有下游销售单据阻止反向操作，请先处理下游单据。',
  'downstream workflow document cannot be removed':
    '流程已有下游单据，不能移除。',
  'downstream workflow document has changed':
    '下游流程单据已变化，请刷新后重试。',
  'downstream documents must be reversed first':
    '已有下游单据，请先反向处理下游单据。',
  'sales-chain source is not approved': '销售来源单据尚未批准。',
  'sales-chain source is not ready': '销售来源资料尚未准备完成。',
  'parent sales document has not reached the required status':
    '上级销售单据尚未达到当前操作所需状态。',
  'production document blocks the reverse transition':
    '生产单据阻止反向操作，请先处理关联生产单据。',
  'sales fulfillment cannot be changed': '销售履约已生成后续单据，不能修改。',
  'purchase fulfillment cannot be changed':
    '采购履约已生成后续单据，不能修改。',
  'sale order is closed': '销售订单已无可执行数量。',
  'sale order is not approved': '销售订单尚未批准。',
  'order is closed for outbound': '订单已无可出库数量。',
  'order still has in-transit quantity': '订单仍有在途数量，不能执行当前操作。',
  'order has unfinished return documents': '订单仍有尚未批准的退货单。',
  'purchase order has no remaining inbound quantity':
    '采购订单没有剩余可入库数量。',
  'purchase order has no remaining quantity': '采购订单没有剩余数量。',
  'purchase order is not open': '采购订单当前没有可执行数量。',
  'unfinished documents exist on or before the closing date':
    '结账日及以前仍有尚未批准的单据，请先处理这些单据，或选择更早的结账月末。',
  'closingDate cannot predate the ledger cutover':
    '结账日期不能早于业务账簿切换日期。',
  'purchase order is not returnable': '采购订单当前不能退货。',
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
  'inbound warehouse must match purchase order warehouse':
    '入库仓库必须与采购订单仓库一致。',
  'inbound date precedes order date': '入库日期不能早于订单日期。',
  'delivery date precedes outbound date': '配送日期不能早于出库日期。',
  'signoff date precedes delivery date': '签收日期不能早于配送日期。',
  'return date precedes signoff': '退货日期不能早于签收日期。',
  'outbound already has a delivery': '该出库单已生成配送单。',
  'delivery already has a signoff': '该配送单已生成签收单。',
  'signoff has return documents': '该签收单已有退货单。',
  'signoff must include every outbound line': '签收单必须包含全部出库明细。',
  'sale quantities do not reconcile': '销售各环节数量不一致，请检查后重试。',
  'workflow refusal lines cannot be changed': '流程生成的拒收明细不能修改。',
  'refusal return lines must match rejected signoff lines':
    '拒收退货明细必须与签收拒收明细一致。',
  'refusal return quantity must equal rejected quantity':
    '拒收退货数量必须等于签收拒收数量。',
  'workflow refusal return cannot be deleted':
    '流程生成的拒收退货单不能直接删除。',
  'expense reimbursement is not approved': '费用报销单尚未审核通过。',
  'production material output is unavailable':
    '生产材料产出资料不可用，请检查生产单据。',
  'employee loan balance is insufficient for writeoff':
    '员工借款余额不足，无法完成核销。',
  'inventory count currency must be CNY': '盘点单币种必须为人民币。',
  'inventory count date is already closed': '盘点日期所在期间已关账。',
  'inventory count predates the active ledger': '盘点日期早于台账启用日期。',
  'inventory count predates the accounting control book':
    '盘点日期早于会计控制账簿启用月份。',
  'inventory count result is incomplete': '盘点结果不完整，请补全实盘数量。',
  'inventory count line changed during replay':
    '盘点明细在台账重建期间发生变化，请重试。',
  'inventory ledger is not active': '库存台账尚未启用。',
  'ledger cannot be activated': '当前台账不能启用。',
  'ledger cannot be reopened': '当前台账不能重新打开。',
  'fixed asset currency must be CNY': '固定资产业务币种必须为人民币。',
  'accounting control book is not ready': '会计控制账簿尚未完成期初批准。',
  'accounting control is not configured': '会计控制服务尚未配置。',
  'accumulated depreciation dimensions must identify the acquired asset':
    '累计折旧科目的辅助核算必须标识所购资产。',
  'asset accounting configuration is missing': '缺少固定资产会计映射配置。',
  'asset accounting dimensions must match the subject':
    '固定资产会计辅助核算与科目要求不一致。',
  'asset acquisition mapping requires asset accounting configuration':
    '资产购置映射必须配置固定资产会计科目。',
  'asset is not available': '固定资产不存在或当前不可处置。',
  'asset subject dimensions must identify the acquired asset':
    '固定资产科目的辅助核算必须标识所购资产。',
  'cost counterpart dimensions are incomplete': '成本对方科目辅助核算不完整。',
  'cost counterpart dimensions must match the subject':
    '成本对方科目辅助核算与科目要求不一致。',
  'cost dimensions require a cost counterpart subject':
    '配置成本辅助核算时必须选择成本对方科目。',
  'depreciation only supports CNY': '自动折旧仅支持人民币账簿。',
  'encode asset accounting snapshot': '固定资产会计快照生成失败。',
  'encode cost counterpart dimensions': '成本对方科目辅助核算生成失败。',
  'insufficient control book funds': '会计控制账簿资金余额不足。',
  'inventory cost counterpart mapping is missing': '缺少库存成本对方科目映射。',
  'inventory costing only supports CNY': '库存成本结算仅支持人民币账簿。',
  'source bill has no originating party': '来源票据缺少原始往来方。',
  'unknown asset accounting dimension field': '固定资产会计辅助字段不受支持。',
  'unknown cost counterpart dimension field': '成本对方科目辅助字段不受支持。',
  'asset is fully depreciated': '固定资产已提足折旧。',
  'asset is not active': '固定资产当前未启用。',
  'depreciation businessDate must be month end': '折旧业务日期必须为月末。',
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
  'source bill currency must match document currency':
    '所选票据币种必须与单据币种一致。',
  'bill payment line is invalid': '付出票据明细无效，请重新选择可用持有票据。',
  'bill payment requires available billId':
    '付出票据必须引用当前可用持有票据。',
  'bill payment requires supplier': '请选择供应商。',
  'bill payment total is invalid': '付出票面合计必须大于零。',
  'fields do not match bill payment': '提交内容与票据付出业务不匹配。',
  'bill issue requires supplier': '请选择供应商。',
  'bill issue requires interestMode': '请选择利息承担方式。',
  'bill issue requires other-unit interestParty':
    '第三方承担利息时必须选择其他单位。',
  'bill issue interestParty is not allowed':
    '银行扣息时不能填写第三方利息承担方。',
  'fields do not match bill issue': '提交内容与票据开出业务不匹配。',
  'invalid bill issue line': '自开票据明细无效，请检查负债、金额和日期。',
  'bill issue line is invalid': '自开票据明细无效，请检查负债、金额和日期。',
  'bill issue total is invalid': '自开票据票面合计无效。',
  'billLineId is not supported in bill issue cash lines':
    '自开票据现金行不能关联票据行。',
  'bill discount requires other-unit counterparty': '请选择贴现方。',
  'bill discount requires interestMode': '请选择利息承担方式。',
  'invalid bill discount interestMode': '请选择有效的利息承担方式。',
  'bill discount requires other-unit interestParty':
    '第三方承担利息时必须选择其他单位。',
  'bill discount interestParty is not allowed':
    '银行扣息时不能填写第三方利息承担方。',
  'bill discount requires available billId':
    '贴现票据必须引用当前可用持有票据。',
  'bill discount requires available billId and rate':
    '贴现票据必须引用当前可用持有票据并填写年利率。',
  'bill discount line is invalid': '贴现票据明细无效，请检查票据和年利率。',
  'bill discount lines must contain 1 to 20 items':
    '贴现票据和现金行数必须在允许范围内。',
  'invalid bill discount cash line': '贴现现金行无效，请检查方向和金额类型。',
  'duplicate billId': '贴现票据不能重复选择。',
  'bill discount total is invalid': '贴现净到账必须大于零。',
  'fields do not match bill discount': '提交内容与票据贴现业务不匹配。',
  'source bill is matured': '来源票据已到期，不能贴现。',
  'interestParty does not match interestMode': '利息承担方与承担方式不匹配。',
  'bill maturity requires receipt or payment': '请选择到期收款或到期付款。',
  'bill maturity type is invalid': '票据到期处理方式无效。',
  'bill maturity requires bills': '票据到期单必须包含待处理票据。',
  'bill maturity line is invalid': '到期票据明细与处理方式不匹配。',
  'bill maturity requires cash': '票据到期单必须包含实际资金明细。',
  'bill maturity cash direction is invalid': '资金方向与到期收款或付款不匹配。',
  'bill maturity requires available billId':
    '到期处理必须引用当前可用持有票据。',
  'source bill is not matured': '来源票据尚未到期。',
  'bill maturity lines must contain 1 to 20 items':
    '到期票据和现金行数必须在允许范围内。',
  'invalid bill maturity cash line':
    '到期处理现金行无效，请检查方向和金额类型。',
  'invalid bill maturityDate': '到期日无效。',
  'fields do not match bill maturity': '提交内容与票据到期处理业务不匹配。',
  'billLineId is not supported in bill maturity cash lines':
    '到期处理现金行不能关联票据行。',
  'billLineId is not supported in bill discount cash lines':
    '票据贴现现金行不能关联票据行。',
  'invalid originatingPartyType': '来源往来方类型无效。',
  'invalid originatingPartyObjectId': '来源往来方无效，请重新选择。',
  'incomplete originating party filter': '请重新选择完整的来源往来方。',
  'bill receipt is missing customer salesperson':
    '票据收入单缺少客户业务员，请先补全客户资料。',
  'businessDate must be the calendar month end':
    '居间计算单业务日期必须是期间月末。',
  'calculation result contains an invalid amount':
    '计算稿包含格式不正确的金额。',
  'calculation result contains an invalid barrel quantity':
    '计算稿包含格式不正确的桶数。',
  'calculation result barrel quantity does not match its source':
    '计算稿桶数与销售签收来源不一致，请重新计算。',
  'calculation result note is too long': '计算稿说明不能超过 1000 个字符。',
  'calculation result contains an invalid premium price':
    '计算稿包含格式不正确的溢价。',
  'calculation source kind is invalid': '计算来源类型无效，请重新生成计算稿。',
  'calculation bill allocation does not match its source':
    '票据成本分配与客户、业务员或来源票据不一致。',
  'bill cost requires its source bill allocation':
    '票据成本必须记录对应的来源票据。',
  'bill allocation requires a positive bill cost':
    '已分配来源票据时必须同时扣除正数票据成本。',
  'eligible bill cost must be allocated to a calculation line':
    '存在可分配但尚未分配的票据成本，请重新计算。',
  'calculation result line does not match its source':
    '计算稿明细与销售签收来源不一致，请重新计算。',
  'calculation result must contain one row per source line':
    '每条销售签收来源必须对应一条计算明细。',
  'calculation script changed; recalculate before saving':
    '计算脚本已更新，请重新计算后保存。',
  'calculation source changed; recalculate before saving':
    '计算来源已变化，请重新计算后保存。',
  'calculation source changed; recalculate before approval':
    '计算来源已变化，请退回复核并重新计算后再批准。',
  'later intermediary calculations must be reversed first':
    '该居间计算单已被后续退货冲回使用，请先反批准后续居间计算单。',
  'later intermediary calculations must be deleted first':
    '该居间计算单仍被后续退货冲回引用，请先将后续居间计算单退回草稿并删除。',
  'intermediary calculation source changed; recalculate before closing':
    '居间计算来源已变化，请重新计算后再结账。',
  'calculation summaries are incomplete': '计算稿汇总不完整，请重新计算。',
  'calculation summary does not match detail results':
    '计算稿汇总与明细不一致，请重新计算。',
  'calculation summary category is invalid': '计算稿汇总类别无效，请重新计算。',
  'intermediary amount requires a source intermediary':
    '居间金额缺少对应居间商，请检查客户资料后重新计算。',
  'intermediary return quantity exceeds its original calculation':
    '跨月退货数量超过原居间计算数量，请检查退货单。',
  'return adjustment cannot allocate bill cost':
    '跨月退货冲回明细不能分配票据成本。',
  'return adjustment result has an invalid direction':
    '跨月退货冲回金额方向不正确，请重新计算。',
  'return adjustment source amount is invalid':
    '跨月退货冲回来源金额无效，请检查原居间计算单。',
  'return adjustment source calculation is missing':
    '跨月退货冲回缺少原居间计算单，请重新生成计算稿。',
  'return adjustment source calculation changed':
    '跨月退货冲回引用的原居间计算单已变化，请重新生成计算稿。',
  'return adjustment result amounts do not match its source':
    '跨月退货冲回金额必须与来源金额一致，请重新计算。',
  'original intermediary calculation source is incomplete':
    '原居间计算来源不完整，无法生成跨月退货冲回。',
  'original intermediary calculation quantity is invalid':
    '原居间计算数量无效，无法生成跨月退货冲回。',
  'original intermediary pricing quantity is invalid':
    '原居间计算计价数量无效，无法生成跨月退货冲回。',
  'original intermediary calculation amount is invalid':
    '原居间计算金额无效，无法生成跨月退货冲回。',
  'intermediary calculation must use CNY and include its calculation draft':
    '居间计算单必须使用人民币并包含完整计算稿。',
  'ledger must be active before calculation':
    '业务账簿尚未启用，不能生成居间计算来源。',
  'sale signoff is missing its order salesperson snapshot':
    '销售签收单缺少订单业务员快照，请先处理来源单据。',
  'sale return exceeds its source signoff':
    '销售退货金额或数量超过来源签收单，请检查退货单。',
  'sale return timeline is invalid':
    '销售退货时间线与来源签收单不一致，请检查来源单据。',
  'intermediary FIFO amount is out of range':
    '居间计算的签收金额超出可处理范围，请检查来源单据。',
  'intermediary FIFO balance is out of range':
    '居间计算的客户应收余额超出可处理范围，请检查往来数据。',
  'source pricing quantity is invalid':
    '销售签收来源的计价数量无效，请检查产品单位换算。',
  'every unclosed month must have an approved intermediary calculation before closing':
    '结账范围内存在尚未批准的月度居间计算单，请逐月处理后再结账。',
  'other transaction filters only apply to other ledger':
    '主体类型和分类筛选仅适用于其他往来。',
  'otherCategory only applies to other transactions':
    '其他往来分类仅适用于其他往来收付款。',
  'trade opening requires customer or supplier':
    '贸易往来期初只能选择客户或供应商。',
  'unsupported settlement rule': '当前结算规则不受支持。',
  'asset acquisition requires 1-200 lines':
    '固定资产购置单必须包含 1 至 200 条明细。',
  'asset cannot be disposed before acquisition':
    '固定资产不能在购置日期之前处置。',
  'asset cannot be disposed before existing depreciation history':
    '固定资产处置日期不能早于已有折旧记录。',
  'asset has later depreciation or disposal':
    '固定资产已有更晚的折旧或处置记录，不能执行当前操作。',
  'asset is not due for this depreciation month':
    '固定资产在所选月份无需计提折旧。',
  'asset liquidation requires 1-200 lines':
    '固定资产清理单必须包含 1 至 200 条明细。',
  'asset must be depreciated through the disposal month':
    '固定资产必须先批准至处置月份的折旧。',
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
  'accounting book number exhausted': '会计账簿编码已用尽，请联系管理员。',
  'accounting subject cannot be its own parent':
    '会计科目不能以自身作为上级科目。',
  'accounting subject hierarchy cycle': '会计科目层级不能形成循环。',
  'accounting subject template parent missing':
    '建账科目模板缺少上级科目，请联系管理员。',
  'approved accounting opening cannot be edited':
    '已批准的账簿期初不能编辑，请先反批准。',
  'encode accounting opening dimensions':
    '期初辅助核算处理失败，请刷新后重试。',
  'POST result requires a posting template':
    '生成凭证的映射结果必须选择凭证模板。',
  'UN_POST result cannot have a posting template':
    '忽略映射不能同时选择凭证模板。',
  'accounting mapping changed or is approved':
    '映射已被修改或批准，请刷新后重试。',
  'accounting mapping is not approved': '当前映射不是已批准状态。',
  'accounting mapping is not draft': '当前映射不是草稿状态。',
  'accounting opening is not approved': '请先批准账簿期初。',
  'opening asset is not available': '期初资产不存在或当前不可用。',
  'opening asset values do not reconcile': '期初资产价值与会计科目余额不一致。',
  'opening bill is not available': '期初票据不存在或当前不可用。',
  'opening bill value does not reconcile': '期初票据价值与会计科目余额不一致。',
  'opening global object is used by another book':
    '期初创建的对象已被其他账簿使用，不能反批准。',
  'accounting period has missing VOU mappings':
    '本期已批准单据存在缺失的会计映射，不能锁定。',
  'accounting period has not ended': '自然月结束后才能锁定该会计期间。',
  'accounting period has unfinished VOU documents':
    '本期仍有未批准单据，不能锁定。',
  'accounting period is locked': '该业务月份已被会计账簿锁定，不能修改单据。',
  'accounting period inventory is negative': '本期存在负库存，不能锁定。',
  'accounting period trial balance failed':
    '本期会计事实试算不平衡，不能锁定。',
  'accounting periods must be locked continuously':
    '会计期间必须从账簿开始月份起逐月连续锁定。',
  'only the latest accounting period can be unlocked':
    '只能解锁本账簿最后一个已锁期间。',
  'mapping rule requires conditions': '每条映射规则至少需要一个条件。',
  'mapping requires enabled leaf accounting subjects':
    '映射只能使用本账簿已启用的末级会计科目。',
  'mapping rules may match simultaneously':
    '映射规则存在同时命中的可能，请调整条件。',
  'posting template requires an id and at least two lines':
    '凭证模板必须有标识且至少包含两行分录。',
  'referenced accounting mapping cannot be unapproved':
    '该映射版本已生成会计事实，不能反批准。',
  'VOU source already has accounting facts from another revision':
    '该单据的其他批准版本已经生成会计凭证，不能重复覆盖。',
  'approved accounting mapping is missing':
    '当前账簿缺少该单据类型的已批准会计映射。',
  'automatic accounting voucher is not balanced by currency':
    '自动生成的会计凭证未按币种试算平衡，请检查映射。',
  'automatic accounting voucher has no facts':
    '当前映射没有生成任何会计或数量事实。',
  'automatic accounting voucher requires at least two nonzero lines':
    '自动生成的会计凭证至少需要两条非零分录。',
  'encode mapped accounting dimensions': '会计辅助核算处理失败，请刷新后重试。',
  'inventory accounting subject requires quantity':
    '库存商品科目的映射必须提供数量。',
  'insufficient control book inventory': '业务控制账簿库存不足，单据不能批准。',
  'mapped accounting dimensions are incomplete':
    '自动记账缺少会计科目要求的辅助核算信息。',
  'multiple accounting mapping rules matched':
    '当前单据同时命中多条会计映射规则，请调整映射。',
  'unknown mapping condition field': '映射条件引用了未知字段。',
  'unknown posting amount or currency field':
    '凭证模板引用了未知的金额或币种字段。',
  'unknown posting dimension field': '凭证模板引用了未知的辅助核算字段。',
  'unknown posting quantity field': '凭证模板引用了未知的数量字段。',
  'unknown posting template collection': '凭证模板引用了未知的单据行集合。',
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
  'business menu revision conflict':
    '业务菜单已被其他管理员修改，请刷新后重试。',
  'draft menu revision conflict':
    '业务菜单草稿已被其他管理员修改，请刷新后重试。',
  'menu catalog revision conflict': '菜单目录已更新，请刷新后重试。',
  'menu depth exceeds two levels or parent is invalid':
    '菜单最多支持两级，请检查分组与路由的父子关系。',
  'menu groups must be top level': '菜单分组必须位于第一层。',
  'menu management entry must remain enabled': '必须保留已启用的菜单管理入口。',
  'menu mode is not registered': '菜单方式尚未完成系统注册，请联系管理员。',
  'menu mode revision conflict': '菜单方式已被其他管理员修改，请刷新后重试。',
  'menu route is not registered': '所选菜单路由未在系统中注册。',
  'menu routes require a parent': '业务菜单页面必须归属一个菜单分组。',
  'menu routes require a route key': '业务菜单页面缺少路由标识，请刷新后重试。',
  'reserved menu item id': '该菜单项标识由系统保留，请重新添加菜单项。',
  'workbench entry must appear exactly once':
    '业务菜单必须且只能保留一个工作台入口。',
  'workbench must be a direct route': '工作台必须作为一级菜单入口。',
  'workbench must be the enabled direct entry':
    '请保留已启用的一级工作台入口。',
  'workbench name is reserved for the direct entry':
    '“工作台”名称仅可用于一级入口，请使用其他名称。',
  'system parameter is managed by its owning service':
    '该系统参数只能由对应功能修改。',
  'system parameter is not registered for generic exposure':
    '该系统参数未登记为可在通用管理页面展示。',
  'editable system parameter requires registered constraints':
    '可编辑系统参数必须先登记完整约束。',
  'runtime adoption evidence is incomplete':
    '运行实例采用证明不完整，请等待全部实例上报。',
  'runtime adoption evidence is incomplete or stale':
    '运行实例采用证明不完整或已过期，请重新收集最新证明。',
  'system parameter does not have registered editing constraints':
    '该系统参数没有完整编辑约束，不能修改。',
  'system parameter does not require restart adoption':
    '该系统参数无需登记重启采用结果。',
  'system parameter must be a decimal': '系统参数必须填写为小数。',
  'system parameter must be an integer': '系统参数必须填写为整数。',
  'system parameter must be true or false': '系统参数必须选择是或否。',
  'system parameter numeric constraint requires a numeric value':
    '系统参数的数值约束必须填写有效数字。',
  'system parameter registration is inconsistent':
    '系统参数登记信息不一致，请联系管理员。',
  'system parameter revision conflict':
    '系统参数已被其他管理员修改，请刷新后重试。',
  'system parameter value is above the maximum': '系统参数值超过允许的最大值。',
  'system parameter value is below the minimum': '系统参数值低于允许的最小值。',
  'system parameter value is not allowed': '系统参数值不在允许范围内。',
  'system parameter value is too short': '系统参数值长度不足。',
  'unsupported system parameter value type': '系统参数类型不受支持。',
  'saleAmount is invalid': '销售金额不正确，请检查后重试。',
  'salvageIncome is invalid': '残值收入不正确，请检查后重试。',
  'settlement surcharge is invalid': '结算附加费不正确，请检查后重试。',
  'sourceLines are required': '请选择来源明细。',
  'unsupported VOU entity': '当前单据类型不受支持。',
  'unsupported product kind': '当前产品类型不受支持。',
  'upload headers do not match declaration':
    '上传文件信息与申请内容不一致，请重新上传。',
  'upload token is invalid or expired':
    '上传凭证无效或已过期，请重新选择文件。',
  'user changed concurrently; retry with the current password':
    '用户资料已被其他操作修改，请使用当前密码重新提交。',
  'user revision conflict': '用户资料已被其他操作修改，请刷新后重试。',
  'user status unchanged': '用户已经是目标状态，无需重复操作。',
  'vehicle does not belong to platform': '车辆不属于所选物流平台，请重新选择。',
  'VOU pool, BOB/AUX resolvers, and event publisher are required':
    '单据服务配置不完整，请联系管理员。',
  'WFL pool, event bus, and runtime are required':
    '流程服务配置不完整，请联系管理员。',
  'auxiliary resolver is not configured':
    '辅助资料服务尚未配置，请联系管理员。',
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
  'bill receipt is missing customer snapshot':
    '票据收款缺少客户账户快照，请重新选择客户账户。',
  'carrier is not an effective Service Relationship':
    '承运方不是当前生效的服务关系，请重新选择。',
  'contract capability is not effective on sales relationship':
    '合同适用能力未在销售合作关系中生效，请先维护关系能力。',
  'customer account operating entity must match relationship':
    '客户账户的经营主体必须与客户关系一致。',
  'customer cannot attribute sales to itself': '客户不能将销售归属设置为自身。',
  'customer relationship must retain at least one account':
    '客户关系必须至少保留一个结算账户。',
  'customer sales attribution snapshot is incomplete':
    '客户账户的销售归属快照不完整，请重新保存。',
  'employees must be created with a Party relationship':
    '员工必须通过主体与雇佣关系创建。',
  'fields do not match service contract': '提交内容与服务合同类型不匹配。',
  'missing applicable sales contract': '缺少适用的销售合作合同，请先补充合同。',
  'sale signoff is missing its order sales attribution snapshot':
    '销售签收缺少订单销售归属快照，请检查来源订单。',
  'sales contract does not accept settlementMethod':
    '销售合作合同不能填写结算方式。',
  'sales contract requires capabilities':
    '销售合作合同必须选择至少一项适用能力。',
  'sales partners must be created with a Party relationship':
    '销售合作方必须通过主体与销售合作关系创建。',
  'sales relationship requires at least one capability':
    '销售合作关系必须至少具备一项能力。',
  'sales relationship replacement lacks the required capability':
    '接任销售合作关系缺少当前引用所需能力，请重新选择。',
  'service acceptance amount must be positive': '履约验收金额必须大于零。',
  'service acceptance attributes are missing':
    '履约验收缺少必要属性，请补全后重试。',
  'service acceptance detail is invalid': '履约验收明细无效，请检查后重试。',
  'service acceptance requires an approved service contract':
    '履约验收必须引用已批准的服务合同。',
  'service acceptance requires an approved service relationship contract':
    '只有已批准的服务关系合同可以履约验收。',
  'service contract attributes are missing': '合同缺少必要属性，请补全后重试。',
  'service contract counterparty, handler, and detail are required':
    '合同必须填写关系相对方、经办人和合同明细。',
  'service contract does not accept sales applicability':
    '服务关系合同不能填写销售能力适用范围。',
  'service contract needs an effective settlement method':
    '服务关系合同必须使用当前生效的结算方式。',
  'service contract requires a typed service or sales relationship':
    '合同必须引用服务关系或销售合作关系。',
  'suppliers must be created with a Party relationship':
    '供应商必须通过主体与供应关系创建。',
  'vehicle platform replacement must be an effective service relationship':
    '车辆承运平台必须替换为当前生效的服务关系。',
  'typed relationships must use their dedicated save operation':
    '该关系资料必须通过对应的专用保存入口提交。',
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
