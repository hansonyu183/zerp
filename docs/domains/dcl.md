# DCL 申报控制领域

## 1. 领域职责

DCL（Declaration Control）拥有全部版本化业务对象的稳定 subject、business code 与强类型申报快照。当前实体是 `operating-entity`、`warehouse`、`vehicle`、`fund-account`、`product`、`employee`、`customer`、`supplier`、`other-unit`、`sales-partner`、`acc-mapping`、`rpt-definition` 与 `wfl-process-definition`：DCL 拥有申报创建、候选编辑、提交、撤回、驳回、批准、反批准、草稿删除、版本历史和审计读取；中央 Approval 唯一拥有版本号、状态、revision、审批元数据和审批事件；BOB 只通过 highest APPROVED typed snapshot 提供当前有效业务资料的只读查询与交易引用解析。Party 与独立 `customer-account` subject 不存在；客户核算账户是 Customer Version 内的强类型子项。会计映射、报表定义和流程定义的既有领域边界不变。

`dcl_subjects` 是版本化业务对象唯一通用稳定身份，最小保存不可变 ID、entity、code、createdAt 与 createdBy；非空 `(entity, upper(code))` 唯一。只有 ACC Mapping 是无编码 subject。Operating Entity、Warehouse、Vehicle、Fund Account、Product、Employee、Customer、Supplier、Other Unit 与 Sales Partner 必须分别匹配 `OPE/WHS/VEH/FAC/PRD/EMP/CUS/SUP/OTU/SLP-[0-9]{4}`；客户核算账户不占用 DCL subject 或全局编码空间，其稳定 ID 由 Customer 聚合持有，编码只在所属客户内大小写不敏感唯一。RPT 与 WFL 编码规则不变。DCL 不复制 Approval 版本头，不保存 current pointer 或第二套 revision，也不提供 BOB 写入别名、双写、过渡视图或失败回退。

## 2. 经营主体申报

`dcl_subjects` 保存经营主体唯一稳定 ID 与 `OPE-*` 业务编码；二者跨全部版本不可变。`dcl_operating_entity_versions` 以 `approvalEntryId` 为主键，保存该版本完整的法定名称、简称、税号、地址、电话、备注和 `enabled`。所有可变字段均随候选版本冻结；启用或停用同样通过保存新候选并审批，不存在 BOB current 写入。

唯一 wire 字段集合以 [OpenAPI DCL Schema](../../contracts/openapi/schemas/dcl.yaml) 为准。`/dcl/operating-entity` 是经营主体档案的唯一页面，候选查询、当前正式资料、详情和全部写动作固定使用 `/dcl/operating-entity/*`。`/bob/operating-entity/query|get` 只作为内部当前正式资料读取边界，不注册页面、菜单或深链。APP 工作台和审批深链固定进入 DCL 页面。

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

`/dcl/warehouse` 是唯一页面和维护入口，`/bob/warehouse/query|get` 只提供内部当前正式资料读取，不注册页面或菜单。启停同样通过完整 DCL candidate 的 `enabled` 改变，不存在 BOB 直接 `enable/disable`。批准 `enabled=false` 或反批准回落到 disabled/absent 前，在同一事务锁定仓库、库存和相关 VOU，并检查非零库存、进行中单据、仍可产生后续库存动作的来源单和当前正式引用；存在任一 blocker 时返回 `warehouse_disable_blocked`，Approval 保持不变。

VOU 与 ACC 继续保存 warehouse stable ID；VOU 同时保存实际采用的精确 DCL Approval Entry ID 与名称等必要快照。候选和后续批准版本不改写历史事实；任一 VOU 状态精确引用某仓库版本时，该版本不得反批准。

## 3.2 车辆申报

