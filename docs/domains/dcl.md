# DCL 申报控制领域

## 1. 领域职责

DCL（Declaration Control）拥有需要经过审批后才投影到业务运行面的申报主体与强类型申报快照。当前实体是 `operating-entity`、`warehouse`、`vehicle`、`fund-account`、`product`、`party`、`employee`、`customer`、`customer-account`、`supplier`、`other-unit` 与 `sales-partner`：DCL 拥有申报创建、候选编辑、提交、撤回、驳回、批准、反批、草稿删除、版本历史和审计读取；中央 Approval 唯一拥有版本号、状态、revision、审批元数据和审批事件；BOB 只拥有批准结果的当前业务投影、业务编码以及面向交易的引用解析。

DCL 不复制 Approval 版本头，不保存 `currentVersionId`、`effectiveVersionId`、`baseVersionId` 或 `nextVersionNo`。DCL 也不提供 BOB 写入别名、双写、过渡视图或失败回退。

## 2. 经营主体申报

`dcl_subjects` 保存稳定申报主体身份；经营主体的稳定 ID 与 BOB 业务编码跨全部版本不变。`dcl_operating_entity_versions` 以 `approvalEntryId` 为主键，保存该版本完整的法定名称、简称、税号、地址、电话、备注和 `enabled`。所有可变字段均随候选版本冻结；启用或停用同样通过保存新候选并审批，不直接修改 BOB 当前投影。

唯一 wire 字段集合以 [OpenAPI DCL Schema](../../contracts/openapi/schemas/dcl.yaml) 为准。`/dcl/operating-entity` 是经营主体申报的唯一维护页面，候选查询、详情和全部写动作固定使用 `/dcl/operating-entity/*`。`/bob/operating-entity` 是独立的当前正式档案只读页面，只使用 `/bob/operating-entity/query|get`；它可以导航到同一稳定 subject 的 DCL 页面，但不在 BOB 内创建、保存或审批候选。APP 工作台和审批深链固定进入 DCL 页面。

## 3. 版本与当前投影

