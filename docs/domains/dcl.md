# DCL 申报控制领域

## 1. 领域职责

DCL（Declaration Control）拥有全部版本化业务对象的稳定 subject、business code 与强类型申报快照。当前实体是 `operating-entity`、`warehouse`、`vehicle`、`fund-account`、`product`、`party`、`employee`、`customer`、`customer-account`、`supplier`、`other-unit`、`sales-partner`、`acc-mapping`、`rpt-definition` 与 `wfl-process-definition`：DCL 拥有申报创建、候选编辑、提交、撤回、驳回、批准、反批准、草稿删除、版本历史和审计读取；中央 Approval 唯一拥有版本号、状态、revision、审批元数据和审批事件；BOB 只通过 highest APPROVED typed snapshot 提供当前有效业务资料的只读查询与交易引用解析。会计映射的稳定主体 `(bookId, vouEntity)` 由 DCL 拥有生命周期，ACC 只读取最新批准映射作为当前记账解释。报表定义的稳定主体 `(definitionId, code)` 由 DCL 拥有生命周期，RPT 只保留当前有效定义的查询、执行和独立 VALID/INVALID 技术有效性。流程定义的稳定主体 `wfl-process-definition` 由 DCL 拥有生命周期，WFL 只保留当前定义的查询、脚本与编译图领域能力、试算、实例和运行。

`dcl_subjects` 是版本化业务对象唯一通用稳定身份，最小保存不可变 ID、entity、code、createdAt 与 createdBy；非空 `(entity, upper(code))` 唯一。只有 Party 与 ACC Mapping 是无编码 subject，允许 code 为空。Operating Entity、Warehouse、Vehicle、Fund Account、Product、Employee、Customer、Customer Account、Supplier、Other Unit 与 Sales Partner 必须分别匹配 `OPE/WHS/VEH/FAC/PRD/EMP/CUS/ACC/SUP/OTU/SLP-[0-9]{4}`；RPT Definition 保留合法 slug 且系统新分配 `rpt-[0-9]{6}`；WFL Process Definition 必须匹配 `^[a-z][a-z0-9-]{1,62}[a-z0-9]$`。这些非空、前缀、格式与大小写不敏感唯一规则均是数据库不变量，所有 writer、seed、fixture 与 import 都必须满足，读取不得用 `COALESCE` 隐藏腐败。编码空间耗尽时，创建必须以稳定业务冲突 `dcl_subject_code_capacity_exhausted` 失败，不得返回内部错误或创建无编码 subject。DCL 不复制 Approval 版本头，不保存 `enabled`、`currentVersionId`、`effectiveVersionId`、`baseVersionId`、`nextVersionNo` 或任何 subject/object revision。DCL 也不提供 BOB 写入别名、双写、current store、过渡视图或失败回退。

## 2. 经营主体申报

`dcl_subjects` 保存经营主体唯一稳定 ID 与 `OPE-*` 业务编码；二者跨全部版本不可变。`dcl_operating_entity_versions` 以 `approvalEntryId` 为主键，保存该版本完整的法定名称、简称、税号、地址、电话、备注和 `enabled`。所有可变字段均随候选版本冻结；启用或停用同样通过保存新候选并审批，不存在 BOB current 写入。

唯一 wire 字段集合以 [OpenAPI DCL Schema](../../contracts/openapi/schemas/dcl.yaml) 为准。`/dcl/operating-entity` 是经营主体申报的唯一维护页面，候选查询、详情和全部写动作固定使用 `/dcl/operating-entity/*`。`/bob/operating-entity` 是独立的当前正式档案只读页面，只使用 `/bob/operating-entity/query|get`；它可以导航到同一稳定 subject 的 DCL 页面，但不在 BOB 内创建、保存或审批候选。APP 工作台和审批深链固定进入 DCL 页面。

## 3. 版本与当前读取