车辆 stable ID 与 `VEH-*` 编码跨全部版本不变。`dcl_vehicle_versions` 以 `approvalEntryId` 为主键，保存完整的名称、车牌、车型字典编码及来源 Approval Entry、承运归属封闭对象、VIN、发动机号、核定载重、散水承运能力、备注和 `enabled`。承运归属的 wire value 只有 `INTERNAL` 与 `EXTERNAL`：自有车辆必须引用一个当前可用经营主体及其精确 Approval Entry，外部车辆必须直接引用一个当前可用其他单位档案及其精确 Approval Entry。

`/dcl/vehicle` 是唯一页面和维护入口，`/bob/vehicle/query|get|reference` 只提供内部当前正式资料读取，不注册页面或菜单。启停只能保存完整 DCL candidate 的 `enabled` 变更，不存在 BOB 直接 `enable/disable`。候选创建或保存时按最新引用解析车型与承运归属；提交和批准时重新校验已保存的精确来源版本仍是 latest approved。承运方后续改版不会自动改写车辆快照，必须由用户建立车辆下一候选显式采用新版本。

批准或反批准只改变 Approval lifecycle；BOB 通过 highest APPROVED typed query 自然切换、回落或隐藏车辆资料，不保存车辆 current copy。被任一 VOU 正式事实精确引用的车辆 Approval Entry 不得反批准；当前车辆引用的经营主体或其他单位档案也不得失效，必须先通过车辆正常候选与审批流程修改承运归属。VOU 与运输事实继续保存 vehicle stable ID、实际采用的 Approval Entry ID、承运归属和车辆能力快照，任何车辆后续版本均不得重算或改写历史。

## 3.3 资金账户申报

资金账户 stable ID 与 `FAC-*` 编码跨全部版本不变。`dcl_fund_account_versions` 以 `approvalEntryId` 为主键，保存完整的名称、币种、户名、银行、支行、规范化账号、备注、所属经营主体 stable ID、精确 Approval Entry、编码与名称快照，以及 `enabled`。资金账户必须且只能属于一个当前可用经营主体；创建和保存时解析 latest approved，提交和批准时确认已存精确来源仍为 latest approved。所属主体后续改版不自动改写资金账户快照，必须通过新 candidate 显式采用。

`/dcl/fund-account` 是唯一页面和维护入口，`/bob/fund-account/query|get|reference` 只提供内部当前正式资料读取，不注册页面或菜单。账号移除空白和连字符并转为大写；非空账号在全部资金账户的 latest approved 与唯一 open candidate 之间大小写不敏感唯一，旧批准版本在新版本批准后释放账号。批准或反批准只改变 Approval lifecycle，并在同一事务更新账号占用；BOB 通过 highest APPROVED typed query 自然切换、回落或隐藏资料，冲突时 Approval 与账号占用均不改变。

VOU 收付款、费用支付、其他收入和票据资金行继续保存 fund account stable ID、实际采用的 Approval Entry ID、编码、名称与币种快照。任一已持久化 VOU 正文精确引用的资金账户 Approval Entry 不得反批准；但可以建立下一 candidate。ACC 继续保存 fund account stable ID 维度，并通过不可变的 VOU `source_id` 追溯实际采用的资金账户版本，不重复保存 Approval Entry 或快照。历史事实不回查当前资金账户并且不随后续版本改变。

## 3.4 产品申报

产品 stable ID、`PRD-*` 编码和抽象基准单位跨全部版本不变。`dcl_product_versions` 以 `approvalEntryId` 为主键，保存完整的名称、产品类型、产品分类、规格、型号、条码、计价单位、默认录入单位、默认包装规格、可回收标志、备注和 `enabled`；类型、分类和单位均同时保存来源 AUX stable ID 及必要名称和 typed 参数快照，不保存 AUX Approval Entry。每个计量单位 snapshot 还必须保存当时的 `quantityScale`，单位换算和固定配方中的单位不得在读取或制单时回查 AUX 精度。单位换算与固定配方是同一产品版本的强类型明细，不是独立对象、独立 API 或独立生命周期；每个版本始终保存完整 snapshot，不保存 diff。