版本语义完全复用 [Approval Version](approval.md#6-approval-version)：

1. V1 草稿不存在 BOB 当前投影，不能被交易引用；
2. V1 批准后，同一事务把该快照写入对应的 `bob_operating_entities`、`bob_warehouses`、`bob_vehicles`、`bob_fund_accounts`、`bob_products`、employee、customer、customer-account、supplier、other-unit 或 sales-partner current 投影；
3. V2 为 `DRAFT` 或 `PENDING` 时，BOB 当前投影继续指向 V1；
4. V2 批准后，同一事务把当前投影切换到 V2；
5. 反批 V2 后，当前投影回落到仍为 `APPROVED` 的 V1；
6. 反批 V1 后，没有正式版本，BOB 当前投影被删除，但稳定 DCL subject、BOB ID、编码和审批历史保留。

`approval_entries.version_no` 是唯一版本号。BOB current 的 `source_approval_entry_id` 只是当前投影的来源证据，不参与候选号分配，也不改变 latest approved 的推导规则。

## 3.1 仓库申报

仓库 stable ID 与 `WHS-*` 编码跨全部版本不变。`dcl_warehouse_versions` 以 `approvalEntryId` 为主键，保存完整的名称、地址、联系人、联系电话、仓库负责人稳定 ID、负责人精确 Approval Entry、备注和 `enabled`。仓库负责人可空且只表达责任与联系，不授予任何操作权限；创建、保存、提交和批准时分别按最新选择或已保存精确版本校验该负责人。

`/dcl/warehouse` 是唯一维护入口，`/bob/warehouse` 只提供当前正式档案的 `query/get`。启停同样通过完整 DCL candidate 的 `enabled` 改变，不存在 BOB 直接 `enable/disable`。批准 `enabled=false` 或反批回落到 disabled/absent 前，在同一事务锁定仓库、库存和相关 VOU，并检查非零库存、进行中单据、仍可产生后续库存动作的来源单和当前 BOB 引用；存在任一 blocker 时返回 `warehouse_disable_blocked`，Approval 与 BOB current 均不改变。

VOU 与 ACC 继续保存 warehouse stable ID；VOU 同时保存实际采用的精确 DCL Approval Entry ID 与名称等必要快照。候选和后续批准版本不改写历史事实；任一 VOU 状态精确引用某仓库版本时，该版本不得反批。

## 3.2 车辆申报

车辆 stable ID 与 `VEH-*` 编码跨全部版本不变。`dcl_vehicle_versions` 以 `approvalEntryId` 为主键，保存完整的名称、车牌、车型字典编码及来源 Approval Entry、承运归属封闭对象、VIN、发动机号、核定载重、散水承运能力、备注和 `enabled`。承运归属的 wire value 只有 `INTERNAL` 与 `EXTERNAL`：自有车辆必须引用一个当前可用经营主体及其精确 Approval Entry，外部车辆必须引用一条当前可用“其他单位”服务关系及其精确 Approval Entry。

`/dcl/vehicle` 是唯一维护入口，`/bob/vehicle` 只提供当前正式档案的 `query/get/reference`。启停只能保存完整 DCL candidate 的 `enabled` 变更，不存在 BOB 直接 `enable/disable`。候选创建或保存时按最新引用解析车型与承运归属；提交和批准时重新校验已保存的精确来源版本仍是 latest approved。承运方后续改版不会自动改写车辆快照，必须由用户建立车辆下一候选显式采用新版本。

批准或反批在同一事务创建、替换、回落或移除 `bob_vehicles` current。被任一 VOU 正式事实精确引用的车辆 Approval Entry 不得反批；当前车辆引用的经营主体或服务关系也不得失效，必须先通过车辆正常候选与审批流程修改承运归属。VOU 与运输事实继续保存 vehicle stable ID、实际采用的 Approval Entry ID、承运归属和车辆能力快照，任何车辆后续版本均不得重算或改写历史。

## 3.3 资金账户申报

资金账户 stable ID 与 `FAC-*` 编码跨全部版本不变。`dcl_fund_account_versions` 以 `approvalEntryId` 为主键，保存完整的名称、币种、户名、银行、支行、规范化账号、备注、所属经营主体 stable ID、精确 Approval Entry、编码与名称快照，以及 `enabled`。资金账户必须且只能属于一个当前可用经营主体；创建和保存时解析 latest approved，提交和批准时确认已存精确来源仍为 latest approved。所属主体后续改版不自动改写资金账户快照，必须通过新 candidate 显式采用。

`/dcl/fund-account` 是唯一维护入口，`/bob/fund-account` 只提供当前正式档案的 `query/get/reference`。账号移除空白和连字符并转为大写；非空账号在全部资金账户的 latest approved 与唯一 open candidate 之间大小写不敏感唯一，旧批准版本在新版本批准后释放账号。批准或反批在同一事务创建、替换、回落或移除 `bob_fund_accounts` current；账号占用重建也在该事务内完成，冲突时 Approval 与 BOB current 均不改变。

VOU 收付款、费用支付、其他收入和票据资金行继续保存 fund account stable ID、实际采用的 Approval Entry ID、编码、名称与币种快照。任一已持久化 VOU 正文精确引用的资金账户 Approval Entry 不得反批；但可以建立下一 candidate。ACC 继续保存 fund account stable ID 维度，并通过不可变的 VOU `source_id` 追溯实际采用的资金账户版本，不重复保存 Approval Entry 或快照。历史事实不回查当前资金账户并且不随后续版本改变。

## 3.4 产品申报

产品 stable ID、`PRD-*` 编码和抽象基准单位跨全部版本不变。`dcl_product_versions` 以 `approvalEntryId` 为主键，保存完整的名称、产品类型、产品分类、规格、型号、条码、计价单位、默认录入单位、默认包装规格、可回收标志、备注和 `enabled`；类型、分类和单位均同时保存来源 stable ID、精确 Approval Entry 及必要名称快照。单位换算与固定配方是同一产品版本的强类型明细，不是独立对象、独立 API 或独立生命周期；每个版本始终保存完整 snapshot，不保存 diff。

创建或保存时解析当前可用 AUX 来源，并按配方原料 stable ID 解析其 latest approved 产品版本；从正式版本创建候选时，原料 entry 自动前移但权威基准用量不变，需要确认的行保持显式待处理。提交和批准使用同一套完整性规则，并重新校验产品类型、分类、计量单位和配方原料的已存精确 entry 仍为 latest approved。条码在全部产品的 latest approved 与唯一开放候选之间大小写不敏感唯一；并发候选和条码占用由同一事务保证。

`/dcl/product` 是唯一维护入口，`/bob/product` 只提供当前正式档案的 `query/get/reference`。批准或反批在同一事务原子创建、替换、回落或移除 `bob_products` current source；BOB 由该 source 读取对应的完整 DCL snapshot，不复制第二份单位换算或固定配方事实。失败时 DCL snapshot、Approval、标识占用和 BOB current 全部回滚。库存、销售、采购、生产和 ACC 历史继续保存 product stable ID、实际采用的 Approval Entry、数量、名称及各自所需业务快照；任何后续产品版本都不得重算历史数量、配方、金额或库存事实。任一正式业务事实精确引用某产品 Approval Entry 时，该版本不得反批。

## 3.5 主体申报

Party stable root 永久保存身份 ID 与合并状态；`dcl_party_versions` 以 `approvalEntryId` 保存类型、法定名称、显示名称、税号、通用联系方式和完整强标识 snapshot。Party 不能从 DCL 单独创建：首条强类型关系创建时，强标识精确命中已有 approved Party 且用户可读时复用该 Party；命中但不可读时返回不泄露资料的占用冲突；未命中时才在同一 transaction 创建 root、DCL subject、V1 草稿和关系。V1 批准前不存在 BOB current。

`/dcl/party` 是共享身份候选、影响预览、审批、版本、审计和合并维护入口；`/bob/party` 只提供 current `query|get`。V1 与首条关系属于同一原子事实，V1 草稿不得从 Party 页面独立删除；已有正式版本时才可删除其后续 `DRAFT` candidate 并释放候选强标识。批准或反批在同一 transaction 创建、替换、回落或移除 Party current source。强标识“类型 + 规范化值”在 latest approved 与唯一 open candidate 间共同占用；合并、审批或投影失败不得部分改变占用、current 或关系。合并预检固定以双方 current `sourceApprovalEntryId + revision` 为 stale token；双方必须 current approved 且无 open Party candidate，确认仅消费同一预检与显式关系冲突选择，并在 transaction 内复核 token、关系状态和 fingerprint。来源 root 合并后移除 current identifiers 与 BOB current，DCL 历史及 identifier claim 继续保留；DCL 审计按时间统一展示声明 lifecycle 与主体合并事件。历史 VOU 与关系 snapshot 不追溯改写。

## 3.6 员工申报

员工 stable root 固定为 `bob_objects(entity=employee)`，而 `bob_employment_relationships` 保留员工、Party 与经营主体的不可变雇佣边界。`dcl_employee_versions` 以 `approvalEntryId` 保存完整 employee snapshot：人员类别、部门、岗位、工作电话、工作邮箱、入职日期、备注与 `enabled`；它不复制 Party identity 或姓名。人员类别、部门、岗位与经营主体均同时保存 stable ID、精确 Approval Entry、编码及名称快照。

`/dcl/employee` 是员工唯一维护入口，`/bob/employee` 只提供 current `query|get|reference`。创建请求必须选择已有 Party，或提交 `newParty`；新 Party 时同一 transaction 建立 Party root、DCL Party V1 candidate、员工 root、雇佣边界和员工 V1 candidate。employee 的 submit 与 approve 都要求 Party current approved；候选创建和保存按 latest approved 解析 AUX 与经营主体来源，submit/approve 时重新校验所有已保存精确来源仍是 latest approved。V1 的 `enabled` 默认为 `true`；后续启停通过包含 `enabled` 的完整 DCL candidate 保存，不存在 BOB 直接 `enable/disable`。

批准或反批在同一 transaction 创建、替换、回落或移除 BOB employee current source。BOB current 明确返回来源 Approval Entry；VOU/ACC 与其他正式事实继续保存 employee stable ID、精确 Approval Entry 以及各自所需 snapshot。任一正式事实精确引用目标 employee entry 时，反批必须返回 blocker；新 employee candidate 和后续批准版本不改写历史。

## 3.6.1 客户与客户结算子账户申报

客户关系 `customer` 与客户结算子账户 `customer-account` 是独立 Approval subject、独立 DCL 页面和独立 API 路径。稳定模型固定为 Party → 客户关系 → 一个或多个结算子账户：客户关系在创建时一次性绑定 `partyId` 与 `operatingEntityId`，两者以后不得修改；账户只通过 `customerRelationshipId` 归属关系，经营主体从关系推导，客户端不得在账户 input 重复传入经营主体。

`/dcl/customer/create` 原子创建或复用 Party、客户关系 V1 `DRAFT` 与默认账户 V1 `DRAFT`。传 `newParty` 时，Party root、DCL Party V1、客户关系 root、客户 V1 与默认账户 root、账户 V1 全部在同一 PostgreSQL transaction 完成；任一步失败不得留下 Party、关系、账户、Approval entry、附件或事件残留。已有 Party 仅在用户可读取且强标识规则允许时复用；不可读取命中仍返回不泄露资料的 blocker。

客户关系 candidate 版本化 `enabled` 与关系附件。客户账户 candidate 版本化 `enabled` 以及名称、简称、客户类型、联系人、地址、结算方式、收款方式、运输政策、定价政策、信用额度、主要业务归属、内部提醒和默认销售订单备注。账户 `save` 始终携带顶层 `enabled` 与完整 account input；保存的账户 data 同时返回、持久化经营主体、结算方式、收款方式和业务归属的 stable ID、精确 `approvalEntryId`、编码及名称等完整 snapshot。输入只能选择来源 stable ID，服务端解析并冻结 snapshot；来源改名、停用或换版不回写候选、已批准版本或历史单据。

`/dcl/customer` 与 `/dcl/customer-account` 各自提供 `query|get|create|save|submit|unsubmit|reject|approve|unapprove|delete|versions|audit-history`。两者 V2 `DRAFT` 或 `PENDING` 都不影响各自 V1 BOB current；批准与反批在同一事务建立、切换、回落或移除相应 current projection。`/bob/customer` 与 `/bob/customer-account` 只提供 typed current `query|get|reference`，不返回 open candidate，也不保留 BOB 写入、生命周期或附件写入别名。

附件 JSON 元数据统一经 `/dcl/customer/attachment-initiate`、`/dcl/customer/attachment-download` 与 `/dcl/customer/attachment-remove`。`scope=CUSTOMER|CUSTOMER_ACCOUNT` 和 `ownerApprovalEntryId` 精确指向对应 DCL version；initiate/remove 必须携带 `approvalRevision` 且只允许 `DRAFT` owner，download 可读获准 current 或历史 owner 但永远只读。关系和账户附件随各自 candidate 复制，附件类别来源 snapshot 绝不因类别后续变化而回写。文件 token PUT/GET 继续使用 `/files/customer-attachments/*`。

销售、应收、收款、开票与 ACC 事实只在创建新事实时解析当前启用的账户 current；它们保存账户 stable ID、精确 DCL Approval Entry 及所需业务 snapshot。V2 批准不会改写 V1 交易；历史 V1 即使已非 current，只要仍为 `APPROVED` 仍可按 exact entry 校验。正式事实精确引用的关系或账户 entry 不得反批。

## 3.7 供应商、其他单位与销售合作方申报

供应关系 stable root 固定为 Party 与经营主体的不可变强类型关系；`partyId` 与顶层 `operatingEntityId` 只在创建时确定，保存 candidate 不得改写 Party 共享身份或经营主体边界。创建可以二选一地传既有 `partyId` 或 `newParty`；新 Party 时同一 transaction 建立 Party root、DCL Party V1 candidate、供应关系 root 与供应关系 V1 candidate。

`dcl_supplier_versions` 保存完整供应关系 snapshot：`shortName`、`taxNumber`、联系人、电话、邮箱、地址、备注、结算方式来源精确快照、默认采购员来源精确快照与 `enabled`。供应关系不维护任何 supplier category 或 supplier type。默认采购员必须是当前可用 BOB employee 的 exact snapshot；创建和保存按 latest approved 解析，提交和批准重新校验已存结算方式及采购员 entry 仍是 latest approved。

`/dcl/supplier` 是供应关系唯一维护入口，`/bob/supplier` 只提供 current `query|get|reference`。启停必须保存包含 `enabled` 的完整 DCL candidate，不存在 BOB 直接启停。审批或反批在同一事务创建、替换、回落或移除 current；采购订单、采购入库、采购退货、采购付款及其 ACC 事实精确引用的来源 Approval Entry 不得反批，后续 candidate 与审批不改写历史采购或会计快照。

供应关系之后的文本同样适用于其他单位与销售合作方：

其他单位与销售合作方的 stable root 都固定为 Party 与经营主体的不可变强类型关系；`partyId` 与顶层 `operatingEntityId` 只在创建时确定，保存 candidate 不得改写 Party 共享身份或经营主体边界。创建可以二选一地传既有 `partyId` 或 `newParty`；新 Party 时同一事务建立 Party root、DCL Party V1 candidate、关系 root 与关系 V1 candidate。

`dcl_other_unit_versions` 保存完整服务关系 snapshot：联系人、电话、邮箱、地址、可选结算方式来源快照、备注与 `enabled`。`dcl_sales_partner_versions` 保存完整销售合作关系 snapshot：`EXTERNAL_PART_TIME` 与 `CHANNEL_PARTNER` 能力集、联系人、电话、邮箱、地址、备注与 `enabled`。销售合作方草稿可暂缺能力，但 submit 与 approve 时至少有一种能力；关系当前投影继续供服务合同、车辆、客户归属、收益和 ACC 引用解析，交易事实始终保存 relationship stable ID、精确 Approval Entry 及自身所需 snapshot。

`/dcl/other-unit` 与 `/dcl/sales-partner` 是两类关系唯一维护入口；`/bob/other-unit` 与 `/bob/sales-partner` 只提供 current `query|get|reference`。启停必须保存包含 `enabled` 的完整 DCL candidate，不存在 BOB 直接启停。审批或反批在同一事务创建、替换、回落或移除 current；被正式事实精确引用的来源 Approval Entry 不得反批，后续 candidate 与审批不改写任何历史合同、归属、收益、会计或车辆快照。

## 4. 原子性与引用

DCL application service 创建 PostgreSQL transaction，并在同一事务内调用中央 Approval、写入 DCL 类型化快照、同步发布强类型事件以及应用或移除 BOB 当前投影。产品、员工、客户、客户账户与供应商 current source 随版本整体切换，并由该 source 唯一指向完整 DCL snapshot。任一 Approval subscriber 或当前投影写入失败时，entry、event、DCL snapshot 和 BOB current 必须全部回滚。

BOB 对新业务解析 current/latest approved，并返回稳定 ID、来源 `approvalEntryId`、编码和类型化资料快照；已保存业务继续按精确 `approvalEntryId` 校验历史批准快照。旧批准版本不会因新版本批准而删除或改写。反批前必须执行 BOB 领域的精确版本引用 blocker；只允许反批 Approval 判断的 latest approved。

## 5. 权限

DCL 每个维护页面分别按 `query`、`get`、`create`、`save`、`submit`、`unsubmit`、`reject`、`approve`、`unapprove`、`delete`、`versions`、`audit-history` 精确授权。Party 的 `create` 仅由首条关系创建事务消耗，不提供独立 DCL create 页面。BOB 当前档案页面只检查 BOB `query`、`get` 与 `reference`，不得因用户具有 DCL 权限而显示 BOB 生命周期动作。权限切换保留已有角色分配但不保留旧 BOB 写路径；仓库、车辆、资金账户、产品、员工、客户、客户账户与供应商原 BOB 写/启停权限不再暴露，启停申请本身要求对应 DCL `save`。

## 6. 验收边界

真实 PostgreSQL 验收必须覆盖 V1/V2 正式投影切换与回落、V1 反批后不可引用、草稿删除后候选号复用、同一主体唯一开放候选、并发保存最多一个成功、只反批 latest approved，以及 subscriber 或 BOB current 写入失败时整笔事务回滚。客户还必须覆盖已有 Party 复用、客户创建原子建立默认账户、关系和账户独立 candidate、V2 不影响 current、关系/账户附件各自复制与只读、账户完整来源 snapshot、正式销售事实 blocker、V1 历史 exact entry 在 V2 切换后仍可校验，以及 current 投影失败时整笔事务回滚。员工、供应商、其他单位与销售合作方还必须覆盖 Party approved 前 submit/approve blocker、经营主体精确来源、current source、正式引用 blocker、反批回落和 VOU/ACC 历史快照不变；供应商还必须覆盖结算方式与默认采购员的精确来源、采购事实 blocker 及无供应商类别的 cutover 拒绝；销售合作方还必须覆盖能力移除 blocker。仓库还必须覆盖四类停用 blocker 与 VOU 精确版本引用 blocker；车辆还必须覆盖承运归属两种来源、车型与承运方漂移、VOU 精确版本引用 blocker 和历史运输快照不变；资金账户还必须覆盖经营主体来源漂移、账号正式版与候选版共同占用及回落冲突、VOU 精确版本 blocker、VOU 快照不变，以及 ACC 通过不可变 VOU 来源保持可追溯；产品还必须覆盖完整单位/配方 snapshot、AUX 与原料来源漂移、条码占用、current 切换与回落、正式引用 blocker、VOU/库存/生产/ACC 历史不变。HTTP 与前端验收必须证明旧 BOB 写路由与权限不存在、DCL 页面独占 DCL 候选及生命周期编排、BOB 页面只读取当前正式投影、APP 深链进入 DCL，以及 BOB 引用仍能校验精确历史快照。