版本语义完全复用 [Approval Version](approval.md#6-approval-version)：

1. V1 草稿没有 BOB 当前有效资料，不能被交易引用；
2. V1 批准后，BOB 直接连接 DCL subject、highest APPROVED Approval Entry 与对应 typed snapshot 读取；
3. V2 为 `DRAFT` 或 `PENDING` 时，BOB 仍读取 V1；
4. V2 批准后，BOB 下一次读取自然选择 V2，不执行额外 current 写入；
5. 反批准 V2 后，BOB 自然回到仍为 `APPROVED` 的 V1；
6. 反批准 V1 后，没有正式版本，BOB 查询自然不可见，但稳定 DCL subject、编码和审批历史保留。

`approval_entries.version_no` 是唯一版本号，`approval_entries.revision` 是唯一并发 revision。BOB response 的 `sourceApprovalEntryId` 与 `sourceVersionNo` 直接来自查询选中的 Approval Entry，不持久化第二份来源指针。

## 3.1 仓库申报

仓库 stable ID 与 `WHS-*` 编码跨全部版本不变。`dcl_warehouse_versions` 以 `approvalEntryId` 为主键，保存完整的名称、地址、联系人、联系电话、仓库负责人稳定 ID、负责人精确 Approval Entry、备注和 `enabled`。仓库负责人可空且只表达责任与联系，不授予任何操作权限；创建、保存、提交和批准时分别按最新选择或已保存精确版本校验该负责人。

`/dcl/warehouse` 是唯一维护入口，`/bob/warehouse` 只提供当前正式资料的 `query/get`。启停同样通过完整 DCL candidate 的 `enabled` 改变，不存在 BOB 直接 `enable/disable`。批准 `enabled=false` 或反批准回落到 disabled/absent 前，在同一事务锁定仓库、库存和相关 VOU，并检查非零库存、进行中单据、仍可产生后续库存动作的来源单和当前正式引用；存在任一 blocker 时返回 `warehouse_disable_blocked`，Approval 保持不变。

VOU 与 ACC 继续保存 warehouse stable ID；VOU 同时保存实际采用的精确 DCL Approval Entry ID 与名称等必要快照。候选和后续批准版本不改写历史事实；任一 VOU 状态精确引用某仓库版本时，该版本不得反批准。

## 3.2 车辆申报

车辆 stable ID 与 `VEH-*` 编码跨全部版本不变。`dcl_vehicle_versions` 以 `approvalEntryId` 为主键，保存完整的名称、车牌、车型字典编码及来源 Approval Entry、承运归属封闭对象、VIN、发动机号、核定载重、散水承运能力、备注和 `enabled`。承运归属的 wire value 只有 `INTERNAL` 与 `EXTERNAL`：自有车辆必须引用一个当前可用经营主体及其精确 Approval Entry，外部车辆必须引用一条当前可用“其他单位”服务关系及其精确 Approval Entry。

`/dcl/vehicle` 是唯一维护入口，`/bob/vehicle` 只提供当前正式档案的 `query/get/reference`。启停只能保存完整 DCL candidate 的 `enabled` 变更，不存在 BOB 直接 `enable/disable`。候选创建或保存时按最新引用解析车型与承运归属；提交和批准时重新校验已保存的精确来源版本仍是 latest approved。承运方后续改版不会自动改写车辆快照，必须由用户建立车辆下一候选显式采用新版本。

批准或反批准只改变 Approval lifecycle；BOB 通过 highest APPROVED typed query 自然切换、回落或隐藏车辆资料，不保存车辆 current copy。被任一 VOU 正式事实精确引用的车辆 Approval Entry 不得反批准；当前车辆引用的经营主体或服务关系也不得失效，必须先通过车辆正常候选与审批流程修改承运归属。VOU 与运输事实继续保存 vehicle stable ID、实际采用的 Approval Entry ID、承运归属和车辆能力快照，任何车辆后续版本均不得重算或改写历史。

## 3.3 资金账户申报

资金账户 stable ID 与 `FAC-*` 编码跨全部版本不变。`dcl_fund_account_versions` 以 `approvalEntryId` 为主键，保存完整的名称、币种、户名、银行、支行、规范化账号、备注、所属经营主体 stable ID、精确 Approval Entry、编码与名称快照，以及 `enabled`。资金账户必须且只能属于一个当前可用经营主体；创建和保存时解析 latest approved，提交和批准时确认已存精确来源仍为 latest approved。所属主体后续改版不自动改写资金账户快照，必须通过新 candidate 显式采用。

`/dcl/fund-account` 是唯一维护入口，`/bob/fund-account` 只提供当前正式资料的 `query/get/reference`。账号移除空白和连字符并转为大写；非空账号在全部资金账户的 latest approved 与唯一 open candidate 之间大小写不敏感唯一，旧批准版本在新版本批准后释放账号。批准或反批准只改变 Approval lifecycle，并在同一事务更新账号占用；BOB 通过 highest APPROVED typed query 自然切换、回落或隐藏资料，冲突时 Approval 与账号占用均不改变。

VOU 收付款、费用支付、其他收入和票据资金行继续保存 fund account stable ID、实际采用的 Approval Entry ID、编码、名称与币种快照。任一已持久化 VOU 正文精确引用的资金账户 Approval Entry 不得反批准；但可以建立下一 candidate。ACC 继续保存 fund account stable ID 维度，并通过不可变的 VOU `source_id` 追溯实际采用的资金账户版本，不重复保存 Approval Entry 或快照。历史事实不回查当前资金账户并且不随后续版本改变。

## 3.4 产品申报

产品 stable ID、`PRD-*` 编码和抽象基准单位跨全部版本不变。`dcl_product_versions` 以 `approvalEntryId` 为主键，保存完整的名称、产品类型、产品分类、规格、型号、条码、计价单位、默认录入单位、默认包装规格、可回收标志、备注和 `enabled`；类型、分类和单位均同时保存来源 AUX stable ID 及必要名称和 typed 参数快照，不保存 AUX Approval Entry。每个计量单位 snapshot 还必须保存当时的 `quantityScale`，单位换算和固定配方中的单位不得在读取或制单时回查 AUX 精度。单位换算与固定配方是同一产品版本的强类型明细，不是独立对象、独立 API 或独立生命周期；每个版本始终保存完整 snapshot，不保存 diff。

创建或保存时解析当前启用且 entity 匹配的 AUX stable object，并按配方原料 stable ID 解析其 latest approved 产品版本；从正式版本创建候选时，原料 entry 自动前移但权威基准用量不变，需要确认的行保持显式待处理。提交和批准使用同一套完整性规则：AUX 快照只校验完整性与 stable identity，不回查来源 current，也不因来源后续改名、修改或停用而漂移；配方原料的已存精确 DCL entry 仍须为 latest approved。条码在全部产品的 latest approved 与唯一开放候选之间大小写不敏感唯一；并发候选和条码占用由同一事务保证。

`/dcl/product` 是唯一维护入口，`/bob/product` 只提供当前正式资料的 `query/get/reference`。批准或反批准只改变 Approval lifecycle；BOB 直接读取 highest APPROVED entry 对应的完整 DCL snapshot，不保存产品 current source，也不复制单位换算或固定配方事实。失败时 DCL snapshot、Approval 与标识占用全部回滚。库存、销售、采购、生产和 ACC 历史继续保存 product stable ID、实际采用的 Approval Entry、数量、名称及各自所需业务快照；任何后续产品版本都不得重算历史数量、配方、金额或库存事实。任一正式业务事实精确引用某产品 Approval Entry 时，该版本不得反批准。

## 3.5 主体申报

`dcl_parties` 是 Party 专属 identity，永久保存身份 ID 与合并状态；`dcl_party_versions` 以 `approvalEntryId` 保存类型、法定名称、显示名称、税号、通用联系方式和完整强标识 snapshot。Party 不能从 DCL 单独创建：首条强类型关系创建时，强标识精确命中已有 approved Party 且用户可读时复用该 Party；命中但不可读时返回不泄露资料的占用冲突；未命中时才在同一 transaction 创建 DCL subject、Party identity、V1 草稿和关系。V1 批准前 BOB 不可见。

`/dcl/party` 是共享身份候选、影响预览、审批、版本、审计和合并维护入口；`/bob/party` 只提供当前正式资料的 `query|get`。V1 与首条关系属于同一原子事实，V1 草稿不得从 Party 页面独立删除；已有正式版本时才可删除其后续 `DRAFT` candidate 并释放候选强标识。批准或反批准只改变 Approval lifecycle，BOB 直接选择 highest APPROVED Party snapshot。反批准 V2 后仍有较低 `APPROVED` 版本时自然回落；若反批准将使 Party 不再存在任何 `APPROVED` 版本，则任一未合并且 latest `APPROVED` 的客户、供应、雇佣、服务或销售合作关系都必须阻断，关系 `enabled=false` 仍计入。阻断固定返回 `errorKey=bob_unapprove_blocked`，`data.references[]` 每项包含关系 `entity`、`field=partyId` 和 `count`。

Party 最后一版反批准与上述关系的创建、提交和批准必须在同一 `dcl_parties` identity 上串行化，统一锁顺序为 Party identity → relationship identity → Approval Entry。blocker 检查、强标识 claim reconciliation 与 Approval 状态提交位于同一事务；任何失败都不得部分改变 Party、relationship、claim 或 BOB 可见性。强标识“类型 + 规范化值”在 latest approved 与唯一 open candidate 间共同占用；合并或审批失败不得部分改变占用或关系。合并预检固定以双方 latest approved `sourceApprovalEntryId + approvalRevision` 为 stale token；双方必须存在 latest approved 且无 open Party candidate，确认仅消费同一预检与显式关系冲突选择，并在 transaction 内复核 token、关系状态和 fingerprint。来源 identity 标记合并后从 BOB 查询消失，DCL 历史、identifier claim、merge audit 与历史单据继续保留；DCL 审计按时间统一展示声明 lifecycle 与主体合并事件。历史 VOU 与关系 snapshot 不追溯改写。

## 3.6 员工申报

员工 stable ID 与 `EMP-*` 编码由 `dcl_subjects(entity=employee)` 持有，`dcl_employment_relationships` 在 V1 批准前保存员工、Party 与经营主体的不可变雇佣边界。`dcl_employee_versions` 以 `approvalEntryId` 保存完整 employee snapshot：人员类别、部门、岗位、工作电话、工作邮箱、入职日期、备注与 `enabled`；它不复制 Party identity 或姓名。人员类别、部门、岗位与经营主体均同时保存 stable ID、精确 Approval Entry、编码及名称快照。

`/dcl/employee` 是员工唯一维护入口，`/bob/employee` 只提供 current `query|get|reference`。创建请求必须选择已有 Party，或提交 `newParty`；新 Party 时同一 transaction 建立 Party root、DCL Party V1 candidate、员工 root、雇佣边界和员工 V1 candidate。employee 的 submit 与 approve 都要求 Party current approved；候选创建和保存从 AUX current 复制 stable ID、code、name 等快照，并按 latest approved 解析经营主体来源；submit/approve 只重新校验经营主体等 DCL 精确来源，AUX 只校验已存快照完整性与 stable identity。V1 的 `enabled` 默认为 `true`；后续启停通过包含 `enabled` 的完整 DCL candidate 保存，不存在 BOB 直接 `enable/disable`。

批准或反批准只改变 Approval lifecycle；BOB 直接读取 highest APPROVED employee snapshot 并返回来源 Approval Entry。VOU/ACC 与其他正式事实继续保存 employee stable ID、精确 Approval Entry 以及各自所需 snapshot。任一正式事实精确引用目标 employee entry 时，反批准必须返回 blocker；新 employee candidate 和后续批准版本不改写历史。

## 3.6.1 客户与客户结算子账户申报

客户关系 `customer` 与客户结算子账户 `customer-account` 是独立 Approval subject、独立 DCL page 和独立 API 路径。`dcl_customer_relationships` 在 V1 批准前保存 Party 与经营主体的不可变强类型边界；`dcl_customer_accounts` 在 V1 批准前保存账户与客户关系的不可变归属。稳定模型固定为 Party → 客户关系 → 一个或多个结算子账户：客户关系在创建时一次性绑定 `partyId` 与 `operatingEntityId`，两者以后不得修改；账户只通过 `customerRelationshipId` 归属关系，经营主体从关系推导，客户端不得在账户 input 重复传入经营主体。

`/dcl/customer/create` 原子创建或复用 Party、客户关系 V1 `DRAFT` 与默认账户 V1 `DRAFT`。传 `newParty` 时，Party root、DCL Party V1、客户关系 root、客户 V1 与默认账户 root、账户 V1 全部在同一 PostgreSQL transaction 完成；任一步失败不得留下 Party、关系、账户、Approval entry、附件或事件残留。已有 Party 仅在用户可读取且强标识规则允许时复用；不可读取命中仍返回不泄露资料的 blocker。

客户关系 candidate 版本化 `enabled` 与关系附件。客户账户 candidate 版本化 `enabled` 以及名称、简称、客户类型、联系人、地址、结算方式、收款方式、运输政策、定价政策、信用额度、主要业务归属、内部提醒和默认销售订单备注。账户 `save` 始终携带顶层 `enabled` 与完整 account input；保存的账户 data 同时返回、持久化客户类型、结算方式和收款方式的 AUX stable ID、编码及名称快照，以及经营主体和业务归属的 DCL stable ID、精确 `approvalEntryId`、编码及名称等完整 snapshot。输入只能选择来源 stable ID，服务端解析并冻结 snapshot；来源改名、停用或换版不回写候选、已批准版本或历史单据。

`/dcl/customer` 与 `/dcl/customer-account` 各自提供 `query|get|create|save|submit|unsubmit|reject|approve|unapprove|delete|versions|audit-history`。两者 V2 `DRAFT` 或 `PENDING` 都不影响各自 V1 正式资料；批准与反批准只改变 Approval lifecycle，BOB 直接选择各自 highest APPROVED typed snapshot。`/bob/customer` 与 `/bob/customer-account` 只提供当前正式资料的 `query|get|reference`，不返回 open candidate，也不保留 BOB 写入、生命周期或附件写入别名。

附件 JSON 元数据统一经 `/dcl/customer/attachment-initiate`、`/dcl/customer/attachment-download` 与 `/dcl/customer/attachment-remove`。`scope=CUSTOMER|CUSTOMER_ACCOUNT` 和 `ownerApprovalEntryId` 精确指向对应 DCL version；initiate/remove 必须携带 `approvalRevision` 且只允许 `DRAFT` owner，download 可读获准 current 或历史 owner 但永远只读。关系和账户附件随各自 candidate 复制，附件类别来源 snapshot 绝不因类别后续变化而回写。文件 token PUT/GET 继续使用 `/files/customer-attachments/*`。

销售、应收、收款、开票与 ACC 事实只在创建新事实时解析当前启用的账户 current；它们保存账户 stable ID、精确 DCL Approval Entry 及所需业务 snapshot。V2 批准不会改写 V1 交易；历史 V1 即使已非 current，只要仍为 `APPROVED` 仍可按 exact entry 校验。正式事实精确引用的关系或账户 entry 不得反批准。

## 3.7 供应商、其他单位与销售合作方申报

供应关系 stable ID 与 `SUP-*` 编码由 DCL subject 持有，`dcl_supplier_relationships` 在 V1 批准前保存 Party 与经营主体的不可变强类型边界；`partyId` 与顶层 `operatingEntityId` 只在创建时确定，保存 candidate 不得改写 Party 共享身份或经营主体边界。创建可以二选一地传既有 `partyId` 或 `newParty`；新 Party 时同一 transaction 建立 Party root、DCL Party V1 candidate、供应关系 root 与供应关系 V1 candidate。

`dcl_supplier_versions` 保存完整供应关系 snapshot：`shortName`、`taxNumber`、联系人、电话、邮箱、地址、备注、可选结算方式来源精确快照、默认采购员来源精确快照与 `enabled`。供应关系不维护任何 supplier category 或 supplier type。默认采购员必须是当前可用 BOB employee 的 exact snapshot；创建和保存按 latest approved 解析，提交和批准重新校验采购员 entry，以及已配置结算方式的内部完整性。结算方式未配置时不阻止提交或批准，整组字段为空且 offset 为 0。

`/dcl/supplier` 是供应关系唯一维护入口，`/bob/supplier` 只提供当前正式资料的 `query|get|reference`。启停必须保存包含 `enabled` 的完整 DCL candidate，不存在 BOB 直接启停。审批或反批准只改变 Approval lifecycle；采购订单、采购入库、采购退货、采购付款及其 ACC 事实精确引用的来源 Approval Entry 不得反批准，后续 candidate 与审批不改写历史采购或会计快照。

供应关系之后的文本同样适用于其他单位与销售合作方：

其他单位与销售合作方的 stable ID、`OTU-*`/`SLP-*` 编码由 DCL subject 持有，`dcl_service_relationships` 与 `dcl_sales_relationships` 在 V1 批准前保存 Party 与经营主体的不可变强类型边界；`partyId` 与顶层 `operatingEntityId` 只在创建时确定，保存 candidate 不得改写 Party 共享身份或经营主体边界。创建可以二选一地传既有 `partyId` 或 `newParty`；新 Party 时同一事务建立 Party root、DCL Party V1 candidate、关系 root 与关系 V1 candidate。

`dcl_other_unit_versions` 保存完整服务关系 snapshot：联系人、电话、邮箱、地址、可选结算方式来源快照、备注与 `enabled`。`dcl_sales_partner_versions` 保存完整销售合作关系 snapshot：`EXTERNAL_PART_TIME` 与 `CHANNEL_PARTNER` 能力集、联系人、电话、邮箱、地址、备注与 `enabled`。销售合作方草稿可暂缺能力，但 submit 与 approve 时至少有一种能力；BOB 的 highest-approved typed query 继续供服务合同、车辆、客户归属、收益和 ACC 引用解析，交易事实始终保存 relationship stable ID、精确 Approval Entry 及自身所需 snapshot。

`/dcl/other-unit` 与 `/dcl/sales-partner` 是两类关系唯一维护入口；`/bob/other-unit` 与 `/bob/sales-partner` 只提供当前正式资料的 `query|get|reference`。启停必须保存包含 `enabled` 的完整 DCL candidate，不存在 BOB 直接启停。审批或反批准只改变 Approval lifecycle；被正式事实精确引用的来源 Approval Entry 不得反批准，后续 candidate 与审批不改写任何历史合同、归属、收益、会计或车辆快照。

## 3.8 会计映射申报

会计映射的 stable subject 是 `(bookId, vouEntity)`，其中 `vouEntity` 是 VOU domain stable ID；每个业务 payload 由一个中央 Approval Version entry 承载。`dcl_acc_mapping_versions` 以 `approvalEntryId` 为主键，保存完整的 `defaultResult`（`POST` 或 `UN_POST`）、声明式 `MappingDefinition`（条件规则、凭证模板和可选资产配置）；所有可变字段随候选版本冻结，不直接修改 ACC 当前记账解释。

`/dcl/acc-mapping` 是会计映射唯一维护入口，候选查询、详情、全部写动作和版本历史固定使用 `/dcl/acc-mapping/*`。`/acc/mapping` 只提供当前最新批准映射的 `query|get` 和稳定字段目录 `catalog`，不在 ACC 内创建、保存或审批候选。APP 工作台和审批深链固定进入 DCL 页面。

批准或反批准在同一事务内原子更新 ACC 的最新批准当前记账解释和精确科目引用登记：批准新版本时登记新版本的末级科目引用，反批准时回落到上一正式版本的引用集合。已被 VOU 会计凭证以精确 `mappingApprovalEntryId` 引用的版本不得反批准，但该 stable subject 的下一候选仍允许创建和审批；历史凭证的身份和记账结果永远不被重算。新批准版本只影响之后发生的会计事实；自动凭证保存实际使用的 `approvalEntryId`。

映射只读取 ACC 发布的稳定字段目录，允许使用头字段和 `lines` 行集合迭代，不执行脚本或任意表达式。条件只允许 `EQ`、`NE`、`IN`、`NOT_IN`、`IS_EMPTY` 和 `IS_NOT_EMPTY`；保存时拒绝可能同时命中的规则，确保一张单据最多选择一个结果。每个映射必须明确设置未命中规则时的 `POST` 或 `UN_POST`。`POST` 结果引用凭证模板，模板逐行声明固定科目或字段取科目、借贷方向、金额字段、币种字段、辅助核算字段以及可选数量字段；`UN_POST` 不引用模板。固定科目必须是本账簿启用的末级科目。

## 3.9 报表定义申报

报表定义的 stable subject 是 DCL 的 `(definitionId, code)`；创建时由系统按 `rpt-NNNNNN` 分配 `code`，创建审计与 code 永久冻结在 `dcl_subjects`。`dcl_rpt_definition_versions` 以 `approvalEntryId` 为主键，保存完整的 `name`、`description`、`enabled`、`sql_text`、`parameters` 和 `columns`；所有可变字段随候选版本冻结。RPT 以 `rpt_definition_validities(approvalEntryId)` 保存 `VALID | INVALID` 及其技术失效审计，独立于 Approval 状态；`APPROVED + INVALID` 合法但不可执行。不存在 RPT root、root revision 或 current pointer。

`/dcl/rpt-definition` 是报表定义唯一维护入口，候选查询、详情、全部写动作和版本历史固定使用 `/dcl/rpt-definition/*`。`/rpt/directory` 和 `/rpt/{code}/query|export` 只提供当前有效定义的查询和执行，不在 RPT 内创建、保存或审批候选。APP 工作台和审批深链固定进入 DCL 页面。

新建和保存必须发送 `enabled`；只有 `DRAFT` candidate 可改启停，已经 `APPROVED` 的定义必须先创建下一候选。批准或反批准在同一事务内原子注册或停用 RPT 的 `query`/`export` 使用权限：首次批准时 RPT 与 APP 在同一事务注册该 code 的精确权限；新版本批准后切换使用权限到新 entry；反批准后回落到上一正式版本或停用。已执行报表的 runtime audit 继续保存原 `approvalEntryId`，定义后续改版不重解释历史运行。execution 只使用当前最新 `APPROVED + enabled + VALID` 定义，不回退旧版本或候选。

## 3.10 流程定义申报

流程定义的 stable subject 是 `dcl_subjects(entity=wfl-process-definition)`，唯一持有 stable ID、code、createdAt 与 createdBy。`wfl_definition_runtime_states` 以 `subjectId` 持有 `enabled`、`updatedAt` 与 `updatedBy`；`dcl_wfl_process_definition_versions`、`wfl_definition_instances` 与 `wfl_create_child_requests` 都以该 subjectId 归属同一身份。`dcl_wfl_process_definition_versions` 以 `approvalEntryId` 为主键，保存完整的 Starlark 脚本、诊断、编译图和试算证据；这些版本化字段随候选版本冻结，不直接修改 WFL 当前执行面。`enabled` 是 runtime state 上的独立开关，不属于 Approval Version snapshot；启停必须携带 latest APPROVED 的 `approvalEntryId` 与 `approvalRevision`，DCL 不保存第二套 subject revision。

新建固定在同一事务依次创建带 code 的 DCL subject、runtime state、中央 Approval V1 `DRAFT` 与 typed version。

`/dcl/wfl-process-definition` 是流程定义唯一维护入口，候选查询、详情、全部写动作和版本历史固定使用 `/dcl/wfl-process-definition/*`。WFL 业务页面只提供当前定义的 `query|get` 和流程实例/执行，不在 WFL 内创建、保存或审批候选。APP 工作台和审批深链固定进入 DCL 页面；工作项和定义深链同样进入 DCL。

批准或反批准在同一事务内原子创建、替换、回落或移除 WFL 当前定义。已被任一持久化 WFL 实例以精确 `approvalEntryId` 引用的版本不得反批准，不存在强制反批准或自动回落；该 stable subject 的下一候选仍允许创建和审批。新实例固定启动时 latest APPROVED 的 `approvalEntryId`，既有实例继续固定自己的 entry，定义后续改版不改写历史实例及其 code/name 快照。试算是 WFL 领域能力，由 DCL 维护流程在保存或提交前调用，接受已存在的 `{entity, documentId}`，以完整冻结的 VOU 副本和零写入 adapter 执行；保存后此前成功试算失效。

Starlark 脚本、编译图、试算零写入 adapter、类型化 `WorkflowActions`、实例树、动作幂等和运行审计仍由 WFL 领域拥有，不迁入通用 DCL 引擎。

## 3.11 Domain ViewModel 动作与刷新

15 个 DCL 可变 subject 的根级 `Dcl*ListItem` 与根级 `Dcl*View` 必须返回必填 `availableApprovalActions`，其元素只取公共 `ApprovalLifecycleAction` 闭集。服务端按该 subject、版本、权限和当前事实计算可用生命周期动作；Domain ViewModel 将这一服务端生命周期动作投影与本领域业务动作组合，页面不得从本地状态、权限或版本元数据推导、补齐或猜测生命周期动作。版本 View、版本 Summary 和 Approval metadata 不携带该字段。

任何业务或生命周期动作成功后，页面刷新受影响列表的 `query` 和已打开对象的 `get`，再显示成功结果；动作失败也以服务端 `errorKey` 和当前返回状态为准。revision 冲突只触发刷新，不自动重放原请求；blocker 仍由动作执行时的服务端检查，页面不以预检结果推断可以绕过或不再检查 blocker。

## 4. 原子性与引用

DCL application service 创建 PostgreSQL transaction，并在同一事务内调用中央 Approval、写入 DCL 类型化快照并同步发布强类型事件。Party、员工、客户、客户账户、供应商、其他单位与销售合作方不应用或移除 BOB 副本；BOB 直接从 DCL stable subject、typed relationship identity、highest APPROVED entry 和完整 snapshot 提供当前有效的只读业务资料。会计映射批准或反批准在同一事务更新 ACC 最新批准当前解释和科目引用登记。报表定义批准或反批准在同一事务注册或停用 RPT query/export 使用权限。流程定义批准或反批准在同一事务创建、替换、回落或移除 WFL 当前定义。任一 Approval subscriber 或领域内同步写入失败时，subject、typed relationship identity、entry、event 与 DCL snapshot 必须全部回滚。

BOB 对新业务解析 current/latest approved，并返回稳定 ID、来源 `approvalEntryId`、编码和类型化资料快照；已保存业务继续按精确 `approvalEntryId` 校验历史批准快照。旧批准版本不会因新版本批准而删除或改写。反批准前必须执行 BOB 领域的精确版本引用 blocker；只允许反批准 Approval 判断的 latest approved。

## 5. 权限

DCL 每个维护页面分别按 `query`、`get`、`create`、`save`、`submit`、`unsubmit`、`reject`、`approve`、`unapprove`、`delete`、`versions`、`audit-history` 精确授权。Party 的 `create` 仅由首条关系创建事务消耗，不提供独立 DCL create 页面。BOB 当前有效资料页面只检查 BOB `query`、`get` 与 `reference`；ACC 当前映射只读页面只检查 ACC `query`、`get` 与 `catalog`；WFL 当前定义只读页面只检查 WFL `query` 与 `get`；RPT 当前查询和执行页面只检查 RPT `query`、`export` 与 `directory`。各类生命周期动作均要求对应 DCL 权限。

## 6. 验收边界

Party 验收必须覆盖最后一个正式版本有正式关系时精确阻断、无正式关系时允许反批准、V2 反批准自然回落 V1，并用两个真实事务证明 Party 反批准不能与关系批准并发绕过 blocker。

真实 PostgreSQL 验收必须覆盖 V1/V2 highest-approved 读取切换与回落、V1 反批准后不可引用、未批准 V1 删除后候选号复用、同一主体唯一开放候选、并发保存最多一个成功、只反批准 latest approved，以及 subscriber 失败时整笔事务回滚。Party 与关系型资料还必须证明 typed relationship identity 在 V1 approve 前存在、BOB 候选不可见、且无 orphan 或重复 `entity+code`。客户还必须覆盖已有 Party 复用、客户创建原子建立默认账户、关系和账户独立 candidate、V2 不影响 latest-approved read、关系/账户附件各自复制与只读、账户完整来源 snapshot、正式销售事实 blocker，以及 V1 历史 exact entry 在 V2 切换后仍可校验。员工、供应商、其他单位与销售合作方还必须覆盖 Party approved 前 submit/approve blocker、经营主体精确来源、latest-approved source、正式引用 blocker、反批准回落和 VOU/ACC 历史快照不变；供应商还必须覆盖结算方式 stable-ID 快照、默认采购员精确来源和采购事实 blocker；销售合作方还必须覆盖能力移除 blocker。仓库还必须覆盖四类停用 blocker 与 VOU 精确版本引用 blocker；车辆还必须覆盖承运归属两种来源、车型 stable-ID 快照与承运方漂移、VOU 精确版本引用 blocker 和历史运输快照不变；资金账户还必须覆盖经营主体来源漂移、账号正式版与候选版共同占用及回落冲突、VOU 精确版本 blocker、VOU 快照不变，以及 ACC 通过不可变 VOU 来源保持可追溯；产品还必须覆盖完整单位/配方 snapshot、AUX current 后续变更不改写历史、原料来源漂移、条码占用、latest-approved 读取切换与回落、正式引用 blocker、VOU/库存/生产/ACC 历史不变。HTTP 与前端验收必须证明 DCL 页面独占 DCL 候选及生命周期编排、BOB 页面只读取当前正式资料、APP 深链进入 DCL，以及 BOB 引用仍能校验精确历史快照。会计映射还必须覆盖完整 snapshot、V1/V2 ACC 当前解释切换与回落、精确 `mappingApprovalEntryId` blocker、VOU 历史凭证身份和记账结果不变、DCL 页面独占映射候选及生命周期编排、ACC 当前页面只读和字段目录，以及待批深链进入 DCL。报表定义还必须覆盖完整 payload snapshot、V1/V2 使用权限切换与回落、VALID/INVALID 独立技术有效性、APPROVED+INVALID 停止执行且不改用其他版本、runtime audit approval entry identity 不变、DCL 页面独占定义候选及生命周期编排、RPT 当前页面只读和执行，以及待批深链进入 DCL。流程定义还必须覆盖 stable ID 与 Approval Entry identity 保留、完整脚本 snapshot、V1/V2 当前定义切换与回落、任一持久化实例精确 `approvalEntryId` blocker、新实例固定 latest APPROVED、既有实例继续固定原 entry、code/name 快照不变、试算零写入、DCL 页面独占定义候选及生命周期编排、WFL 当前页面只读和实例/执行，以及待批深链进入 DCL。
