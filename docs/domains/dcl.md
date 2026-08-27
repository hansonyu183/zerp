# DCL 申报控制领域

## 1. 领域职责

DCL（Declaration Control）拥有需要经过审批后才投影到业务运行面的申报主体与强类型申报快照。当前实体是 `operating-entity`、`warehouse` 与 `vehicle`：DCL 拥有申报创建、候选编辑、提交、撤回、驳回、批准、反批、草稿删除、版本历史和审计读取；中央 Approval 唯一拥有版本号、状态、revision、审批元数据和审批事件；BOB 只拥有批准结果的当前业务投影、业务编码以及面向交易的引用解析。

DCL 不复制 Approval 版本头，不保存 `currentVersionId`、`effectiveVersionId`、`baseVersionId` 或 `nextVersionNo`。DCL 也不提供 BOB 写入别名、双写、过渡视图或失败回退。

## 2. 经营主体申报

`dcl_subjects` 保存稳定申报主体身份；经营主体的稳定 ID 与 BOB 业务编码跨全部版本不变。`dcl_operating_entity_versions` 以 `approvalEntryId` 为主键，保存该版本完整的法定名称、简称、税号、地址、电话、备注和 `enabled`。所有可变字段均随候选版本冻结；启用或停用同样通过保存新候选并审批，不直接修改 BOB 当前投影。

唯一 wire 字段集合以 [OpenAPI DCL Schema](../../contracts/openapi/schemas/dcl.yaml) 为准。`/dcl/operating-entity` 是经营主体申报的唯一维护页面，候选查询、详情和全部写动作固定使用 `/dcl/operating-entity/*`。`/bob/operating-entity` 是独立的当前正式档案只读页面，只使用 `/bob/operating-entity/query|get`；它可以导航到同一稳定 subject 的 DCL 页面，但不在 BOB 内创建、保存或审批候选。APP 工作台和审批深链固定进入 DCL 页面。

## 3. 版本与当前投影

版本语义完全复用 [Approval Version](approval.md#6-approval-version)：

1. V1 草稿不存在 BOB 当前投影，不能被交易引用；
2. V1 批准后，同一事务把该快照写入对应的 `bob_operating_entities`、`bob_warehouses` 或 `bob_vehicles` 当前投影；
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

## 4. 原子性与引用

DCL application service 创建 PostgreSQL transaction，并在同一事务内调用中央 Approval、写入 DCL 类型化快照、同步发布强类型事件以及应用或移除 BOB 当前投影。任一 Approval subscriber 或当前投影写入失败时，entry、event、DCL snapshot 和 BOB current 必须全部回滚。

BOB 对新业务解析 current/latest approved，并返回稳定 ID、来源 `approvalEntryId`、编码和类型化资料快照；已保存业务继续按精确 `approvalEntryId` 校验历史批准快照。旧批准版本不会因新版本批准而删除或改写。反批前必须执行 BOB 领域的精确版本引用 blocker；只允许反批 Approval 判断的 latest approved。

## 5. 权限

DCL 每个维护页面分别按 `query`、`get`、`create`、`save`、`submit`、`unsubmit`、`reject`、`approve`、`unapprove`、`delete`、`versions`、`audit-history` 精确授权。BOB 当前档案页面只检查 BOB `query` 与 `get`，不得因用户具有 DCL 权限而显示 BOB 生命周期动作。权限切换保留已有角色分配但不保留旧 BOB 写路径；仓库与车辆原 `enable/disable` 权限 ID 仅降级承载 DCL `get/query`，启停申请本身要求对应 DCL `save`。

## 6. 验收边界

真实 PostgreSQL 验收必须覆盖 V1/V2 正式投影切换与回落、V1 反批后不可引用、草稿删除后候选号复用、同一主体唯一开放候选、并发保存最多一个成功、只反批 latest approved，以及 subscriber 或 BOB current 写入失败时整笔事务回滚。仓库还必须覆盖四类停用 blocker 与 VOU 精确版本引用 blocker；车辆还必须覆盖承运归属两种来源、车型与承运方漂移、VOU 精确版本引用 blocker 和历史运输快照不变。HTTP 与前端验收必须证明旧 BOB 写路由与权限不存在、DCL 页面独占 DCL 候选及生命周期编排、BOB 页面只读取当前正式投影、APP 深链进入 DCL，以及 BOB 引用仍能校验精确历史快照。