创建或保存时解析当前启用且 entity 匹配的 AUX stable object，并按配方原料 stable ID 解析其 latest approved 产品版本；从正式版本创建候选时，原料 entry 自动前移但权威基准用量不变，需要确认的行保持显式待处理。提交和批准使用同一套完整性规则：AUX 快照只校验完整性与 stable identity，不回查来源 current，也不因来源后续改名、修改或停用而漂移；配方原料的已存精确 DCL entry 仍须为 latest approved。条码在全部产品的 latest approved 与唯一开放候选之间大小写不敏感唯一；并发候选和条码占用由同一事务保证。

`/dcl/product` 是唯一页面和维护入口，`/bob/product/query|get|reference` 只提供内部当前正式资料读取，不注册页面或菜单。批准或反批准只改变 Approval lifecycle；BOB 直接读取 highest APPROVED entry 对应的完整 DCL snapshot，不保存产品 current source，也不复制单位换算或固定配方事实。失败时 DCL snapshot、Approval 与标识占用全部回滚。库存、销售、采购、生产和 ACC 历史继续保存 product stable ID、实际采用的 Approval Entry、数量、名称及各自所需业务快照；任何后续产品版本都不得重算历史数量、配方、金额或库存事实。任一正式业务事实精确引用某产品 Approval Entry 时，该版本不得反批准。

## 3.5 强类型业务身份

Customer、Supplier、Employee、Other Unit 与 Sales Partner 各自在自己的完整 typed version 中保存身份、法定名称、显示名称、单一法定识别号和联系资料，不引用共享 Party。法定识别号按“业务档案类型 + 规范化值”在该类型的 latest approved 与唯一 open candidate 间共同占用；跨业务档案类型不比较、不复用、不同步，也不提供跨类型或同类型合并。误建且已有历史引用的档案只能通过下一候选停用，历史快照保持原值。

Party subject、版本、强标识数组、标识类型、重复税号字段、关系 root、影响预览、合并预检/确认、权限、页面和 API 全部不存在。新建每种业务档案都只创建该档案自己的 DCL subject、V1 candidate 和 typed snapshot；失败时整体回滚。法定识别号变更与其他身份资料一起进入该档案正常的候选和审批流程。

## 3.6 员工申报

员工 stable ID 与 `EMP-*` 编码由 `dcl_subjects(entity=employee)` 持有。`dcl_employee_versions` 以 `approvalEntryId` 保存完整身份和雇佣 snapshot：人员法律身份、单一法定识别号、姓名、人员类别、部门、岗位、工作电话、工作邮箱、入职日期、任职经营主体、备注与 `enabled`。人员类别、部门、岗位与经营主体均保存稳定来源及必要快照。

`/dcl/employee` 是员工唯一维护入口，`/bob/employee` 只提供 current `query|get|reference`。创建只提交员工完整资料，不选择或创建 Party。任职经营主体必须存在且当前有效，但只是员工资料，不限制其他经营主体的业务单据选择该员工；单据选择资格仍由自身权限和业务规则决定。V1 的 `enabled` 默认为 `true`，后续启停通过完整 DCL candidate 完成。

批准或反批准只改变 Approval lifecycle；BOB 直接读取 highest APPROVED employee snapshot 并返回来源 Approval Entry。VOU/ACC 与其他正式事实继续保存 employee stable ID、精确 Approval Entry 以及各自所需 snapshot。任一正式事实精确引用目标 employee entry 时，反批准必须返回 blocker；新 employee candidate 和后续批准版本不改写历史。

## 3.6.1 客户与客户核算账户申报

