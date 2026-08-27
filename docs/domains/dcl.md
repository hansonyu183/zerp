# DCL 申报控制领域

## 1. 领域职责

DCL（Declaration Control）拥有需要经过审批后才投影到业务运行面的申报主体与强类型申报快照。首个实体是 `operating-entity`：DCL 拥有经营主体申报的创建、候选编辑、提交、撤回、驳回、批准、反批、草稿删除、版本历史和审计读取；中央 Approval 唯一拥有版本号、状态、revision、审批元数据和审批事件；BOB 只拥有批准结果的当前业务投影、业务编码以及面向交易的引用解析。

DCL 不复制 Approval 版本头，不保存 `currentVersionId`、`effectiveVersionId`、`baseVersionId` 或 `nextVersionNo`。DCL 也不提供 BOB 写入别名、双写、过渡视图或失败回退。

## 2. 经营主体申报

`dcl_subjects` 保存稳定申报主体身份；经营主体的稳定 ID 与 BOB 业务编码跨全部版本不变。`dcl_operating_entity_versions` 以 `approvalEntryId` 为主键，保存该版本完整的法定名称、简称、税号、地址、电话、备注和 `enabled`。所有可变字段均随候选版本冻结；启用或停用同样通过保存新候选并审批，不直接修改 BOB 当前投影。

唯一 wire 字段集合以 [OpenAPI DCL Schema](../../contracts/openapi/schemas/dcl.yaml) 为准。经营主体页面仍位于 BOB 导航 `/bob/operating-entity`，但候选查询、详情和全部写动作固定使用 `/dcl/operating-entity/*`；只有当前正式投影列表、详情和交易引用继续使用 `/bob/operating-entity/query|get`。

## 3. 版本与当前投影

版本语义完全复用 [Approval Version](approval.md#6-approval-version)：

1. V1 草稿不存在 BOB 当前投影，不能被交易引用；
2. V1 批准后，同一事务把该快照写入 `bob_operating_entities`；
3. V2 为 `DRAFT` 或 `PENDING` 时，BOB 当前投影继续指向 V1；
4. V2 批准后，同一事务把当前投影切换到 V2；
5. 反批 V2 后，当前投影回落到仍为 `APPROVED` 的 V1；
6. 反批 V1 后，没有正式版本，BOB 当前投影被删除，但稳定 DCL subject、BOB ID、编码和审批历史保留。

`approval_entries.version_no` 是唯一版本号。`bob_operating_entities.source_approval_entry_id` 只是当前投影的来源证据，不参与候选号分配，也不改变 latest approved 的推导规则。

## 4. 原子性与引用

DCL application service 创建 PostgreSQL transaction，并在同一事务内调用中央 Approval、写入 DCL 类型化快照、同步发布强类型事件以及应用或移除 BOB 当前投影。任一 Approval subscriber 或当前投影写入失败时，entry、event、DCL snapshot 和 BOB current 必须全部回滚。

BOB 对新业务解析 latest approved，并返回经营主体稳定 ID、来源 `approvalEntryId`、编码和法定资料快照；已保存业务继续按精确 `approvalEntryId` 校验历史批准快照。旧批准版本不会因新版本批准而删除或改写。反批前必须执行 BOB 领域的精确版本引用 blocker；只允许反批 Approval 判断的 latest approved。

## 5. 权限

DCL 精确权限为 `query`、`get`、`create`、`save`、`submit`、`unsubmit`、`reject`、`approve`、`unapprove`、`delete`、`versions`、`audit-history`。BOB 经营主体只保留 `query` 与 `get`。APP 保留原 14 个稳定权限 ID 和已有角色分配，其中两个 ID 继续承载 BOB 当前读取，其余 ID 原位切换到 DCL；不自动扩大任何角色权限。

## 6. 验收边界

真实 PostgreSQL 验收必须覆盖 V1/V2 正式投影切换与回落、V1 反批后不可引用、草稿删除后候选号复用、同一主体唯一开放候选、并发保存最多一个成功、只反批 latest approved，以及 subscriber 或 BOB current 写入失败时整笔事务回滚。还必须证明旧 BOB 写路由与权限不存在、页面编排使用 DCL 写路径、BOB 引用仍能校验精确历史快照。
