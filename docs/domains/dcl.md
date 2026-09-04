# DCL 申报控制领域

## 1. 领域职责

DCL（Declaration Control）拥有全部版本化业务对象的稳定 subject、business code 与强类型 Submission snapshot。当前实体是 `operating-entity`、`warehouse`、`vehicle`、`fund-account`、`product`、`employee`、`customer`、`supplier`、`other-unit`、`sales-partner`、`acc-mapping`、`rpt-definition` 与 `wfl-process-definition`：用户在本地 Draft 编辑，DCL 在 submit 时创建或删除开放 Submission，并读取版本历史和审计；中央 Approval 唯一拥有版本号、`PENDING | APPROVED | REJECTED`、revision、审批元数据和审批事件。BOB 只通过 highest APPROVED typed snapshot 提供当前有效业务资料的只读查询与交易引用解析。Party 与独立 `customer-subunit` subject 不存在；客户子单位是 Customer Version 内的强类型子项。会计映射、报表定义和流程定义的既有领域边界不变。

### 1.1 本地 Draft 与 Submission 生命周期

除 Warehouse 与 WFL Process Definition 外，本切片迁移的 11 个 DCL 聚合均采用同一目标生命周期：浏览器在当前登录用户和设备命名空间的 IndexedDB 中可同时保留多个本地 Draft。Draft 保存客户端生成的 draft/subject/submission 标识、未发送的完整表单、引用显示快照以及支持该聚合的附件 Blob 和元数据；刷新恢复、克隆和本地删除不写业务数据库。Draft 删除不请求 HTTP，也不属于 Approval。WFL Process Definition 的目标生命周期、真实既有 VOU 零写试运行、current read 与启停整体由后续事务核心切片交付；#366 前完整 live Go 实现保持不变。

只有 `POST /dcl/{entity}/submit-new` 与 `POST /dcl/{entity}/submit-change`（可执行 Hono/Zod 目标路由）会在服务器事务中创建 Submission、版本 payload 和必要 stable subject。请求必须带 `expectedLatestApprovedSubmissionId` 与 `expectedLatestApprovedRevision`；服务端锁内重新读取历史和当前事实、权限及引用后决定这是 V1 还是最高已批准版本之后的 Vn，并拒绝与事实不符的 submit mode、过期 expected 值、重复开放候选或重复标识。浏览器规范化和决定只作提示，不能替代服务端复核。

Submission 一旦持久化即不可编辑，唯一状态是 `PENDING | APPROVED | REJECTED`。有效动作只有 `approve`、`reject`、`unreject`、`unapprove` 和开放 Submission `delete`；“撤回”只是页面对 `delete` 的编排，不产生 `WITHDRAWN`、`REVOKED` 或 `unsubmit`。`reject` 和 `unapprove` 要求非空 reason，`unreject` 将 `REJECTED` 恢复为 `PENDING`，`unapprove` 在领域补偿或 blocker 检查通过后将 `APPROVED` 恢复为 `PENDING`，删除只允许开放 `PENDING`/`REJECTED` Submission。每次动作携带 expected revision 并递增 revision；提交人不得自审。

当前有效态永远由最高 `APPROVED` 版本推导，不保存 current pointer。开放候选与当前态并存：`PENDING` 或 `REJECTED` 不会取代当前态，批准后自然切换，反批准最高版本后自然回落到上一最高批准版本，无批准版本时为空。目标路由、响应和权限目录从 Hono route metadata 生成；#366 前 live Go/OpenAPI 仍是生产权威，不与目标线组合。

`dcl_subjects` 是版本化业务对象唯一通用稳定身份，最小保存不可变 ID、entity、nullable code、createdAt 与 createdBy；非空 `(entity, upper(code))` 唯一。只有 ACC Mapping 是合法的无编码 subject。Operating Entity、Warehouse、Vehicle、Fund Account、Product、Employee、Customer、Supplier、Other Unit 与 Sales Partner 必须分别匹配 `OPE/WHS/VEH/FAC/PRD/EMP/CUS/SUP/OTU/SLP-[0-9]{4}`；客户子单位不占用 DCL subject 或全局编码空间，其稳定 ID 由 Customer 聚合持有，编码只在所属客户内大小写不敏感唯一。RPT 与 WFL 编码规则不变。DCL 不复制 Approval 版本头，不保存 current pointer 或第二套 revision，也不提供 BOB 写入别名、双写、过渡视图或失败回退。