Customer 是唯一 Approval subject 和聚合根。客户 stable ID 与 `CUS-*` 编码由 DCL subject 持有；Customer 的身份 wire value 只有 `MAINLAND_ENTERPRISE`、`MAINLAND_INDIVIDUAL` 和 `OTHER`，创建默认 `MAINLAND_ENTERPRISE`。Customer Version 完整保存身份、法定名称、显示名称、单一法定识别号、联系电话、邮箱、联系地址、开票抬头、开票地址、开票电话、开票开户行及账号、零个或多个汇款识别档案、默认经营主体、`enabled`、身份税务附件，以及一个或多个客户核算账户。大陆企业号码删除全部空白并大写，必须通过 18 位统一社会信用代码字符集和校验码；大陆个人号码规范化末位 `X`，必须通过 18 位居民身份证结构、出生日期和校验码；其他号码仅 trim 且非空时在 Customer 内查重。草稿可为空但非空时立即校验，提交和批准在同一事务重新验证必填、格式和唯一性。每个汇款识别档案保存付款户名及可选付款银行、付款账号，用来辅助匹配真实来款，不代表核算账户或经营主体。客户不保存可交易经营主体名单；任一有效经营主体均可用于新销售单据，默认经营主体只提供预填。

客户核算账户是 Customer Version 内的强类型子项，不是 DCL subject。账户保存稳定 `accountId`、客户内唯一 code、名称、联系人、业务地址、客户类型、结算和收款方式、运输与定价、逐币种信用额度、主要业务归属、内部提醒、默认订单备注、业务附件与 `enabled`。每个有效客户至少包含一个有效账户，并指定一个默认账户。账户业务参数跨经营主体只有一套默认值，不建立按经营主体覆盖层；采用方保存实际业务快照。

`/dcl/customer` 是客户及全部核算账户的唯一维护路径，提供完整 lifecycle、版本和审计；`/dcl/customer-account` 与独立账户工作台任务不存在。创建在同一 transaction 建立 Customer subject、V1 candidate、完整客户 snapshot 和默认核算账户。任何账户新增、修改、停用或移除都修改唯一 Customer candidate，并与客户身份、税务、附件和全部账户一次保存、提交和批准。同一客户同时最多一个 open candidate，因此不存在账户间并行候选或部分审批。

已批准版本中的账户不能物理删除；下一 Customer candidate 可以停用或移除它，但默认账户必须先改指向另一有效账户。只有从未进入任何批准版本且未被业务引用的草稿账户才可直接删除。客户候选期间业务继续使用上一 highest APPROVED 完整版本；批准后整体切换。交易和 ACC 历史至少保存 `accountId + customerApprovalEntryId + 必要业务快照`，正式引用阻止对应 Customer Approval Entry 的不安全反批准。

## 3.7 供应商、其他单位与销售合作方申报

Supplier、Other Unit 与 Sales Partner 各自是全局强类型业务档案和独立 Approval subject，不引用 Party 或 relationship root。它们都可以维护适用经营主体集合和一个集合内的默认经营主体；新业务单据只能选择适用集合中的经营主体，默认值只用于预填。

`dcl_supplier_versions` 保存完整供应商身份、单一法定识别号、联系人、地址、备注、适用和默认经营主体、可选结算方式快照、默认采购员快照与 `enabled`。供应商不维护 category 或 type。默认采购员必须是当前可用 Employee snapshot，但其任职经营主体不限制选择。

`/dcl/supplier` 是供应商唯一维护入口，`/bob/supplier` 只提供 current `query|get|reference`。采购订单、采购入库、采购退货、采购付款及 ACC 事实保存 Supplier stable ID、精确 Approval Entry 和必要快照；后续版本不改写历史。

`dcl_other_unit_versions` 保存完整身份、单一法定识别号、联系人、地址、适用和默认经营主体、可选结算方式、备注与 `enabled`。`dcl_sales_partner_versions` 保存完整身份、单一法定识别号、适用和默认经营主体、`EXTERNAL_PART_TIME` 与 `CHANNEL_PARTNER` 能力集、联系人、地址、备注与 `enabled`。销售合作方草稿可暂缺能力，但 submit 与 approve 时至少有一种能力。Customer 与 Sales Partner 的法定识别号相同且身份可比较时禁止把该客户核算账户归属给该 Sales Partner；`OTHER` 不推测现实身份。