## 2. 经营主体申报

`dcl_subjects` 保存经营主体唯一稳定 ID 与 `OPE-*` 业务编码；二者跨全部版本不可变。`dcl_operating_entity_versions` 以 `approvalEntryId` 为主键，保存该版本完整的法定名称、简称、税号、地址、电话、备注和 `enabled`。所有可变字段均随候选版本冻结；启用或停用同样通过本地 Draft 经 `submit-change` 形成新候选并审批，不存在 BOB current 写入。

目标线协议由可执行 Hono/Zod 路由生成；#366 前 live OpenAPI 仍只描述 live Go 路径，二者不得组合。`/dcl/operating-entity` 是经营主体档案的唯一页面，Submission 查询、当前正式资料、详情和全部写动作固定使用 `/dcl/operating-entity/*`。`/bob/operating-entity/query|get` 只作为内部当前正式资料读取边界，不注册页面、菜单或深链。APP 工作台和审批深链固定进入 DCL 页面。

## 3. 版本与当前读取

版本语义完全复用 [Approval Version](approval.md#6-approval-version)：

1. V1 的本地 Draft 或 `PENDING`/`REJECTED` Submission 没有 BOB 当前有效资料，不能被交易引用；
2. V1 批准后，BOB 直接连接 DCL subject、highest APPROVED Approval Entry 与对应 typed snapshot 读取；
3. V2 为 `PENDING` 或 `REJECTED` 时，BOB 仍读取 V1；
4. V2 批准后，BOB 下一次读取自然选择 V2，不执行额外 current 写入；
5. 反批准 V2 后，BOB 自然回到仍为 `APPROVED` 的 V1；
6. 反批准 V1 后，没有正式版本，BOB 查询自然不可见，但稳定 DCL subject、编码和审批历史保留。

`approval_entries.version_no` 是唯一版本号，`approval_entries.revision` 是唯一并发 revision。BOB response 的 `sourceApprovalEntryId` 与 `sourceVersionNo` 直接来自查询选中的 Approval Entry，不持久化第二份来源指针。

## 3.1 仓库申报

仓库 stable ID 与 `WHS-*` 编码跨全部版本不变。`dcl_warehouse_versions` 以 `approvalEntryId` 为主键，保存完整的名称、地址、联系人、联系电话、仓库负责人稳定 ID、负责人精确 Approval Entry、备注和 `enabled`。仓库负责人可空且只表达责任与联系，不授予任何操作权限；本地 Draft、submit 和批准时分别按最新选择或已保存精确版本校验该负责人。

`/dcl/warehouse` 是唯一页面和维护入口，`/bob/warehouse/query|get` 只提供内部当前正式资料读取，不注册页面或菜单。启停同样通过完整 DCL candidate 的 `enabled` 改变，不存在 BOB 直接 `enable/disable`。批准 `enabled=false` 或反批准回落到 disabled/absent 前，在同一事务锁定仓库、库存和相关 VOU，并检查非零库存、进行中单据、仍可产生后续库存动作的来源单和当前正式引用；存在任一 blocker 时返回 `warehouse_disable_blocked`，Approval 保持不变。

VOU 与 ACC 继续保存 warehouse stable ID；VOU 同时保存实际采用的精确 DCL Approval Entry ID 与名称等必要快照。候选和后续批准版本不改写历史事实；任一 VOU 状态精确引用某仓库版本时，该版本不得反批准。

## 3.2 车辆申报

车辆 stable ID 与 `VEH-*` 编码跨全部版本不变。`dcl_vehicle_versions` 以 `approvalEntryId` 为主键，保存完整的名称、车牌、车型字典编码及来源 Approval Entry、承运归属封闭对象、VIN、发动机号、核定载重、散水承运能力、备注和 `enabled`。承运归属的 wire value 只有 `INTERNAL` 与 `EXTERNAL`：自有车辆必须引用一个当前可用经营主体及其精确 Approval Entry，外部车辆必须直接引用一个当前可用其他单位档案及其精确 Approval Entry。

`/dcl/vehicle` 是唯一页面和维护入口，`/bob/vehicle/query|get|reference` 只提供内部当前正式资料读取，不注册页面或菜单。启停只能在本地 Draft 编辑完整 DCL snapshot，再经 `submit-new`/`submit-change` 形成候选，不存在 BOB 直接 `enable/disable`。Draft 与 submit 按最新引用解析车型与承运归属；服务端 submit 和批准时重新校验已保存的精确来源版本仍是 latest approved。承运方后续改版不会自动改写车辆快照，必须由用户建立车辆下一候选显式采用新版本。

批准或反批准只改变 Approval lifecycle；BOB 通过 highest APPROVED typed query 自然切换、回落或隐藏车辆资料，不保存车辆 current copy。被任一 VOU 正式事实精确引用的车辆 Approval Entry 不得反批准；当前车辆引用的经营主体或其他单位档案也不得失效，必须先通过车辆正常候选与审批流程修改承运归属。VOU 与运输事实继续保存 vehicle stable ID、实际采用的 Approval Entry ID、承运归属和车辆能力快照，任何车辆后续版本均不得重算或改写历史。

## 3.3 资金账户申报

资金账户 stable ID 与 `FAC-*` 编码跨全部版本不变。`dcl_fund_account_versions` 以 `approvalEntryId` 为主键，保存完整的名称、币种、户名、银行、支行、规范化账号、备注、所属经营主体 stable ID、精确 Approval Entry、编码与名称快照，以及 `enabled`。资金账户必须且只能属于一个当前可用经营主体；Draft 规范化时解析 latest approved，submit 和批准时确认已存精确来源仍为 latest approved。所属主体后续改版不自动改写资金账户快照，必须通过新的 `submit-change` 显式采用。

`/dcl/fund-account` 是唯一页面和维护入口，`/bob/fund-account/query|get|reference` 只提供内部当前正式资料读取，不注册页面或菜单。账号移除空白和连字符并转为大写；非空账号在全部资金账户的 latest approved 与唯一 open candidate 之间大小写不敏感唯一，旧批准版本在新版本批准后释放账号。批准或反批准只改变 Approval lifecycle，并在同一事务更新账号占用；BOB 通过 highest APPROVED typed query 自然切换、回落或隐藏资料，冲突时 Approval 与账号占用均不改变。

VOU 收付款、费用支付、其他收入和票据资金行继续保存 fund account stable ID、实际采用的 Approval Entry ID、编码、名称与币种快照。任一已持久化 VOU 正文精确引用的资金账户 Approval Entry 不得反批准；但可以建立下一 candidate。ACC 继续保存 fund account stable ID 维度，并通过不可变的 VOU `source_id` 追溯实际采用的资金账户版本，不重复保存 Approval Entry 或快照。历史事实不回查当前资金账户并且不随后续版本改变。

## 3.4 产品申报

产品 stable ID、`PRD-*` 编码和抽象基准单位跨全部版本不变。`dcl_product_versions` 以 `approvalEntryId` 为主键，保存完整的名称、产品类型、产品分类、规格、型号、条码、计价单位、默认录入单位、默认包装规格、可回收标志、备注和 `enabled`；类型、分类和单位均同时保存来源 AUX stable ID 及必要名称和 typed 参数快照，不保存 AUX Approval Entry。每个计量单位 snapshot 还必须保存当时的 `quantityScale`，单位换算和固定配方中的单位不得在读取或制单时回查 AUX 精度。单位换算与固定配方是同一产品版本的强类型明细，不是独立对象、独立 API 或独立生命周期；每个版本始终保存完整 snapshot，不保存 diff。

Draft 规范化时解析当前启用且 entity 匹配的 AUX stable object，并按配方原料 stable ID 解析其 latest approved 产品版本；从正式版本克隆本地 Draft 时，原料 entry 自动前移但权威基准用量不变，需要确认的行保持显式待处理。submit 和批准使用同一套完整性规则：AUX 快照只校验完整性与 stable identity，不回查来源 current，也不因来源后续改名、修改或停用而漂移；配方原料的已存精确 DCL entry 仍须为 latest approved。条码在全部产品的 latest approved 与唯一开放候选之间大小写不敏感唯一；并发候选和条码占用由同一事务保证。

`/dcl/product` 是唯一页面和维护入口，`/bob/product/query|get|reference` 只提供内部当前正式资料读取，不注册页面或菜单。批准或反批准只改变 Approval lifecycle；BOB 直接读取 highest APPROVED entry 对应的完整 DCL snapshot，不保存产品 current source，也不复制单位换算或固定配方事实。失败时 DCL snapshot、Approval 与标识占用全部回滚。库存、销售、采购、生产和 ACC 历史继续保存 product stable ID、实际采用的 Approval Entry、数量、名称及各自所需业务快照；任何后续产品版本都不得重算历史数量、配方、金额或库存事实。任一正式业务事实精确引用某产品 Approval Entry 时，该版本不得反批准。

## 3.5 强类型业务身份

Customer、Supplier、Employee、Other Unit 与 Sales Partner 各自在自己的完整 typed version 中保存身份、法定名称、显示名称、单一法定识别号和联系资料，不引用共享 Party。法定识别号按“业务档案类型 + 规范化值”在该类型的 latest approved 与唯一 open candidate 间共同占用；跨业务档案类型不比较、不复用、不同步，也不提供跨类型或同类型合并。误建且已有历史引用的档案只能通过下一候选停用，历史快照保持原值。

Party subject、版本、强标识数组、标识类型、重复税号字段、关系 root、影响预览、合并预检/确认、权限、页面和 API 全部不存在。每种业务档案都由本地 Draft 通过 `submit-new` 在同一事务建立自己的 DCL subject、V1 candidate 和 typed snapshot；失败时整体回滚。法定识别号变更与其他身份资料一起进入该档案正常的候选和审批流程。

## 3.6 员工申报

员工 stable ID 与 `EMP-*` 编码由 `dcl_subjects(entity=employee)` 持有。`dcl_employee_versions` 以 `approvalEntryId` 保存完整身份和雇佣 snapshot：人员法律身份、单一法定识别号、姓名、人员类别、部门、岗位、工作电话、工作邮箱、入职日期、任职经营主体、备注与 `enabled`。人员类别、部门、岗位与经营主体均保存稳定来源及必要快照。

`/dcl/employee` 是员工唯一维护入口，`/bob/employee` 只提供 current `query|get|reference`。`submit-new` 只提交员工完整资料，不选择或创建 Party。任职经营主体必须存在且当前有效，但只是员工资料，不限制其他经营主体的业务单据选择该员工；单据选择资格仍由自身权限和业务规则决定。V1 的 `enabled` 默认为 `true`，后续启停通过本地 Draft 与 `submit-change` 完成。

批准或反批准只改变 Approval lifecycle；BOB 直接读取 highest APPROVED employee snapshot 并返回来源 Approval Entry。VOU/ACC 与其他正式事实继续保存 employee stable ID、精确 Approval Entry 以及各自所需 snapshot。任一正式事实精确引用目标 employee entry 时，反批准必须返回 blocker；新 employee candidate 和后续批准版本不改写历史。

## 3.6.1 客户与客户子单位申报

Customer 是唯一 Approval subject 和聚合根。客户 stable ID 与 `CUS-*` 编码由 DCL subject 持有；Customer 的身份 wire value 只有 `MAINLAND_ENTERPRISE`、`MAINLAND_INDIVIDUAL` 和 `OTHER`，本地新 Draft 默认 `MAINLAND_ENTERPRISE`。Customer Version 完整保存身份、法定名称、显示名称、单一法定识别号、联系电话、邮箱、联系地址、开票抬头、开票地址、开票电话、开票开户行及账号、零个或多个汇款识别档案、默认经营主体、`enabled`、身份税务附件，以及一个或多个客户子单位。大陆企业号码删除全部空白并大写，必须通过 18 位统一社会信用代码字符集和校验码；大陆个人号码规范化末位 `X`，必须通过 18 位居民身份证结构、出生日期和校验码；其他号码仅 trim 且非空时在 Customer 内查重。Draft 可为空但非空时立即校验，submit 和批准在同一事务重新验证必填、格式和唯一性。每个汇款识别档案保存付款户名及可选付款银行、付款账号，用来辅助匹配真实来款，不代表客户子单位或经营主体。客户不保存可交易经营主体名单；任一有效经营主体均可用于新销售单据，默认经营主体只提供预填。

客户子单位是 Customer Version 内的强类型子项，不是 DCL subject。子单位保存稳定 `subunitId`、客户内唯一且不可复用的 `SUB-NNNN` 顺序 code、名称、联系人、业务地址、客户类型、结算和收款方式、运输与定价、逐币种信用额度、主要业务归属、内部提醒、默认订单备注、业务附件与 `enabled`；联系人没有独立实体或启停状态。启用 Customer 至少包含一个启用子单位；停用 Customer 阻止全部新子单位引用，但保留子单位自身启停状态和历史事实。系统不保存 `isDefault` 或 `implicitSubunitId`：`implicitSubunitId` 只存在于查询响应中，恰有一个启用子单位时从所读版本即时派生，两个及以上时返回空值，采用方必须明确选择并保存实际子单位。

`/dcl/customer` 是客户及全部子单位的唯一维护边界，提供本地 Draft、Submission、版本和审计；`/dcl/customer-subunit`、独立子单位页面和独立工作台任务不存在。根资料和完整子单位集合都只在本地 Draft 编辑，submit 时拒绝越界字段，并以 `expectedLatestApprovedSubmissionId`/`expectedLatestApprovedRevision` 并发保护同一开放 candidate。`submit-new` 必须原子建立至少一个子单位，并同时要求 Customer submit-new 与“维护客户子单位”权限；submit 和批准在同一 transaction 校验根资料与完整子单位集合并一次切换，开放 candidate 不影响 BOB current。

已批准版本中的子单位不能物理删除；下一 Customer candidate 可以停用或从当前集合移除，但其 stable ID 与历史版本永久可解析。只有从未进入任何批准版本且未被业务引用的本地 Draft 子单位才可物理删除。本地 Draft 的根资料编辑不得丢失子单位或其业务附件，子单位编辑不得改变根资料或身份税务附件。交易和 ACC 历史至少保存 `subunitId + customerApprovalEntryId + 必要业务快照`，正式引用阻止对应 Customer Approval Entry 的不安全反批准。

Customer 附件先随本地 Draft 以 Blob 保留，submit 时经 `/dcl/customer/attachment-stage` 暂存并在同一事务随 Customer Version 最终入库；失败或过期暂存由 `/dcl/customer/attachment-cleanup` 清理，不产生第二事实源。

## 3.7 供应商、其他单位与销售合作方申报

Supplier、Other Unit 与 Sales Partner 各自是全局强类型业务档案和独立 Approval subject，不引用 Party 或 relationship root。它们都可以维护适用经营主体集合和一个集合内的默认经营主体；新业务单据只能选择适用集合中的经营主体，默认值只用于预填。

`dcl_supplier_versions` 保存完整供应商身份、单一法定识别号、联系人、地址、备注、适用和默认经营主体、可选结算方式快照、默认采购员快照与 `enabled`。供应商不维护 category 或 type。默认采购员必须是当前可用 Employee snapshot，但其任职经营主体不限制选择。

`/dcl/supplier` 是供应商唯一维护入口，`/bob/supplier` 只提供 current `query|get|reference`。采购订单、采购入库、采购退货、采购付款及 ACC 事实保存 Supplier stable ID、精确 Approval Entry 和必要快照；后续版本不改写历史。

`dcl_other_unit_versions` 保存完整身份、单一法定识别号、联系人、地址、适用和默认经营主体、可选结算方式、备注与 `enabled`。`dcl_sales_partner_versions` 保存完整身份、单一法定识别号、适用和默认经营主体、`EXTERNAL_PART_TIME` 与 `CHANNEL_PARTNER` 能力集、联系人、地址、备注与 `enabled`。销售合作方草稿可暂缺能力，但 submit 与 approve 时至少有一种能力。Customer 与 Sales Partner 的法定识别号相同且身份可比较时禁止把该客户子单位归属给该 Sales Partner；`OTHER` 不推测现实身份。

`/dcl/other-unit` 与 `/dcl/sales-partner` 是各自唯一维护入口；对应 BOB 路径只提供 current `query|get|reference`。正式事实保存 typed stable ID、精确 Approval Entry 和必要快照；后续版本不改写历史合同、归属、收益、会计或车辆事实。

## 3.8 会计映射申报

会计映射的 stable subject 是 `(bookId, vouEntity)`，其中 `vouEntity` 是 VOU domain stable ID；每个业务 payload 由一个中央 Approval Version entry 承载。`dcl_acc_mapping_versions` 以 `approvalEntryId` 为主键，保存完整的 `defaultResult`（`POST` 或 `UN_POST`）、声明式 `MappingDefinition`（条件规则、凭证模板和可选资产配置）；所有可变字段随候选版本冻结，不直接修改 ACC 当前记账解释。

`/dcl/acc-mapping` 是会计映射唯一维护入口，候选查询、详情、版本历史与全部 lifecycle 动作固定使用目标 Hono `/dcl/acc-mapping/{query|get|versions|audit-history|submit-new|submit-change|approve|reject|unreject|unapprove|delete}`。本地 Draft 的完整 MappingDefinition 只在 `submit-new`/`submit-change` 写入服务端 `PENDING`；服务端按 `(bookId, vouEntity)` 历史和 expected latest approved 事实分配 V1/Vn。`/acc/mapping` 只提供当前最新批准映射的 `query|get` 和稳定字段目录 `catalog`，不在 ACC 内创建、保存或审批候选。APP 工作台和审批深链固定进入 DCL 页面。

批准或反批准在同一事务内原子更新 ACC 的最新批准当前记账解释和精确科目引用登记：批准新版本时登记新版本的末级科目引用，反批准时回落到上一正式版本的引用集合。已被 VOU 会计凭证以精确 `mappingApprovalEntryId` 引用的版本不得反批准，但该 stable subject 的下一候选仍允许经 `submit-change` 建立和审批；历史凭证的身份和记账结果永远不被重算。新批准版本只影响之后发生的会计事实；自动凭证保存实际使用的 `approvalEntryId`。

映射只读取 ACC 发布的稳定字段目录，允许使用头字段和 `lines` 行集合迭代，不执行脚本或任意表达式。条件只允许 `EQ`、`NE`、`IN`、`NOT_IN`、`IS_EMPTY` 和 `IS_NOT_EMPTY`；Draft 规范化和 submit 时拒绝可能同时命中的规则，确保一张单据最多选择一个结果。每个映射必须明确设置未命中规则时的 `POST` 或 `UN_POST`。`POST` 结果引用凭证模板，模板逐行声明固定科目或字段取科目、借贷方向、金额字段、币种字段、辅助核算字段以及可选数量字段；`UN_POST` 不引用模板。固定科目必须是本账簿启用的末级科目。

## 3.9 报表定义申报

报表定义的 stable subject 是 DCL 的 `(definitionId, code)`；`submit-new` 时由服务端按 `rpt-NNNNNN` 分配 `code`，提交审计与 code 永久冻结在 `dcl_subjects`。`dcl_rpt_definition_versions` 以 `approvalEntryId` 为主键，保存完整的 `name`、`description`、`enabled`、`sql_text`、`parameters` 和 `columns`；所有可变字段随候选版本冻结。RPT 以 `rpt_definition_validities(approvalEntryId)` 保存 `VALID | INVALID` 及其技术失效审计，独立于 Approval 状态；`APPROVED + INVALID` 合法但不可执行。不存在 RPT root、root revision 或 current pointer。

`/dcl/rpt-definition` 是报表定义唯一维护入口，候选查询、详情、全部写动作和版本历史固定使用 `/dcl/rpt-definition/*`。`/rpt/directory` 和 `/rpt/{code}/query|export` 只提供当前有效定义的查询和执行，不在 RPT 内创建、保存或审批候选。APP 工作台和审批深链固定进入 DCL 页面。

`submit-new`/`submit-change` 时必须发送 `enabled`；已持久化 Submission 不可编辑，已经 `APPROVED` 的定义必须从本地 Draft 提交下一 Submission。批准或反批准在同一事务内原子注册或停用 RPT 的 `query`/`export` 使用权限：首次批准时 RPT 与 APP 在同一事务注册该 code 的精确权限；新版本批准后切换使用权限到新 entry；反批准后回落到上一正式版本或停用。已执行报表的 runtime audit 继续保存原 `approvalEntryId`，定义后续改版不重解释历史运行。execution 只使用当前最新 `APPROVED + enabled + VALID` 定义，不回退旧版本或候选。

## 3.10 流程定义申报

流程定义的 stable subject 是 `dcl_subjects(entity=wfl-process-definition)`，唯一持有 stable ID、code、createdAt 与 createdBy。`wfl_definition_runtime_states` 以 `subjectId` 持有 `enabled`、`updatedAt` 与 `updatedBy`；`dcl_wfl_process_definition_versions`、`wfl_definition_instances` 与 `wfl_create_child_requests` 都以该 subjectId 归属同一身份。`dcl_wfl_process_definition_versions` 以 `approvalEntryId` 为主键，保存完整的 Starlark 脚本、诊断、编译图和试算证据；这些版本化字段随候选版本冻结，不直接修改 WFL 当前执行面。`enabled` 是 runtime state 上的独立开关，不属于 Approval Version snapshot；启停必须携带 latest APPROVED 的 `approvalEntryId` 与 `approvalRevision`，DCL 不保存第二套 subject revision。

本地 Draft submit 固定在同一事务依次创建带 code 的 DCL subject、runtime state、中央 Approval V1 `PENDING` Submission 与 typed version。

`/dcl/wfl-process-definition` 是流程定义唯一维护入口，候选查询、详情、全部写动作和版本历史固定使用 `/dcl/wfl-process-definition/*`。WFL 业务页面只提供当前定义的 `query|get` 和流程实例/执行，不在 WFL 内创建、保存或审批候选。APP 工作台和审批深链固定进入 DCL 页面；工作项和定义深链同样进入 DCL。

批准或反批准在同一事务内原子创建、替换、回落或移除 WFL 当前定义。已被任一持久化 WFL 实例以精确 `approvalEntryId` 引用的版本不得反批准，不存在强制反批准或自动回落；该 stable subject 的下一候选仍允许创建和审批。新实例固定启动时 latest APPROVED 的 `approvalEntryId`，既有实例继续固定自己的 entry，定义后续改版不改写历史实例及其 code/name 快照。试算是 WFL 领域能力，由 DCL 维护流程在保存或提交前调用，接受已存在的 `{entity, documentId}`，以完整冻结的 VOU 副本和零写入 adapter 执行；保存后此前成功试算失效。

Starlark 脚本、编译图、试算零写入 adapter、类型化 `WorkflowActions`、实例树、动作幂等和运行审计仍由 WFL 领域拥有，不迁入通用 DCL 引擎。

## 3.11 Domain ViewModel 动作与刷新

13 个 DCL 可变 subject 的根级 `Dcl*ListItem` 与根级 `Dcl*View` 必须返回必填 `availableApprovalActions`，其元素只取公共 `ApprovalLifecycleAction` 闭集。服务端按该 subject、版本、权限和当前事实计算可用生命周期动作；Domain ViewModel 将这一服务端生命周期动作投影与本领域业务动作组合，页面不得从本地状态、权限或版本元数据推导、补齐或猜测生命周期动作。版本 View、版本 Summary 和 Approval metadata 不携带该字段。

任何业务或生命周期动作成功后，页面刷新受影响列表的 `query` 和已打开对象的 `get`，再显示成功结果；动作失败也以服务端 `errorKey` 和当前返回状态为准。revision 冲突只触发刷新，不自动重放原请求；blocker 仍由动作执行时的服务端检查，页面不以预检结果推断可以绕过或不再检查 blocker。

## 3.12 Subject code 的 nullable 查询边界

`dcl_subjects.code` 在数据库和查询边界保持 nullable 事实。DCL、BOB、APP 和 RPT 查询直接读取该值；要求业务编码的 Go Domain consumer 必须在消费处拒绝缺失的 `Subject code`，返回应用数据不变量错误。消费方不得把 `NULL` 转为空字符串、占位编码或 `COALESCE` 结果，也不得静默过滤缺失 code 的 subject。ACC Mapping 是合法的无编码例外，支持该实体的消费方必须保留空值语义。

DCL 写入路径仍负责为要求编码的实体分配并校验业务编码，但不依赖数据库函数在读取时抛出业务异常；查询层只返回事实，缺失事实的拒绝属于对应 Go Domain consumer 的职责。

## 4. 原子性与引用

DCL application service 创建 PostgreSQL transaction，并在同一事务内调用中央 Approval、写入 DCL 类型化快照并同步发布强类型事件。Employee、Customer、Supplier、Other Unit 与 Sales Partner 直接从自己的 DCL stable subject、highest APPROVED entry 和完整 snapshot 向 BOB 提供 current 只读资料；不存在 Party、relationship identity 或 BOB 副本。Customer Version 与全部客户子单位是一个原子 snapshot。任一 Approval subscriber 或领域内同步写入失败时，subject、entry、event 与 typed snapshot 必须全部回滚。

BOB 对新业务解析 current/latest approved，并返回稳定 ID、来源 `approvalEntryId`、编码和类型化资料快照；已保存业务继续按精确 `approvalEntryId` 校验历史批准快照。旧批准版本不会因新版本批准而删除或改写。反批准前必须执行 BOB 领域的精确版本引用 blocker；只允许反批准 Approval 判断的 latest approved。

## 5. 权限

DCL Customer 根资料按 `query`、`get`、`submit-new`、`submit-change` 和 lifecycle 路径精确授权；`submit-new`/`submit-change` 同时覆盖完整 Customer snapshot（含子单位）的提交。子单位维护权限覆盖子单位新增、编辑、启停、移除及业务附件上传/移除；`get` 可以查看子单位并下载附件。根资料维护者不能修改子单位，子单位维护者无需根资料编辑权限即可修改同一本地 Draft；Customer `approve` 权限自身允许审批人查询、查看并下载完整 candidate，无需额外授予 `query` 或 `get`。Customer Subunit 不注册独立实体权限、页面、菜单、Approval、版本、工作台或待办。

## 6. 验收边界

真实 PostgreSQL 验收必须覆盖 V1/V2 highest-approved 切换与回落、同一 subject 唯一 `PENDING`/`REJECTED` 开放 Submission、submit 幂等、分命令并发旧 revision、法定识别号按业务档案类型唯一，以及 subscriber 失败整笔回滚。Customer 还必须覆盖本地 Draft 创建至少一个子单位、根/子单位字段隔离、附件保留、Submission 隔离、专属顺序 code、两级启停、本地子单位删除与正式移除保留、唯一启用子单位隐式选择、多个启用子单位强制显式选择、`subunitId + customerApprovalEntryId` 历史读取，以及无独立子单位 lifecycle。跨域公共验收统一使用 `customer-subunit`、`subunits`、`subunitId` 和 `CUSTOMER_SUBUNIT`，并证明已取代的 wire、表、权限和路径不可达。