`/dcl/other-unit` 与 `/dcl/sales-partner` 是各自唯一维护入口；对应 BOB 路径只提供 current `query|get|reference`。正式事实保存 typed stable ID、精确 Approval Entry 和必要快照；后续版本不改写历史合同、归属、收益、会计或车辆事实。

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

13 个 DCL 可变 subject 的根级 `Dcl*ListItem` 与根级 `Dcl*View` 必须返回必填 `availableApprovalActions`，其元素只取公共 `ApprovalLifecycleAction` 闭集。服务端按该 subject、版本、权限和当前事实计算可用生命周期动作；Domain ViewModel 将这一服务端生命周期动作投影与本领域业务动作组合，页面不得从本地状态、权限或版本元数据推导、补齐或猜测生命周期动作。版本 View、版本 Summary 和 Approval metadata 不携带该字段。

任何业务或生命周期动作成功后，页面刷新受影响列表的 `query` 和已打开对象的 `get`，再显示成功结果；动作失败也以服务端 `errorKey` 和当前返回状态为准。revision 冲突只触发刷新，不自动重放原请求；blocker 仍由动作执行时的服务端检查，页面不以预检结果推断可以绕过或不再检查 blocker。

## 4. 原子性与引用

DCL application service 创建 PostgreSQL transaction，并在同一事务内调用中央 Approval、写入 DCL 类型化快照并同步发布强类型事件。Employee、Customer、Supplier、Other Unit 与 Sales Partner 直接从自己的 DCL stable subject、highest APPROVED entry 和完整 snapshot 向 BOB 提供 current 只读资料；不存在 Party、relationship identity 或 BOB 副本。Customer Version 与全部核算账户是一个原子 snapshot。任一 Approval subscriber 或领域内同步写入失败时，subject、entry、event 与 typed snapshot 必须全部回滚。

BOB 对新业务解析 current/latest approved，并返回稳定 ID、来源 `approvalEntryId`、编码和类型化资料快照；已保存业务继续按精确 `approvalEntryId` 校验历史批准快照。旧批准版本不会因新版本批准而删除或改写。反批准前必须执行 BOB 领域的精确版本引用 blocker；只允许反批准 Approval 判断的 latest approved。

## 5. 权限

DCL 每个维护页面分别按 `query`、`get`、`create`、`save`、`submit`、`unsubmit`、`reject`、`approve`、`unapprove`、`delete`、`versions`、`audit-history` 精确授权。Party 与 Customer Account 独立权限不存在；核算账户维护只服从 Customer 页面和 Customer 权限。BOB 仅保留本对象的 `query`、`get` 与 `reference` 内部读取权限，不注册页面、主菜单、待办或审批入口；其他领域既有权限边界不变。

## 6. 验收边界

真实 PostgreSQL 验收必须覆盖 V1/V2 highest-approved 切换与回落、同一 subject 唯一开放候选、并发保存最多一个成功、法定识别号按业务档案类型唯一，以及 subscriber 失败整笔回滚。Customer 必须覆盖创建时原子建立默认核算账户、全部账户与客户一次保存和审批、账户 code 客户内唯一、默认账户完整性、账户草稿删除与正式移除 blocker、跨经营主体共用账户默认值、`accountId + customerApprovalEntryId` 历史读取，以及账户无独立权限、API、版本和待办。Employee 必须覆盖任职经营主体快照以及跨经营主体单据仍可选择。Supplier、Other Unit 与 Sales Partner 必须覆盖适用经营主体集合、默认值、法定识别号和正式引用 blocker。HTTP 与前端验收必须证明 DCL 页面独占当前资料、候选及生命周期，BOB 只提供选择器、current 与 exact-reference 内部读取，动作文案区分编辑草稿与发起变更，并且不存在 Party、独立 Customer Account、BOB 页面、重复主菜单或旧深链。其他实体的既有验收边界不变。
